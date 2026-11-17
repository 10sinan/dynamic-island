#!/usr/bin/env bash
# Runs inside the private D-Bus session started by tests/headless-smoke.sh.
set -u

ev() {   # evaluate JS inside the shell, print the result without GVariant noise
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1" 2>&1 |
        sed -E "s/^\(true, //; s/\)$//; s/\\\\//g; s/^'\"?//; s/\"?'$//"
}
shot() {   # name x y w h
    [ -n "$SHOTS" ] || return 0
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.ScreenshotArea "$2" "$3" "$4" "$5" false "$SHOTS/$1.png" >/dev/null
    echo "   screenshot: $SHOTS/$1.png"
}
dset() { gsettings --schemadir "$HERE/$UUID/schemas" set "$SCHEMA" "$@"; }
dreset() { gsettings --schemadir "$HERE/$UUID/schemas" reset "$SCHEMA" "$1"; }

EXT='Main.extensionManager.lookup("'"$UUID"'").stateObj'
ISL="$EXT._islands"
C="$ISL.find(i => i._id === 'center')"
Q="$ISL.find(i => i._id === 'qs')"
ST="$ISL.find(i => i._id === 'stats')"
ACT="Main.panel.statusArea.activities"
DM="Main.panel.statusArea.dateMenu"
QSB="Main.panel.statusArea.quickSettings"
state() {   # $1 = island expression
    ev "JSON.stringify({x:$1.actor.x, y:$1.actor.y, w:$1.actor.width, h:$1.actor.height, mode:$1.mode, bg:[$1._bg.x,$1._bg.y,$1._bg.width,$1._bg.height], modules:$1._modules.map(m=>m.constructor.id)})"
}
COUNTS="JSON.stringify({islands: $ISL.length, features: $EXT._features.length, uiGroup: Main.layoutManager.uiGroup.get_n_children(), tracked: Main.layoutManager._trackedActors.length})"
SLOTS="JSON.stringify({activities:{opacity:$ACT.container.opacity, w:$ACT.container.width, natural:$ACT.container.get_preferred_width(-1)[1]}, clock:{opacity:$DM.container.opacity, w:$DM.container.width, natural:$DM.container.get_preferred_width(-1)[1]}, qs:{opacity:$QSB.container.opacity, w:$QSB.container.width, natural:$QSB.container.get_preferred_width(-1)[1]}})"

# An existing user's saved lists (before the statistics island existed):
dset center-modules "['music', 'calendar', 'notifications', 'cpu', 'ram', 'temp']"
dset center-compact-modules "['music', 'cpu', 'ram']"

gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['$HELPER', '$UUID']"

gnome-shell --headless --wayland --no-x11 --virtual-monitor 1920x1080 > "$SANDBOX/shell.log" 2>&1 &
SHELL_PID=$!
for i in $(seq 1 60); do
    gnome-extensions info "$UUID" 2>/dev/null | grep -q "State: ACTIVE\|State: ERROR" && break
    sleep 0.5
done
ev "Main.overview.hide()" >/dev/null
sleep 2
ev "Main.messageTray.getSources().forEach(s => s.destroy())" >/dev/null
sleep 3

echo "== after start"
gnome-extensions info "$UUID" | grep -E "State"
echo "   counts: $(ev "$COUNTS")"
echo "   slots:  $(ev "$SLOTS")"
echo "   center: $(state "$C")"
echo "   stats:  $(state "$ST")"
echo "   qs:     $(state "$Q")"
shot center-compact 560 0 800 60
shot stats-compact 0 0 500 60
shot qs-compact 1520 0 400 60

echo "== settings migration (old saved lists -> new layout)"
echo "   center-modules=$(gsettings --schemadir "$HERE/$UUID/schemas" get "$SCHEMA" center-modules)"
echo "   center-compact-modules=$(gsettings --schemadir "$HERE/$UUID/schemas" get "$SCHEMA" center-compact-modules)"
echo "   stats-modules=$(gsettings --schemadir "$HERE/$UUID/schemas" get "$SCHEMA" stats-modules)"
echo "   stats-compact-modules=$(gsettings --schemadir "$HERE/$UUID/schemas" get "$SCHEMA" stats-compact-modules)"
echo "   layout-version=$(gsettings --schemadir "$HERE/$UUID/schemas" get "$SCHEMA" layout-version)"
echo "   Activities replaced: opacity=$(ev "$ACT.container.opacity") stats pill x=$(ev "Math.round($ST._bg.x + $ST.actor.x)") (starts at the left edge)"

echo "== smoothness: relayouts + radius during one expand/collapse (T1, T8)"
ev "global._di = {hb: 0, inner: 0, row: 0, frames: 0, bad: 0, radii: []};
    const c = $C;
    global._diIds = [
      [c.actor, c.actor.connect('notify::allocation', () => global._di.hb++)],
      [c._expandedInner, c._expandedInner.connect('notify::allocation', () => global._di.inner++)],
      [c._compactRow, c._compactRow.connect('notify::allocation', () => global._di.row++)],
      [c._bg, c._bg.connect('notify::allocation', () => {
          const d = global._di; d.frames++;
          if (c._radius > Math.floor(c._bg.height / 2)) d.bad++;
          if (d.radii[d.radii.length - 1] !== c._radius) d.radii.push(c._radius);
      })]];
    true" >/dev/null
