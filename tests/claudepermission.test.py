#!/usr/bin/env python3
"""python3 tests/claudepermission.test.py — the PermissionRequest hook path."""
import importlib.machinery
import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile

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


# ---- pure pieces
ok(hook.summarize("Bash", {"command": "ls -la\n  /tmp"}) == "ls -la /tmp", "newlines collapsed")
long = hook.summarize("Bash", {"command": "x" * 300})
ok(len(long) == 120 and long.endswith("…"), "long commands are cut with an ellipsis, not hidden")
ok(hook.summarize("Edit", {"file_path": "/a/b.py", "new_string": "SECRET"}) == "/a/b.py", "only the path for edits")
ok(hook.summarize("Mystery", {"x": 1}) == "", "unknown tools: no guess")
ok(hook.parse_gdbus_string("('allow',)\n") == "allow", "parse gdbus reply")

a = hook.build_permission_args({"hook_event_name": "PermissionRequest", "tool_name": "Bash",
                                "tool_input": {"command": "rm x"}, "cwd": "/p/app", "session_id": "s"}, [9, 4])
ok(a and a[-5:] == ["app", "Bash", "rm x", "9,4", "s"] and "ClaudePermission" in a[a.index("--method") + 1],
   f"permission args: {a}")
ok(hook.build_permission_args({"hook_event_name": "Stop"}, []) is None, "other events: no permission call")

# the decision output: only a clear allow/deny prints anything
for answer in ["ask", "", "garbage", "ALLOW", "allow ", None, "yes", "true", "1"]:
    ok(hook.decision_output(answer) is None, f"{answer!r} must not decide anything")
d = json.loads(hook.decision_output("allow"))
ok(d == {"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}}, f"allow json {d}")
d = json.loads(hook.decision_output("deny"))
ok(d["hookSpecificOutput"]["decision"]["behavior"] == "deny" and d["hookSpecificOutput"]["decision"]["message"], "deny json")

# ---- whole script with a fake gdbus on PATH
def run(fake_body, payload=None):
    with tempfile.TemporaryDirectory() as tmp:
        g = os.path.join(tmp, "gdbus")
        with open(g, "w") as f:
            f.write("#!/bin/sh\n" + fake_body + "\n")
        os.chmod(g, os.stat(g).st_mode | stat.S_IEXEC)
        env = dict(os.environ, PATH=tmp + os.pathsep + os.environ["PATH"])
        data = json.dumps(payload or {"hook_event_name": "PermissionRequest", "tool_name": "Bash",
                                      "tool_input": {"command": "ls"}, "cwd": "/p/app"})
        return subprocess.run([sys.executable, HOOK], input=data, text=True, capture_output=True, timeout=10, env=env)


r = run("echo \"('allow',)\"")
ok(r.returncode == 0 and json.loads(r.stdout)["hookSpecificOutput"]["decision"]["behavior"] == "allow", f"click allow -> allow: {r.stdout!r}")
r = run("echo \"('deny',)\"")
ok(r.returncode == 0 and json.loads(r.stdout)["hookSpecificOutput"]["decision"]["behavior"] == "deny", "click deny -> deny")
for body, label in [("echo \"('ask',)\"", "ask"), ("echo 'garbage'", "garbage"), ("exit 1", "gdbus failed"),
                    ("echo \"('allow',)\"; exit 3", "allow but failed exit")]:
    r = run(body)
    ok(r.returncode == 0 and r.stdout == "", f"{label}: prints nothing (normal dialog), exit 0: {r.stdout!r}")
# island not running: real gdbus on a bus without the shell
env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS="unix:path=/nonexistent")
r = subprocess.run([sys.executable, HOOK], input=json.dumps({"hook_event_name": "PermissionRequest", "tool_name": "Bash", "cwd": "/x"}),
                   text=True, capture_output=True, timeout=10, env=env)
ok(r.returncode == 0 and r.stdout == "", f"no island -> nothing printed: {r.stdout!r} {r.returncode}")
# broken input
for data in ["not json", "", "[]"]:
    r = subprocess.run([sys.executable, HOOK], input=data, text=True, capture_output=True, timeout=10)
    ok(r.returncode == 0 and r.stdout == "", f"bad input {data!r} -> nothing")

print(f"{fails} FAILED" if fails else "claudepermission ok")
sys.exit(1 if fails else 0)
