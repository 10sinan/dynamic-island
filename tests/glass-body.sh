#!/usr/bin/env bash
# Liquid glass checks. Run inside the private session of tests/headless-smoke.sh:
#   BODY=tests/glass-body.sh tests/headless-smoke.sh 10 /some/shots
set -u

ev() {
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
        --method org.gnome.Shell.Eval "$1" 2>&1 |
        sed -E "s/^\(true, //; s/\)$//; s/\\\\//g; s/^'\"?//; s/\"?'$//"
}
shot() {
    [ -n "$SHOTS" ] || return 0
    gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell/Screenshot \
        --method org.gnome.Shell.Screenshot.ScreenshotArea "$2" "$3" "$4" "$5" false "$SHOTS/$1.png" >/dev/null
}
dset() { gsettings --schemadir "$HERE/$UUID/schemas" set "$SCHEMA" "$@"; }
EXT='Main.extensionManager.lookup("'"$UUID"'").stateObj'
ISL="$EXT._islands"
C="$ISL.find(i => i._id === 'center')"

gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "['$HELPER', '$UUID']"
gnome-shell --headless --wayland --wayland-display=di-wl-test --no-x11 --virtual-monitor 1920x1080 > "$SANDBOX/shell.log" 2>&1 &
SHELL_PID=$!
for i in $(seq 1 60); do
    gnome-extensions info "$UUID" 2>/dev/null | grep -q "State: ACTIVE\|State: ERROR" && break
    sleep 0.5
done
ev "Main.overview.hide()" >/dev/null
sleep 4

rebuilt() { sleep 1.2; }   # settings changes rebuild the islands after a 150 ms debounce
# every effect attached to one of the island's actors
FX="[$C._bg, $C._rim, $C.actor, $C._root, $C._content, $C._compactBox, $C._expandedBox, $C._activityBox].filter(a => a).flatMap(a => a.get_effects?.() ?? []).length"

echo "== defaults: glass is OFF"
echo "   liquidGlass=$(ev "$C._cfg.liquidGlass") blur=$(ev "$C._cfg.liquidGlassBlur") rim=$(ev "!!$C._rim") effects=$(ev "$FX")"
shot glass-off-compact 560 0 800 60

echo "== liquid-glass on (style only)"
dset liquid-glass true; rebuilt
echo "   rim=$(ev "!!$C._rim") bgStyle=$(ev "$C._bg.get_style()")"
echo "   rimStyle=$(ev "$C._rim.get_style()")"
echo "   rim box=$(ev "JSON.stringify([$C._rim.x,$C._rim.y,$C._rim.width,$C._rim.height])") bg box=$(ev "JSON.stringify([$C._bg.x,$C._bg.y,$C._bg.width,$C._bg.height])")"
shot glass-on-compact 560 0 800 60
ev "$C.actor.hover = true; true" >/dev/null; sleep 1.5
echo "   hover: mode=$(ev "$C.mode") rim=$(ev "JSON.stringify([$C._rim.x,$C._rim.y,$C._rim.width,$C._rim.height])") bg=$(ev "JSON.stringify([$C._bg.x,$C._bg.y,$C._bg.width,$C._bg.height])")"
shot glass-on-expanded 460 0 1000 420
ev "$C.actor.hover = false; true" >/dev/null; sleep 1

echo "== backdrop blur only while open"
dset liquid-glass true; dset liquid-glass-blur true; rebuilt
BL="$C._bg.get_effect('di-glass-blur')"
echo "   compact: blur effect=$(ev "!!$BL")"
ev "$C.actor.hover = true; true" >/dev/null; sleep 1.5
echo "   expanded: mode=$(ev "$C.mode") blur effect=$(ev "!!$BL") type=$(ev "$BL?.constructor?.name")"
shot glass-blur-expanded 460 0 1000 420
ev "$C.actor.hover = false; true" >/dev/null; sleep 1.5
echo "   collapsed again: mode=$(ev "$C.mode") blur effect=$(ev "!!$BL") (expect false)"

echo "== effects leak check: off -> on(+blur, opened) -> off, $CYCLES cycles"
dset liquid-glass-blur false; dset liquid-glass false; rebuilt
before="$(ev "$FX")"
for i in $(seq 1 "$CYCLES"); do
    dset liquid-glass true; dset liquid-glass-blur true; rebuilt
    ev "$C.actor.hover = true; true" >/dev/null; sleep 0.8
    ev "$C.actor.hover = false; true" >/dev/null; sleep 0.6
    dset liquid-glass-blur false; dset liquid-glass false; rebuilt
done
echo "   effects before=$before after=$(ev "$FX") rim=$(ev "!!$C._rim") shadow=$(ev "!!$C._shadow") islands=$(ev "$ISL.length") uiGroup=$(ev "Main.layoutManager.uiGroup.get_n_children()") (expect same / same / false / false / 3 / same)"
echo "   shell alive: $(kill -0 $SHELL_PID && echo yes)"

if [ -n "${MEASURE:-}" ]; then
cpu() {   # percent of one core used by the shell over $1 seconds
    local t0 t1; t0=$(awk '{print $14+$15}' /proc/$SHELL_PID/stat); sleep "$1"; t1=$(awk '{print $14+$15}' /proc/$SHELL_PID/stat)
    awk -v a="$t0" -v b="$t1" -v s="$1" -v h="$(getconf CLK_TCK)" 'BEGIN{printf "%.1f", (b-a)*100/(s*h)}'
}
echo "== cost (headless shell, software GL: CPU includes the rendering, so an upper bound; real GPU not measured)"
for cfg in "off off" "on off" "on on"; do
    set -- $cfg
    dset liquid-glass "$([ $1 = on ] && echo true || echo false)"; dset liquid-glass-blur "$([ $2 = on ] && echo true || echo false)"; rebuilt; sleep 3
    idle=$(cpu 10)
    ev "$C.actor.hover = true; true" >/dev/null; sleep 1.5
    open=$(cpu 10)
    ev "$C.actor.hover = false; true" >/dev/null; sleep 1.5
    t0=$(awk '{print $14+$15}' /proc/$SHELL_PID/stat)
    for i in $(seq 1 15); do ev "$C.actor.hover = true; true" >/dev/null; sleep 0.5; ev "$C.actor.hover = false; true" >/dev/null; sleep 0.5; done
    t1=$(awk '{print $14+$15}' /proc/$SHELL_PID/stat)
    echo "   glass=$1 blur=$2: idle compact ${idle}% | idle open ${open}% | 15 hover cycles: $(( (t1 - t0) * 1000 / $(getconf CLK_TCK) )) ms CPU"
done
fi
kill $SHELL_PID 2>/dev/null