ev "$C.actor.hover = true; true" >/dev/null
sleep 0.06; shot morph-060 560 0 800 200
sleep 0.06; shot morph-120 560 0 800 200
sleep 0.12; shot morph-240 560 0 800 200
sleep 0.4;  shot center-expanded 460 0 1000 200
echo "   expand:   $(ev "JSON.stringify(global._di)")"
echo "   header first: $(ev "$C._expandedInner.get_child_at_index(0) === $C._headerRow && $C._headerRow.visible")  big clock: $(ev "$C._headerRow.get_child_at_index(0).get_child_at_index(0).text")"
ev "Object.assign(global._di, {hb: 0, inner: 0, row: 0, frames: 0, bad: 0, radii: []}); $C.actor.hover = false; true" >/dev/null
sleep 0.08; echo "   80 ms after leave:  mode=$(ev "$C.mode")"
sleep 0.6;  echo "   collapse: $(ev "JSON.stringify(global._di)")  mode=$(ev "$C.mode")"
echo "   spring: mode=$(ev "$C._cfg.expandMode") (EASE_OUT_BACK=$(ev "imports.gi.Clutter.AnimationMode.EASE_OUT_BACK")), duration=$(ev "$C._cfg.expandMs")"
ev "global._diIds.forEach(([a, id]) => a.disconnect(id)); delete global._diIds; true" >/dev/null

echo "== hit area: the gap between pill and panel edge belongs to the island"
pick() {
    ev "const a = global.stage.get_actor_at_pos(imports.gi.Clutter.PickMode.REACTIVE, $1, $2); a === $C.actor || $C.actor.contains(a) ? 'island' : (a?.get_name?.() || a?.constructor?.name || String(a))"
}
PL="$(ev "Math.round($C.actor.x)")"
PW="$(ev "Math.round($C.actor.width)")"
CX=$((PL + PW / 2))
echo "   pill ($CX,15): $(pick "$CX" 15) | top edge ($CX,0): $(pick "$CX" 0) | left gap: $(pick $((PL+1)) 15) | right gap: $(pick $((PL+PW-2)) 15) | outside: $(pick $((PL-6)) 15)"

echo "== OSD"
VOL="imports.gi.Gio.ThemedIcon.new('audio-volume-medium-symbolic')"
ev "Main.osdWindowManager.showAll($VOL, null, 0.5, 1); true" >/dev/null; sleep 0.6
echo "   volume 50%: activity=$(ev "$C.activityKey") text=$(ev "$C._activityInner.get_child().get_child_at_index(2).text") gnomeOsdVisible=$(ev "Main.osdWindowManager._osdWindows[0].visible")"
shot osd 560 0 800 80
ev "Main.osdWindowManager.showAll($VOL, null, 0.6, 1); true" >/dev/null; sleep 0.1
echo "   volume 60% (in place): text=$(ev "$C._activityInner.get_child().get_child_at_index(2).text") morphRunning=$(ev "!!$C._bg.get_transition('width')")"
ev "Main.osdWindowManager.showAll(imports.gi.Gio.ThemedIcon.new('input-keyboard-symbolic'), 'Caps Lock', null, null); true" >/dev/null; sleep 0.3
echo "   caps-lock style OSD -> GNOME: gnomeOsdVisible=$(ev "Main.osdWindowManager._osdWindows[0].visible")"
sleep 2
echo "   after 2 s: mode=$(ev "$C.mode")"

echo "== OSD twice, separated in time (the 2nd one must not be blank)"
ev "Main.osdWindowManager.showAll($VOL, null, 0.3, 1); true" >/dev/null; sleep 2.2
ev "Main.osdWindowManager.showAll($VOL, null, 0.7, 1); true" >/dev/null; sleep 0.5
echo "   first OSD ended, second: activity=$(ev "$C.activityKey") text=$(ev "$C._activityInner.get_child().get_child_at_index(2).text") (expect 70%)"
sleep 2

echo "== notification preview"
NP="$EXT._features.find(f => f.constructor.name === 'NotificationPreview')"
ev "Main.notify('Toplanti 5 dk sonra', 'Proje gozden gecirme - oda 3'); true" >/dev/null; sleep 0.8
echo "   diag: watched=$(ev "$NP._sources.size")"
echo "   activity=$(ev "$C.activityKey") title=$(ev "$C._activityInner.get_child().get_child_at_index(1).get_child_at_index(1).text") trayTranslation=$(ev "Main.messageTray.translation_y")"
shot notification 460 0 1000 120
dset notification-duration 1500; sleep 0.8
ev "Main.notify('Ikinci', 'kisa sure'); true" >/dev/null; sleep 0.8
echo "   2nd notification after the 1st ended: title=$(ev "$C._activityInner.get_child()?.get_child_at_index(1)?.get_child_at_index(1)?.text") (expect Ikinci)"
sleep 2
echo "   1.5 s preview ended: mode=$(ev "$C.mode")"
dreset notification-duration; sleep 0.5

