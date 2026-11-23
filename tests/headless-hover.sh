#!/usr/bin/env bash
# Hover flicker scenarios (headless GNOME Shell, private session, only this extension).
#
# A headless shell has no real pointer crossing events, so this models them: the
# "pointer" is a point, and hover is true while it lies inside the hit box's CURRENT
# rectangle, re-evaluated on every move and on every hit-box resize (that feedback is
# where flicker comes from). It checks counts of mode switches, not frame smoothness
# (a headless shell renders ~12 fps; judge smoothness by eye).
#
#   A  hand jitter: pointer strays 6 px outside the open pill's bottom edge and back
#      (300 / 450 / 700 ms periods)               -> must not collapse at all
#   B  brush-by: pointer crosses the compact pill for 40 ms  -> must not open
#   C  a real visit (400 ms)                      -> must open
#   D  deliberate excursions 14 px outside (450 ms period) -> at most 4 mode switches in 4 s
#      (before the hysteresis: 18)
#
# Usage: tests/headless-hover.sh      Exit status 0 = all scenarios behave.
set -u
export HERE="$(cd "$(dirname "$0")/.." && pwd)"
export UUID="dynamic-island@10sinan.github.io"
export HELPER="di-test-helper@local"
export SANDBOX="$(mktemp -d -t di-hover-XXXXXX)"
trap 'rm -rf "$SANDBOX"' EXIT

glib-compile-schemas "$HERE/$UUID/schemas"
EXT_DIR="$SANDBOX/data/gnome-shell/extensions"
mkdir -p "$EXT_DIR/$HELPER" "$SANDBOX/config" "$SANDBOX/cache"
ln -s "$HERE/$UUID" "$EXT_DIR/$UUID"
cat > "$EXT_DIR/$HELPER/metadata.json" <<EOF
{"uuid": "$HELPER", "name": "test helper", "description": "test only", "shell-version": ["50"]}
EOF
cat > "$EXT_DIR/$HELPER/extension.js" <<'EOF'
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
export default class H extends Extension {
    enable() { global.context.unsafe_mode = true; }
    disable() { global.context.unsafe_mode = false; }
}
EOF
export XDG_DATA_HOME="$SANDBOX/data" XDG_CONFIG_HOME="$SANDBOX/config" XDG_CACHE_HOME="$SANDBOX/cache"

dbus-run-session -- bash -c '
set -u
FAILED=0
ev() { gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1" 2>&1 | sed -E "s/^\(true, //; s/\)$//; s/\\\\//g; s/^'"'"'\"?//; s/\"?'"'"'$//"; }
EXT="Main.extensionManager.lookup(\"$UUID\").stateObj"
C="$EXT._islands.find(i => i._id === \"center\")"
expect() { # name actual wanted
    if [ "$2" = "$3" ]; then echo "  ok   $1 ($2)"; else echo "  FAIL $1: got $2, wanted $3"; FAILED=1; fi
}
at_most() { # name actual max
    if [ "$2" -le "$3" ] 2>/dev/null; then echo "  ok   $1 ($2 <= $3)"; else echo "  FAIL $1: got $2, wanted at most $3"; FAILED=1; fi
}
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "[\"$HELPER\", \"$UUID\"]"
gnome-shell --headless --wayland --wayland-display=di-wl-hover --no-x11 --virtual-monitor 1920x1080 > "$SANDBOX/shell.log" 2>&1 &
PID=$!
for i in $(seq 1 60); do gnome-extensions info "$UUID" 2>/dev/null | grep -q "State: ACTIVE\|State: ERROR" && break; sleep 0.5; done
ev "Main.overview.hide()" >/dev/null; sleep 5

ev "
const GLib = imports.gi.GLib, cc = $C;
global._p = [5, 600];
global._sync = () => { const a = cc.actor, [x, y] = global._p; const inside = x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height; if (inside !== a.hover) a.hover = inside; };
cc.actor.connect(\"notify::allocation\", () => global._sync());
global._mv = (x, y) => { global._p = [x, y]; global._sync(); };
global._rec = () => { const R = global._R = {modes: [], orig: cc._setMode.bind(cc)};
  cc._setMode = (m, a) => { if (!R.modes.length || R.modes[R.modes.length - 1] !== m) R.modes.push(m); return R.orig(m, a); }; };
global._stop = () => { cc._setMode = global._R.orig; return global._R.modes; };
global._osc = (ax, ay, bx, by, period, ms) => { let t = 0, at = false; global._mv(ax, ay);
  return GLib.timeout_add(GLib.PRIORITY_DEFAULT, period / 2, () => { t += period / 2; at = !at; at ? global._mv(bx, by) : global._mv(ax, ay); return t < ms ? GLib.SOURCE_CONTINUE : GLib.SOURCE_REMOVE; }); };
1" >/dev/null
X=$(ev "$C._rects.compact.x + Math.round($C._rects.compact.w / 2)")
Y0=$(ev "$C._rects.compact.y + Math.round($C._rects.compact.h / 2)")
park() { ev "global._mv(5, 600); 1" >/dev/null; sleep 1.8; }
open_island() { ev "global._mv($X, $Y0); 1" >/dev/null; sleep 1.6; }

echo "A  hand jitter, 6 px outside the open pill"
for P in 300 450 700; do
    park; open_island
    EB=$(ev "$C._rects.expanded.y + $C._rects.expanded.h")
    ev "global._rec(); global._osc($X, $((EB-10)), $X, $((EB+6)), $P, 4000); 1" >/dev/null; sleep 6
    expect "period $P ms: no mode switch" "$(ev "global._stop().length")" "0"
done
echo "B  brush-by, 40 ms"
park
ev "global._rec(); global._mv($X, $Y0); GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => { global._mv(5, 600); return GLib.SOURCE_REMOVE; }); 1" >/dev/null; sleep 2.5
expect "does not open" "$(ev "global._stop().length")" "0"
echo "C  a real visit"
park
ev "global._rec(); global._mv($X, $Y0); 1" >/dev/null; sleep 0.5
expect "opens" "$(ev "$C.mode")" "expanded"
ev "global._stop(); 1" >/dev/null
echo "D  deliberate excursions 14 px outside, 450 ms period"
park; open_island
EB=$(ev "$C._rects.expanded.y + $C._rects.expanded.h")
ev "global._rec(); global._osc($X, $((EB-10)), $X, $((EB+14)), 450, 4000); 1" >/dev/null; sleep 6
at_most "mode switches in 4 s (was 18)" "$(ev "global._stop().length")" 4
kill $PID; wait $PID 2>/dev/null
echo "$([ $FAILED = 0 ] && echo PASS || echo FAILED)"
exit $FAILED
' 2>&1 | grep -vE "^dbus-daemon|^$|WARNING \*\*|goa-daemon|libgoaidentity|discover_other_daemon|fusermount|Gdk-Message|bus can.t be made|calendar-server|portal" | tee "$SANDBOX/out.txt"
grep -q "^PASS" "$SANDBOX/out.txt"
