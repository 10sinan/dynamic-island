#!/usr/bin/env bash
# Isolated smoke test: starts a headless GNOME Shell on its own D-Bus session,
# with a throw-away dconf database and an extensions dir that contains ONLY
# this extension (+ a tiny test-only helper that enables unsafe mode so the
# test can call org.gnome.Shell.Eval and take screenshots).
# Your real session, settings and other extensions are untouched.
#
# Usage: tests/headless-smoke.sh [cycles] [screenshot-dir]
# The checks themselves are in tests/smoke-body.sh.
set -u
export CYCLES="${1:-10}"
export SHOTS="${2:-}"
export HERE="$(cd "$(dirname "$0")/.." && pwd)"
export UUID="dynamic-island@10sinan.github.io"
export HELPER="di-test-helper@local"
export SCHEMA="org.gnome.shell.extensions.dynamic-island"
export SANDBOX="$(mktemp -d -t di-smoke-XXXXXX)"
[ -n "${KEEP:-}" ] || trap 'rm -rf "$SANDBOX"' EXIT

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

dbus-run-session -- bash "$HERE/tests/smoke-body.sh" 2>&1 |
    grep -vE "^dbus-daemon|^$|WARNING \*\*|goa-daemon|libgoaidentity|discover_other_daemon|fusermount|Gdk-Message|bus can.t be made|calendar-server|portal"

echo "== extension log lines"
grep -E "dynamic-island|JS ERROR|JS WARNING|already disposed|CRITICAL" "$SANDBOX/shell.log" |
    grep -v "modules ready\|not available on this system" | sort | uniq -c | head -40
echo "== total log lines: $(wc -l < "$SANDBOX/shell.log")"
# `if`, not `&&`: with DI_LOG unset a bare `[ ... ] && ...` made the whole script exit 1
if [ -n "${DI_LOG:-}" ]; then
    grep -n -B3 -A1 "CRITICAL" "$SANDBOX/shell.log" | head -60
fi