echo "== screenshot preview (same notification GNOME creates: St.ImageContent icon)"
python3 - "$SANDBOX/shot.png" <<'PY'
import sys, gi
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import GdkPixbuf, GLib
w, h = 480, 300
data = bytearray()
for y in range(h):
    for x in range(w):
        data += bytes((40 + x * 200 // w, 90 + y * 120 // h, 220 - x * 150 // w))
pb = GdkPixbuf.Pixbuf.new_from_bytes(GLib.Bytes.new(bytes(data)), GdkPixbuf.Colorspace.RGB, False, 8, w, h, w * 3)
pb.add_alpha(False, 0, 0, 0).savev(sys.argv[1], "png", [], [])   # GNOME hands over RGBA
PY
ev "Main.notify('x', 'y'); true" >/dev/null; sleep 0.5
ev "const St = imports.gi.St, Cogl = imports.gi.Cogl; const pb = imports.gi.GdkPixbuf.Pixbuf.new_from_file('$SANDBOX/shot.png'); const content = St.ImageContent.new_with_preferred_size(pb.width, pb.height); content.set_bytes(global.stage.context.get_backend().get_cogl_context(), pb.read_pixel_bytes(), Cogl.PixelFormat.RGBA_8888, pb.width, pb.height, pb.rowstride); global._diShot = content; true" >/dev/null
ev "$C.endActivity(); true" >/dev/null; sleep 0.6
ev "const src = Main.messageTray.getSources()[0]; const N = src.notifications[0].constructor; const n = new N({source: src, title: 'Screenshot captured', body: 'You can paste the image from the clipboard', gicon: global._diShot, isTransient: true}); n.addAction('Show in Files', () => {}); src.addNotification(n); true" >/dev/null
sleep 0.5
echo "   activity=$(ev "$C.activityKey") (expect screenshot)"
echo "   thumbnail frame: $(ev "JSON.stringify([Math.round($NP._shotRefs.frame.width), Math.round($NP._shotRefs.frame.height)])") (480x300 fitted into 176x108 -> aspect 1.6) image content set: $(ev "!!$NP._shotRefs.image.content")"
echo "   text: $(ev "$NP._shotRefs.sub.text")"
echo "   shutter flash running: $(ev "$NP._shotRefs.flash.opacity > 0 || $NP._shotRefs.flash.get_transition('opacity') !== null") pop-in running or done: $(ev "$NP._shotRefs.frame.scale_x > 0.7")"
shot screenshot-preview 460 0 1000 150
sleep 5
echo "   after GNOME's own timeout: mode=$(ev "$C.mode")"
dset screenshot-preview false; sleep 1
ev "const src = Main.messageTray.getSources()[0]; const N = src.notifications[0]?.constructor ?? Object.getPrototypeOf(Main.messageTray.getSources()[0].notifications[0] ?? {}).constructor; true" >/dev/null
ev "const src2 = Main.messageTray.getSources()[0]; const N2 = src2.notifications[0].constructor; const n2 = new N2({source: src2, title: 'Screenshot captured', body: 'b', gicon: global._diShot, isTransient: true}); src2.addNotification(n2); true" >/dev/null; sleep 0.8
echo "   screenshot-preview=false -> shown as a normal notification instead: activity=$(ev "$C.activityKey")"
dreset screenshot-preview; sleep 1
ev "$C.endActivity(); true" >/dev/null; sleep 0.5

echo "== hover-only: no click opens GNOME menus"
echo "   hitbox is a plain widget (no clicked signal): $(ev "$C.actor.constructor.name")"

echo "== centre panel: big clock + calendar + notification list + tiles"
dset notification-duration 1000; sleep 0.8
ev "Main.notify('Paket teslim edildi', 'Kapida birakildi'); true" >/dev/null; sleep 2
ev "$C.actor.hover = true; true" >/dev/null; sleep 0.8
echo "   main row: $(ev "JSON.stringify($C._mainRow.get_children().map(c => c.style_class))") tiles: $(ev "$C._tilesRow.get_n_children()") (stats moved to the left island)"
echo "   calendar title: $(ev "$C._modules.find(m => m.constructor.id === 'calendar')._title.text")  today cells: $(ev "$C._modules.find(m => m.constructor.id === 'calendar')._cells.filter(c => c.has_style_class_name('di-cal-today')).length")"
echo "   notification rows: $(ev "$C._modules.find(m => m.constructor.id === 'notifications')._list.get_n_children()")  all acknowledged (dot cleared): $(ev "Main.messageTray.getSources().flatMap(s => s.notifications).every(n => n.acknowledged)")"
echo "   GNOME calendar opened? $(ev "$DM.menu.isOpen")"
echo "   geometry: $(state "$C")"
shot center-panel 300 0 1320 460
ev "$C._modules.find(m => m.constructor.id === 'calendar')._shift(1); true" >/dev/null; sleep 0.2
echo "   next month: $(ev "$C._modules.find(m => m.constructor.id === 'calendar')._title.text")"
ev "$C.actor.hover = false; true" >/dev/null; sleep 0.8
dreset notification-duration; sleep 1   # a settings change rebuilds the islands

echo "== statistics island (top left)"
ev "$ST._hold(true); $ST._setMode('expanded'); true" >/dev/null; sleep 3.5
echo "   modules: $(ev "$ST._modules.map(m => m.constructor.id).join(', ')")"
echo "   main row: $(ev "JSON.stringify($ST._mainRow.get_children().map(c => c.style_class))") tiles: $(ev "$ST._tilesRow.get_n_children()")"
echo "   history samples: cpu=$(ev "$ST._history.series('cpu').length") ram=$(ev "$ST._history.series('ram').length") net=$(ev "$ST._history.series('net-down').length")"
echo "   graph values: $(ev "JSON.stringify(Object.fromEntries(Object.entries($ST._modules.find(m => m.constructor.id === 'graph')._rows).map(([k, r]) => [k, r.value.text])))")"
echo "   top CPU: $(ev "$ST._modules.find(m => m.constructor.id === 'procs')._cpu.rows.filter(r => r.row.opacity > 0).map(r => r.name.text + ' ' + r.value.text).join(' | ')")"
echo "   top memory: $(ev "$ST._modules.find(m => m.constructor.id === 'procs')._mem.rows.filter(r => r.row.opacity > 0).map(r => r.name.text + ' ' + r.value.text).join(' | ')")"
echo "   gpu tile: $(ev "$ST._modules.some(m => m.constructor.id === 'gpu')") disk tile: $(ev "$ST._modules.some(m => m.constructor.id === 'disk')")"
echo "   geometry: $(state "$ST")"
echo "   expands to the right from the left edge: x=$(ev "Math.round($ST._bg.x + $ST.actor.x)") w=$(ev "Math.round($ST._bg.width)")"
shot stats-expanded 0 0 760 420
ev "$ST._hold(false); $ST._setMode('compact'); true" >/dev/null; sleep 0.8

echo "== QS compact icon row (own icons, not a clone)"
echo "   children: $(ev "JSON.stringify($Q._compactRow.get_children().get_children?.() ?? $Q._compactRow.get_children()[0].get_children().map(c => ({cls: c.style_class, vis: c.visible, icon: c.icon_name ?? null, h: Math.round(c.height), text: c.text ?? null})))")"
echo "   pill: h=$(ev "$Q._bg.height") w=$(ev "$Q._bg.width"); icon sizes equal: $(ev "new Set($Q._compactRow.get_children()[0].get_children().filter(c => c.visible && c.icon_name).map(c => c.icon_size)).size === 1")"
shot qs-row 1560 0 360 40

echo "== event indicators"
EH="$EXT._features.find(f => f.constructor.name === 'EventHub')"
for ev_spec in "power|{charging: true, pct: 62}" "power|{charging: false, pct: 61}" "battery-low|{pct: 19, level: 20}" "wifi|{connected: true, name: 'EvAgi', wired: false}" "wifi|{connected: false}" "bluetooth|{connected: true, name: 'Kulaklik', icon: 'audio-headphones-symbolic'}" "privacy|{kind: 'mic', on: true}" "privacy|{kind: 'cam', on: true}"; do
    kind="${ev_spec%%|*}"; data="${ev_spec#*|}"
    ev "$C.endActivity(); true" >/dev/null; sleep 0.3
    ok="$(ev "$EH.trigger('$kind', $data)")"; sleep 0.9
    echo "   $kind $data -> shown=$ok activity=$(ev "$C.activityKey") text='$(viewtxt "$C")'"
    case "$kind$data" in
        battery-low*) shot event-battery 460 0 1000 90 ;;
        privacy*mic*) shot event-mic 460 0 1000 90 ;;
        power*true*) shot event-power 460 0 1000 90 ;;
    esac
