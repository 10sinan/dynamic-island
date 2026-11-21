#!/usr/bin/env python3
"""python3 tests/diconfig.test.py — `di-config claude-hooks` keeps settings.json private.

Works on a temporary copy only; the real ~/.claude is never touched."""
import contextlib
import importlib.machinery
import importlib.util
import io
import json
import os
import stat
import tempfile

HERE = os.path.dirname(os.path.realpath(__file__))
TOOL = os.path.join(HERE, "..", "tools", "di-config")
loader = importlib.machinery.SourceFileLoader("di_config", TOOL)
spec = importlib.util.spec_from_loader("di_config", loader)
mod = importlib.util.module_from_spec(spec)
loader.exec_module(mod)

fails = 0


def ok(cond, msg):
    global fails
    if not cond:
        fails += 1
        print("FAIL", msg)


def mode(path):
    return stat.S_IMODE(os.stat(path).st_mode)


def hooks(action):
    with contextlib.redirect_stdout(io.StringIO()):
        mod.claude_hooks(action)


with tempfile.TemporaryDirectory() as tmp:
    path = os.path.join(tmp, ".claude", "settings.json")
    mod.CLAUDE_SETTINGS = path

    # new file: private
    hooks("install")
    ok(mode(path) == 0o600, f"new settings.json is 0600, got {oct(mode(path))}")
    data = json.load(open(path, encoding="utf-8"))
    ok(set(data["hooks"]) == set(mod.HOOK_EVENTS), f"hooks installed: {list(data.get('hooks', {}))}")

    # existing file: its mode survives install and remove, other keys are kept
    for m in (0o600, 0o640, 0o644):
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"env": {"ANTHROPIC_API_KEY": "dummy-test-value"}, "model": "x"}, f)
        os.chmod(path, m)
        hooks("install")
        ok(mode(path) == m, f"install keeps {oct(m)}, got {oct(mode(path))}")
        ok(mode(path + ".bak") == m, f"backup keeps {oct(m)}")
        hooks("remove")
        ok(mode(path) == m, f"remove keeps {oct(m)}, got {oct(mode(path))}")
        d = json.load(open(path, encoding="utf-8"))
        ok(d == {"env": {"ANTHROPIC_API_KEY": "dummy-test-value"}, "model": "x"}, f"other settings kept: {d}")
    ok(not os.path.exists(path + ".tmp"), "no temp file left behind")

    # a symlink planted at the temp name is not followed
    target = os.path.join(tmp, "elsewhere")
    open(target, "w").close()
    os.symlink(target, path + ".tmp")
    try:
        hooks("install")
        ok(False, "symlinked temp file must be refused")
    except OSError:
        pass
    ok(os.path.getsize(target) == 0, "symlink target untouched")

print(f"{fails} FAILED" if fails else "diconfig ok")
raise SystemExit(1 if fails else 0)
