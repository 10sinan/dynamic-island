#!/usr/bin/env bash
# The real-quota feature must switch itself off when the login is unusable.
# Starts a headless GNOME Shell (private D-Bus session, throw-away dconf, only
# this extension) with an EMPTY home directory, turns claude-real-usage on and
# asks the service for numbers:
#   case 1  no ~/.claude/.credentials.json            -> off at once
#   case 2  a credentials file with an expired token  -> off at once (no network involved)
# Exit status 0 = both cases behave. (The 3-failure rule for network / server
# errors is covered by tests/claudeRealQuota.test.js.)
#
# Usage: tests/headless-quota-failure.sh
set -u
export HERE="$(cd "$(dirname "$0")/.." && pwd)"
export UUID="dynamic-island@10sinan.github.io"
export HELPER="di-test-helper@local"
export SCHEMA="org.gnome.shell.extensions.dynamic-island"
export SANDBOX="$(mktemp -d -t di-quota-XXXXXX)"
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
S="gsettings --schemadir $HERE/$UUID/schemas"
EXT="Main.extensionManager.lookup(\"$UUID\").stateObj"
expect() { # name actual wanted
    if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1 (got $2, wanted $3)"; FAILED=1; fi
}
gsettings set org.gnome.shell disable-user-extensions false
gsettings set org.gnome.shell enabled-extensions "[\"$HELPER\", \"$UUID\"]"

run_case() { # name  [credentials json]
    local home="$SANDBOX/home-$1"
    rm -rf "$home"; mkdir -p "$home/.claude"
    [ -n "${2:-}" ] && printf "%s" "$2" > "$home/.claude/.credentials.json"
    $S set "$SCHEMA" claude-real-usage true
    HOME="$home" gnome-shell --headless --wayland --wayland-display=di-wl-test-$1 --no-x11 --virtual-monitor 1280x720 > "$SANDBOX/shell-$1.log" 2>&1 &
    local pid=$!
    for i in $(seq 1 60); do gnome-extensions info "$UUID" 2>/dev/null | grep -q "State: ACTIVE\|State: ERROR" && break; sleep 0.5; done
    sleep 3
    echo "case: $1"
    expect "service exists while the setting is on" "$(ev "!!$EXT._quota")" "true"
    ev "$EXT._quota.refresh(); true" >/dev/null
    sleep 2
    expect "setting switched back to false" "$($S get "$SCHEMA" claude-real-usage)" "false"
    sleep 1.5
    expect "service gone after the rebuild" "$(ev "!$EXT._quota")" "true"
    expect "nothing about the token in the shell log" "$(grep -ciE "bearer|accessToken|sk-ant" "$SANDBOX/shell-$1.log")" "0"
    kill $pid; wait $pid 2>/dev/null
}

run_case nofile ""
run_case expired "{\"claudeAiOauth\": {\"accessToken\": \"test-token-not-real\", \"expiresAt\": 1000}}"
echo "$([ $FAILED = 0 ] && echo PASS || echo FAILED)"
exit $FAILED
' 2>&1 | grep -vE "^dbus-daemon|^$|WARNING \*\*|goa-daemon|libgoaidentity|discover_other_daemon|fusermount|Gdk-Message|bus can.t be made|calendar-server|portal" | tee "$SANDBOX/out.txt"
grep -q "^PASS" "$SANDBOX/out.txt"