done
ev "$C.endActivity(); true" >/dev/null; sleep 0.5
ev "$EH.trigger('wifi', {connected: true, name: 'X', wired: false}); true" >/dev/null; sleep 0.2
echo "   same event twice within 3 s is merged: $(ev "$EH.trigger('wifi', {connected: true, name: 'X', wired: false})")"
ev "$C.endActivity(); $C._hold(true); $C._setMode('expanded'); true" >/dev/null; sleep 0.8
echo "   not shown while the island is open: $(ev "$EH.trigger('bluetooth', {connected: true, name: 'Y', icon: 'x'})")"
ev "$C._hold(false); $C._setMode('compact'); true" >/dev/null; sleep 0.8
dset events "['wifi']"; sleep 1
echo "   events=[wifi] -> power ignored: $(ev "$EXT._features.find(f => f.constructor.name === 'EventHub').trigger('power', {charging: true, pct: 50})")"
dreset events; sleep 1

echo "== QS panel: sliders + toggles + system (read-only for real system services)"
TG="$Q._modules.find(m => m.constructor.id === 'toggles')"
SY="$Q._modules.find(m => m.constructor.id === 'system')"
# Programmatic hover is reset by Clutter once the pill grows away from the
# (headless) pointer, so open it directly and hold it open for these checks.
ev "$Q._hold(true); $Q._setMode('expanded'); true" >/dev/null; sleep 0.8
echo "   sections: $(ev "JSON.stringify($Q._mainRow.get_children().map(c => c.style_class))")"
echo "   toggles: $(ev "JSON.stringify(Object.fromEntries(Object.entries($TG._toggles).map(([k, t]) => [k, t.actor.visible ? (t.actor.has_style_pseudo_class('checked') ? 'on' : 'off') : 'hidden'])))")"
echo "   geometry: $(state "$Q")"
shot qs-panel 1300 0 620 480
# dark style lives in the sandbox dconf only -> safe to click
BEFORE="$(gsettings get org.gnome.desktop.interface color-scheme)"
ev "$TG._toggles.dark.actor.get_child_at_index(0).emit('clicked', 1); true" >/dev/null; sleep 0.4
echo "   dark toggle click: color-scheme $BEFORE -> $(gsettings get org.gnome.desktop.interface color-scheme), toggle=$(ev "$TG._toggles.dark.actor.has_style_pseudo_class('checked')")"
gsettings reset org.gnome.desktop.interface color-scheme
ev "$TG._openPage('wifi'); true" >/dev/null; sleep 1.5
echo "   wifi page: visible=$(ev "$TG._pageBox.visible") rows=$(ev "$TG._pageBox.get_child_at_index(1)?.get_n_children() ?? 0") panelH=$(ev "$Q._bg.height")"
shot qs-wifi 1300 0 620 520
ev "$TG._closePage(); $TG._openPage('bt'); true" >/dev/null; sleep 0.8
echo "   bluetooth page: $(ev "$TG._pageBox.get_child_at_index(1)?.get_children().map(c => c.text ?? c.get_child()?.get_children?.()[1]?.text).join(', ')")"
shot qs-bt 1300 0 620 480
ev "$TG._closePage(); $SY._togglePowerRow(); true" >/dev/null; sleep 0.6
echo "   power row: $(ev "$SY._powerRow.visible") choices=$(ev "$SY._powerRow.get_children().filter(c => c.visible).map(c => c.label).join(', ')")"
shot qs-power 1300 0 620 480
ev "$SY._togglePowerRow(); $Q._hold(false); true" >/dev/null; sleep 0.9
echo "   released, pointer elsewhere -> collapsed: $(ev "$Q.mode")"

