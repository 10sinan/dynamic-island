#!/usr/bin/env python3
"""python3 tests/claudehook.test.py"""
import importlib.machinery
import importlib.util
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.realpath(__file__))
HOOK = os.path.join(HERE, "..", "tools", "di-claude-hook")
loader = importlib.machinery.SourceFileLoader("hook", HOOK)
spec = importlib.util.spec_from_loader("hook", loader)
hook = importlib.util.module_from_spec(spec)
loader.exec_module(hook)

fails = 0


def ok(cond, msg):
    global fails
    if not cond:
        fails += 1
        print("FAIL", msg)


a = hook.build_args({"hook_event_name": "Stop", "cwd": "/home/x/projects/dynamic-island/"}, [10, 5])
ok(a and a[-5:] == ["done", "dynamic-island", "", "10,5", ""], f"Stop -> done: {a}")
a = hook.build_args({"hook_event_name": "UserPromptSubmit", "cwd": "/p/app", "session_id": "abc"}, [7])
ok(a and a[-5:] == ["working", "app", "", "7", "abc"], f"UserPromptSubmit -> working: {a}")
a = hook.build_args({"hook_event_name": "Notification", "cwd": "/p/app",
                     "message": "Claude needs your permission to use Bash"}, [])
ok(a and a[-5:] == ["waiting", "app", "Claude needs your permission to use Bash", "", ""], f"Notification: {a}")
ok(hook.build_args({"hook_event_name": "PreToolUse"}, []) is None, "other events ignored")
ok("--timeout" in hook.build_args({"hook_event_name": "Stop", "cwd": "/a"}, []), "short D-Bus timeout")
ok(hook.ancestors()[0] == os.getpid() and len(hook.ancestors()) >= 2, "ancestors start with this process")

# never fails Claude: garbage input, no shell listening -> exit 0, fast
for data in ["not json", "[1,2]", "", '{"hook_event_name":"Stop","cwd":"/tmp"}']:
    env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS="unix:path=/nonexistent")
    r = subprocess.run([sys.executable, HOOK], input=data, text=True, capture_output=True, timeout=5, env=env)
    ok(r.returncode == 0 and not r.stdout, f"exit 0 for {data!r}: {r.returncode} {r.stdout!r}")

print(f"{fails} FAILED" if fails else "claudehook ok")
sys.exit(1 if fails else 0)
