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

# --- secrets are masked before anything leaves the hook (D-Bus -> window, logs) ---
M = "*****"
SECRET_CASES = [
    # (what the tool was asked to run, the secret in it, what must stay readable)
    ('curl -H "Authorization: Bearer abc123def456" https://x.io', "abc123def456", 'curl -H "Authorization: Bearer *****" https://x.io'),
    ("curl -H 'Authorization: Basic dXNlcjpwYXNz' x", "dXNlcjpwYXNz", "curl -H 'Authorization: Basic *****' x"),
    ("Authorization: token ghx12345678", "ghx12345678", "Authorization: token *****"),
    ("echo Bearer abcdefgh12345", "abcdefgh12345", "echo Bearer *****"),
    ("mysql --password hunter2 -u root", "hunter2", "mysql --password ***** -u root"),
    ("mysql --password=hunter2 -u root", "hunter2", "mysql --password=***** -u root"),
    ("tool --token abc123 --verbose", "abc123", "tool --token ***** --verbose"),
    ("tool --token=abc123 --verbose", "abc123", "tool --token=***** --verbose"),
    ("tool --api-key K3Y --x", "K3Y", "tool --api-key ***** --x"),
    ("tool --secret 's p a c e' go", "s p a c e", "tool --secret ***** go"),
    ("login user password=s3cret&user=bob", "s3cret", "login user password=*****&user=bob"),
    ("export DB_PASSWORD=hunter2 && run", "hunter2", "export DB_PASSWORD=***** && run"),
    ("export GITHUB_TOKEN=abc123 && run", "abc123", "export GITHUB_TOKEN=***** && run"),
    ('curl -H "x-api-key: KEY123456" u', "KEY123456", 'curl -H "x-api-key: *****" u'),
    ("api_key: sup3rs3cr3t", "sup3rs3cr3t", "api_key: *****"),
    ("api key = sup3rs3cr3t", "sup3rs3cr3t", "api key = *****"),
    ("git clone https://bob:pw123@github.com/a/b", "pw123", "git clone https://bob:*****@github.com/a/b"),
    ("curl -u bob:pw123 x", "pw123", "curl -u bob:***** x"),
    ("echo sk-ant-api03-abcdefghijkl-XYZ done", "sk-ant-api03-abcdefghijkl-XYZ", "echo ***** done"),
    ("echo sk-abcdefghijklmnopqrstuvwx done", "sk-abcdefghijklmnopqrstuvwx", "echo ***** done"),
    ("aws s3 ls # AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE", "aws s3 ls # *****"),
    ("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "aws_secret_access_key = *****"),
    ("git push https://x:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/a/b", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", None),
    ("echo ghp_abcdefghijklmnopqrstuvwxyz0123456789 | gh auth login", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "echo ***** | gh auth login"),
    ("echo github_pat_11ABCDEFG0abcdefghijklmnop_xyz", "github_pat_11ABCDEFG0abcdefghijklmnop_xyz", "echo *****"),
    ("echo xoxb-1234567890-abcdefghij", "xoxb-1234567890-abcdefghij", "echo *****"),
]
for cmd, secret, want in SECRET_CASES:
    got = hook.redact(cmd)
    ok(secret not in got, f"secret removed from {cmd!r}: {got!r}")
    ok(M in got, f"masked: {cmd!r}")
    if want is not None:
        ok(got == want, f"rest stays readable: {got!r} != {want!r}")
    # the same through the code paths that feed D-Bus
    ok(secret not in hook.summarize("Bash", {"command": cmd}), f"summarize: {cmd!r}")
    pa = hook.build_permission_args({"hook_event_name": "PermissionRequest", "cwd": "/p/app", "tool_name": "Bash",
                                     "tool_input": {"command": cmd}}, [1])
    ok(pa is None or not any(secret in a for a in pa), f"permission args: {cmd!r}")
    ba = hook.build_args({"hook_event_name": "Notification", "cwd": "/p/app", "message": cmd}, [])
    ok(not any(secret in a for a in ba), f"notification args: {cmd!r}")

# values are masked even when the 120-character cut would have split them
long_cmd = "x" * 100 + " --token abcdefghijklmnopqrstuvwxyz0123456789"
ok("abcdefghij" not in hook.summarize("Bash", {"command": long_cmd}), "secret not half-shown by the cut")
# project name (a directory) and tool name are masked too
ok("hunter2" not in " ".join(hook.build_args({"hook_event_name": "Stop", "cwd": "/home/x/password=hunter2"}, [])), "cwd")

# ordinary commands are not touched
for cmd in ["ls -la /tmp && git status", "git log --oneline -n 20", "npm run build --max-old-space-size=4096",
            'grep -rn "token" src/', 'git commit -m "fix token refresh"', "cat README.md | head -n 20",
            'python3 -c "print(1)"', "ssh -i ~/.ssh/id_rsa host", "echo $PASSWORD", "claude --max-tokens=100",
            "docker run -p 8080:80 -e MODE=prod nginx", "pip install requests==2.31.0", "curl -s https://example.com/api?page=2",
            "git diff HEAD~1 -- src/lib/token.js", "tail -f /var/log/auth.log", "echo 'Bearer of bad news'",
            "sed -i 's/foo/bar/' file.txt", "make -j8 CFLAGS=-O2"]:
    ok(hook.redact(cmd) == cmd, f"ordinary command unchanged: {cmd!r} -> {hook.redact(cmd)!r}")
    ok(hook.summarize("Bash", {"command": cmd}) == " ".join(cmd.split()), f"summarize unchanged: {cmd!r}")
ok(hook.redact(hook.redact("a --token abc")) == hook.redact("a --token abc"), "masking twice changes nothing")

# never fails Claude: garbage input, no shell listening -> exit 0, fast
for data in ["not json", "[1,2]", "", '{"hook_event_name":"Stop","cwd":"/tmp"}']:
    env = dict(os.environ, DBUS_SESSION_BUS_ADDRESS="unix:path=/nonexistent")
    r = subprocess.run([sys.executable, HOOK], input=data, text=True, capture_output=True, timeout=5, env=env)
    ok(r.returncode == 0 and not r.stdout, f"exit 0 for {data!r}: {r.returncode} {r.stdout!r}")

print(f"{fails} FAILED" if fails else "claudehook ok")
sys.exit(1 if fails else 0)