echo "== slider drag keeps the island open"
ev "$Q.actor.hover = true; true" >/dev/null; sleep 0.6
ev "$Q._hold(true); $Q.actor.hover = false; true" >/dev/null; sleep 0.6
echo "   dragging, pointer outside: mode=$(ev "$Q.mode")"
ev "$Q._hold(false); true" >/dev/null; sleep 0.8
echo "   drag released: mode=$(ev "$Q.mode")"

echo "== music (fake MPRIS player: red cover, then blue)"
MU="$C._modules.find(m => m.constructor.id === 'music')"
PRE_W="$(ev "Math.round($C.actor.width)")"
echo "   before any player: compact visible=$(ev "$MU._compact.visible") card visible=$(ev "$MU._card.visible") pill w=$PRE_W"
mkdir -p "$SANDBOX/art"
python3 "$HERE/tests/fake-player.py" "$SANDBOX/art" &
FAKE_PID=$!
sleep 3
echo "   player found: title=$(ev "$MU._info?.title") status=$(ev "$MU._info?.status") compact visible=$(ev "$MU._compact.visible")"
echo "   art accent (red cover, white border): $(ev "$MU._art?.accent") tint=$(ev "JSON.stringify($MU._art?.tint)") eq animating=$(ev "$MU._compactEq._bars[0].get_transition('scale-y') !== null")"
echo "   pill grew: $PRE_W -> $(ev "Math.round($C._bg.width)")"
shot music-compact 560 0 800 60
ev "$C._hold(true); $C._setMode('expanded'); true" >/dev/null; sleep 1.3   # hold: no pointer in headless, auto-collapse would close it
echo "   card: title=$(ev "$MU._title.text") artist=$(ev "$MU._artist.text") album=$(ev "$MU._album.text") time=$(ev "$MU._elapsed.text")/$(ev "$MU._remaining.text") visible=$(ev "$MU._card.visible && $MU._progressBox.visible")"
echo "   palette: accent=$(ev "$MU._art?.accent") accent2=$(ev "$MU._art?.accent2")"
echo "   motion while playing: flow=$(ev "$MU._flowA.get_transition('opacity') !== null") glow=$(ev "$MU._glow.get_transition('opacity') !== null") cover pulse=$(ev "$MU._cardCover.actor.get_transition('scale-x') !== null") eq(5 bars)=$(ev "$MU._cardEq._bars.length")"
echo "   pill outline takes the album colour: $(ev "$C._bg.get_style()")"
echo "   banner is between header and main row: $(ev "$C._expandedInner.get_children().map(c => c === $C._headerRow ? 'header' : c === $C._bannerRow ? 'banner' : c === $C._mainRow ? 'main' : 'tiles').join('>')")"
shot music-card 300 0 1320 330
echo "   play button colour: $(ev "$MU._playButton.get_style()")  progress fill: $(ev "$MU._fill.get_style()")"
ev "$MU._next.emit('clicked', 1); true" >/dev/null; sleep 1.5
echo "   Next clicked -> title=$(ev "$MU._info?.title") accent=$(ev "$MU._art?.accent") (blue cover => blue accent) progress reset: $(ev "$MU._elapsed.text")"
shot music-card-blue 300 0 1320 330
ev "$MU._playButton.emit('clicked', 1); true" >/dev/null; sleep 1
echo "   PlayPause clicked -> status=$(ev "$MU._info?.status") icon=$(ev "$MU._playIcon.icon_name") eq stopped=$(ev "$MU._compactEq._bars[0].get_transition('scale-y') === null") flow frozen=$(ev "$MU._flowA.get_transition('opacity') === null") outline reset=$(ev "!$C._bg.get_style().includes('border-color')")"
ev "$MU._playButton.emit('clicked', 1); true" >/dev/null; sleep 1
ev "$MU._call('SetPosition', new (imports.gi.GLib.Variant)('(ox)', ['/fake/track/1', 90000000])); true" >/dev/null; sleep 2.3
echo "   SetPosition(90 s) -> elapsed=$(ev "$MU._elapsed.text") (expect ~1:3x)"
echo "   hover-activity: collapse, then change track -> popup"
ev "$C._hold(false); $C._setMode('compact'); true" >/dev/null; sleep 0.8
ev "$MU._call('Next'); true" >/dev/null; sleep 1.8
echo "   popup: activity=$(ev "$C.activityKey") title=$(ev "$MU._popupTitle?.text") artist=$(ev "$MU._popupArtist?.text")"
shot music-popup 460 0 1000 90
sleep 4.5
echo "   popup ended after ~4 s: mode=$(ev "$C.mode")"
kill $FAKE_PID; wait $FAKE_PID 2>/dev/null; sleep 1.5
echo "   player quit: compact visible=$(ev "$MU._compact.visible") card visible=$(ev "$MU._card.visible") pill w=$(ev "Math.round($C._bg.width)") (back to $PRE_W)"

echo "== resource alerts (thermal / memory / disk)"
EH="$EXT._features.find(f => f.constructor.name === 'EventHub')"
viewtxt() {   # all visible label texts of an island's activity view
    ev "const St = imports.gi.St; const out = []; const w = a => { if (a instanceof St.Label) { if (a.visible && a.text) out.push(a.text); return; } a.get_children?.().forEach(w); }; const root = $1._activityInner.get_child(); if (root) w(root); out.join(' / ')"
}
txt() { viewtxt "$C"; }
alert() {   # label, evaluate-argument
    ev "$C.endActivity(); true" >/dev/null; sleep 0.3
    ev "$EH._evaluate($2); true" >/dev/null; sleep 0.8
    echo "   $1 -> activity=$(ev "$C.activityKey") text='$(txt)'"
}
echo "   real readings are below every limit: activity=$(ev "$C.activityKey")"
alert "CPU 93°C" "{temp: 93}"
alert "CPU 94°C again (already announced)" "{temp: 94}"
ev "$EH._evaluate({temp: 80}); true" >/dev/null
alert "back to 80°C then 95°C (re-armed)" "{temp: 95}"
alert "RAM 93%" "{ram: 0.93}"
alert "disk 97%" "{disk: 0.97, diskFreeGb: 12.3}"
shot event-disk 460 0 1000 90
ev "$EH._firstCheck = true; $EH._armed.thermal = true; $C.endActivity(); true" >/dev/null; sleep 0.3
alert "first reading already hot (silent start)" "{temp: 99}"
ev "$EH._armed.thermal = true; true" >/dev/null
dset events "['wifi']"; sleep 1
echo "   events=[wifi] -> thermal ignored: $(ev "$EXT._features.find(f => f.constructor.name === 'EventHub').trigger('thermal', {c: 99})")"
dreset events; sleep 1

echo "== Super+A (GNOME's Quick Settings shortcut) opens the right island"
MODAL0="$(ev "Main.modalCount")"   # the headless shell may start with its own modal grab
echo "   baseline modalCount=$MODAL0"
echo "   toggleQuickSettings replaced: $(ev "Object.prototype.hasOwnProperty.call(Main.panel, 'toggleQuickSettings')")"
ev "Main.panel.toggleQuickSettings(); true" >/dev/null; sleep 0.9
echo "   1st press: mode=$(ev "$Q.mode") pinned=$(ev "$Q.pinned") modal grab taken=$(ev "Main.modalCount === $MODAL0 + 1") GNOME menu open=$(ev "$QSB.menu.isOpen")"
echo "   stays open without the pointer for >5 s (auto-collapse is 5 s)"
sleep 6
echo "   after 6 s: mode=$(ev "$Q.mode")"
shot qs-shortcut 1300 0 620 340
ev "Main.panel.toggleQuickSettings(); true" >/dev/null; sleep 0.9
echo "   2nd press: mode=$(ev "$Q.mode") pinned=$(ev "$Q.pinned") modal grab released=$(ev "Main.modalCount === $MODAL0")"
ev "Main.panel.toggleQuickSettings(); true" >/dev/null; sleep 0.6
ev "$Q.unpin(); $Q._maybeCollapse(); true" >/dev/null; sleep 0.9
echo "   Esc / click outside path (unpin): mode=$(ev "$Q.mode") modal released=$(ev "Main.modalCount === $MODAL0")"
dset shortcut-qs false; sleep 0.3
ev "Main.panel.toggleQuickSettings(); true" >/dev/null; sleep 0.8
echo "   shortcut-qs=false -> GNOME's own menu: open=$(ev "$QSB.menu.isOpen") island mode=$(ev "$Q.mode")"
ev "$QSB.menu.close(false); true" >/dev/null; sleep 0.4
dreset shortcut-qs; sleep 0.5
dset qs-enabled false; sleep 1
ev "Main.panel.toggleQuickSettings(); true" >/dev/null; sleep 0.8
echo "   right island off -> GNOME's own menu: open=$(ev "$QSB.menu.isOpen")"
ev "$QSB.menu.close(false); true" >/dev/null; sleep 0.4
dreset qs-enabled; sleep 1.2

echo "== keyboard: Caps Lock / Num Lock / layout indicators"
EH="$EXT._features.find(f => f.constructor.name === 'EventHub')"
echo "   keymap watched (state-changed): $(ev "$EH._ids.some(([o]) => o === global.stage.context.get_backend().get_default_seat().get_keymap())")"
for spec in "lockkey|{key: 'caps', on: true}" "lockkey|{key: 'caps', on: false}" "lockkey|{key: 'num', on: true}" "layout|{short: 'TR', name: 'Türkçe (Q)'}"; do
    kind="${spec%%|*}"; data="${spec#*|}"
    ev "$C.endActivity(); true" >/dev/null; sleep 0.3
    ok="$(ev "$EH.trigger('$kind', $data)")"; sleep 0.7
    echo "   $kind $data -> shown=$ok text='$(viewtxt "$C")'"
    case "$data" in *"'caps', on: true"*) shot event-capslock 460 0 1000 90 ;; *TR*) shot event-layout 460 0 1000 90 ;; esac
done
ev "$C.endActivity(); true" >/dev/null; sleep 0.4

echo "== meeting mode (real DND setting in the sandbox dconf)"
QSI="Main.panel.statusArea.quickSettings"
NS="org.gnome.desktop.notifications"
dnd() { gsettings get $NS show-banners; }
echo "   start: show-banners=$(dnd) flag=$(gsettings --schemadir "$HERE/$UUID/schemas" get "$SCHEMA" meeting-dnd-active)"
ev "$QSI._volumeInput.visible = true; true" >/dev/null; sleep 1
echo "   1 s after the mic starts (debounce 2 s): show-banners=$(dnd)"
sleep 2
echo "   3 s: show-banners=$(dnd) flag=$(gsettings --schemadir "$HERE/$UUID/schemas" get "$SCHEMA" meeting-dnd-active) activity=$(ev "$C.activityKey") text='$(viewtxt "$C")'"
shot event-meeting 460 0 1000 90
ev "$C.endActivity(); $QSI._volumeInput.visible = false; true" >/dev/null; sleep 6
echo "   mic released 6 s ago (restore after 10 s): show-banners=$(dnd)"
sleep 6
echo "   12 s after release: show-banners=$(dnd) flag=$(gsettings --schemadir "$HERE/$UUID/schemas" get "$SCHEMA" meeting-dnd-active) activity=$(ev "$C.activityKey") text='$(viewtxt "$C")'"
ev "$C.endActivity(); true" >/dev/null
echo "   a short mic blip (< 2 s) never triggers it:"
ev "$QSI._camera.visible = true; true" >/dev/null; sleep 1; ev "$QSI._camera.visible = false; true" >/dev/null; sleep 3
echo "      show-banners=$(dnd)"
echo "   DND already on (user's own choice) -> untouched, and never switched off by us:"
gsettings set $NS show-banners false
ev "$QSI._volumeInput.visible = true; true" >/dev/null; sleep 3
echo "      during: show-banners=$(dnd) flag=$(gsettings --schemadir "$HERE/$UUID/schemas" get "$SCHEMA" meeting-dnd-active)"
ev "$QSI._volumeInput.visible = false; true" >/dev/null; sleep 12
echo "      after:  show-banners=$(dnd) (must stay false = the user's own DND)"
gsettings set $NS show-banners true
echo "   crash recovery: flag left on by a dead session, mic idle -> restored on start"
gsettings set $NS show-banners false
dset meeting-dnd-active true
dset meeting-mode false; sleep 0.8; dset meeting-mode true; sleep 1.5
echo "      show-banners=$(dnd) flag=$(gsettings --schemadir "$HERE/$UUID/schemas" get "$SCHEMA" meeting-dnd-active)"
echo "   disabling mid-call restores DND immediately:"
ev "$QSI._volumeInput.visible = true; true" >/dev/null; sleep 3
echo "      in call: show-banners=$(dnd)"
dset meeting-mode false; sleep 1
echo "      meeting-mode=false: show-banners=$(dnd)"
ev "$QSI._volumeInput.visible = false; true" >/dev/null
dreset meeting-mode; sleep 1

echo "== auto power saver (decisions only: a fake power-profiles service, the real one is never touched)"
APS="$EXT._features.find(f => f.constructor.name === 'AutoPowerSaver')"
ev "global._ppdCalls = []; $APS._ppd = {get_cached_property: () => null, call: (m, p) => { global._ppdCalls.push(m + JSON.stringify(p.deepUnpack())); return Promise.resolve(new (imports.gi.GLib.Variant)('(u)', [42])); }}; true" >/dev/null
ev "$C.endActivity(); true" >/dev/null
ev "$APS._evaluate({state: 2, pct: 45, present: true}); true" >/dev/null; sleep 0.3
echo "   discharging at 45% (limit 20) -> nothing: calls=$(ev "JSON.stringify(global._ppdCalls)") holding=$(ev "$APS.holding")"
ev "$APS._evaluate({state: 2, pct: 19, present: true}); true" >/dev/null; sleep 0.8
echo "   discharging at 19% -> hold: calls=$(ev "JSON.stringify(global._ppdCalls)") holding=$(ev "$APS.holding") text='$(viewtxt "$C")'"
shot event-powersaver 460 0 1000 90
ev "$APS._evaluate({state: 2, pct: 18, present: true}); true" >/dev/null; sleep 0.3
echo "   still discharging at 18% -> no second hold: calls=$(ev "global._ppdCalls.length")"
ev "$C.endActivity(); $APS._evaluate({state: 1, pct: 18, present: true}); true" >/dev/null; sleep 0.8
echo "   charger plugged in -> release: calls=$(ev "JSON.stringify(global._ppdCalls)") holding=$(ev "$APS.holding") text='$(viewtxt "$C")'"
ev "global._ppdCalls = []; $C.endActivity(); $APS._suppressed = true; $APS._evaluate({state: 2, pct: 10, present: true}); true" >/dev/null; sleep 0.3
echo "   user overrode the hold (suppressed) -> no new hold: calls=$(ev "global._ppdCalls.length")"
ev "$APS._evaluate({state: 1, pct: 10, present: true}); $APS._evaluate({state: 2, pct: 10, present: true}); true" >/dev/null; sleep 0.5
echo "   after charging, suppression is cleared -> holds again: calls=$(ev "JSON.stringify(global._ppdCalls)")"
ev "$APS._evaluate({state: 1, pct: 12, present: true}); true" >/dev/null; sleep 0.3
ev "$C.endActivity(); true" >/dev/null
dset auto-power-saver false; sleep 1; dreset auto-power-saver; sleep 1

echo "== disk activity indicator (statistics island)"
DK="$ST._modules.find(m => m.constructor.id === 'disk')"
echo "   disk is in the pill list: $(ev "JSON.stringify($ST._compactModules.map(m => m.constructor.id))") sampler ran: $(ev "$DK._io._prev !== null") hidden while idle: $(ev "!$DK._compact.visible")"
PILL0="$(ev "$ST._compactW")"   # the pill itself (the toast has its own, larger size)
ev "$DK._setActive(true, {readBps: 104857600, writeBps: 94371840, moved: 0}); true" >/dev/null; sleep 1
echo "   big transfer starts: compact visible=$(ev "$DK._compact.visible") label='$(ev "$DK._rate.text")' toast=$(ev "$ST.activityKey") '$(viewtxt "$ST")' pill width $PILL0 -> $(ev "$ST._compactW")"
shot diskio-start 0 0 760 90
echo "   tile shows live speeds while active: '$(ev "$DK._tile._sub.text")'"
sleep 3.6
ev "$DK._setActive(false, {readBps: 0, writeBps: 0, moved: 13314398617}); true" >/dev/null; sleep 1
echo "   transfer ends: compact visible=$(ev "$DK._compact.visible") toast '$(viewtxt "$ST")' pill width back to $(ev "$ST._compactW") (was $PILL0)"
shot diskio-end 0 0 760 90
sleep 3.6
echo "   tile back to capacity: '$(ev "$DK._tile._sub.text")'"

echo "== themes"
for th in midnight sunset forest rose ink; do
    dset theme $th; sleep 1.2
    echo "   $th: accent=$(ev "$C._cfg.accent") body=$(ev "$C._bg.get_style().match(/background-color: (#[0-9a-f]+)/)[1]") outline=$(ev "$C._bg.get_style().match(/border-color: ([^;]+)/)[1]")"
    case "$th" in
        midnight|sunset|rose)
            ev "$C._hold(true); $C._setMode('expanded'); true" >/dev/null; sleep 1.2
            shot theme-$th 460 0 1000 330
            ev "$C._hold(false); $C._setMode('compact'); true" >/dev/null; sleep 0.6 ;;
    esac
done
dset theme midnight; sleep 1
ev "$C.actor.hover = true; true" >/dev/null; sleep 0.5
echo "   hover brightens the outline: $(ev "$C._bg.get_style().match(/border-color: ([^;]+)/)[1]")"
ev "$C.actor.hover = false; true" >/dev/null; sleep 0.8
dset accent-color "'#ff8800'"; sleep 1.2
echo "   own accent overrides the theme's: $(ev "$C._cfg.accent")"
dreset accent-color; dreset theme; sleep 1.2
echo "   reset: theme body=$(ev "$C._bg.get_style().match(/background-color: (#[0-9a-f]+)/)[1]") accent=$(ev "$C._cfg.accent")"

echo "== features off -> plain GNOME"
dset osd-enabled false; dset notification-preview false; sleep 0.8
echo "   osd patched=$(ev "Object.prototype.hasOwnProperty.call(Main.osdWindowManager, 'showAll')") trayTranslation=$(ev "Main.messageTray.translation_y")"
dreset osd-enabled; dreset notification-preview; sleep 0.8
echo "   back on: features=$(ev "$EXT._features.length")"

echo "== live settings"
dset hover-expand-delay 300; sleep 0.8
echo "   hover-expand-delay=300 -> $(ev "$C._cfg.hoverDelay")"
dset stats-compact-modules "['cpu', 'temp', 'net', 'battery']"; sleep 3
echo "   stats pill metrics: $(ev "JSON.stringify($ST._compactRow.get_children().map(c => c.get_children().map(x => x.text ?? '').join(' ').trim()))")"
shot stats-metrics 0 0 600 60
dreset hover-expand-delay; dreset stats-compact-modules; sleep 0.8
dset stats-enabled false; sleep 1
echo "   stats-enabled=false -> islands=$(ev "$ISL.length") Activities button back: opacity=$(ev "$ACT.container.opacity") w==natural: $(ev "$ACT.container.width === $ACT.container.get_preferred_width(-1)[1]")"
dreset stats-enabled; sleep 1

echo "== $CYCLES disable/enable cycles"
echo "   before: $(ev "$COUNTS")"
for i in $(seq 1 "$CYCLES"); do
    gnome-extensions disable "$UUID"; sleep 0.3
    gnome-extensions enable  "$UUID"; sleep 0.5
done
sleep 3
gnome-extensions info "$UUID" | grep -E "State"
echo "   after:  $(ev "$COUNTS")"
gnome-extensions disable "$UUID"; sleep 1
echo "== disabled"
echo "   chrome: $(ev "JSON.stringify({uiGroup: Main.layoutManager.uiGroup.get_n_children(), tracked: Main.layoutManager._trackedActors.length})")"
echo "   slots restored: $(ev "$SLOTS")"
echo "   osd restored=$(ev "!Object.prototype.hasOwnProperty.call(Main.osdWindowManager, 'showAll')") tray restored=$(ev "Main.messageTray.translation_y === 0 && Main.messageTray.opacity === 255") shortcut restored=$(ev "!Object.prototype.hasOwnProperty.call(Main.panel, 'toggleQuickSettings')") modal released=$(ev "Main.modalCount === $MODAL0")"
shot disabled 560 0 1360 60

kill $SHELL_PID; wait $SHELL_PID 2>/dev/null
