#!/usr/bin/env python3
"""Drive the di-config curses UI in a pseudo-terminal with scripted keys,
dump the screen, and check that settings were written.

Run inside a throw-away dconf (never touches your real settings):
    XDG_CONFIG_HOME=$(mktemp -d) dbus-run-session -- python3 -I tests/tui.test.py
"""
import curses
import importlib.machinery
import importlib.util
import os
import pty
import struct
import fcntl
import sys
import termios

HERE = os.path.dirname(os.path.abspath(__file__))
TOOL = os.path.join(HERE, "..", "tools", "di-config")
DUMP = os.environ.get("DUMP", "/dev/stdout")

# Keys: go to "Zamanlama" (2), hover delay +2 steps, down, leave delay -1 step,
# tab to "Orta modüller", move 2nd module (ram) up with K, toggle "temp" off,
# put "temp" on panel with p, back to "Görünüm" (3) next colour, quit.
KEYS = ["2", curses.KEY_RIGHT, curses.KEY_RIGHT, curses.KEY_DOWN, curses.KEY_LEFT,
        "__dump__",
        "5", curses.KEY_DOWN, "K", curses.KEY_DOWN, curses.KEY_DOWN, " ", "p",
        "__dump__",
        "7", curses.KEY_DOWN, " ",
        "__dump__",
        "3", curses.KEY_RIGHT,
        "__dump__",
        "q"]


def child():
    os.environ["TERM"] = "xterm-256color"
    loader = importlib.machinery.SourceFileLoader("di_config", TOOL)
    spec = importlib.util.spec_from_loader("di_config", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    settings, schema = mod.open_settings()

    def run(scr):
        app = mod.App(scr, settings, schema)
        keys = iter(KEYS)
        dumps = []

        def fake_get_wch():
            k = next(keys)
            while k == "__dump__":
                app.draw()
                h, w = scr.getmaxyx()
                dumps.append("\n".join(scr.instr(y, 0, w).decode(errors="replace").rstrip()
                                       for y in range(h)))
                k = next(keys)
            return k
        app.scr = _Proxy(scr, fake_get_wch)
        app.run()
        return dumps

    dumps = curses.wrapper(run)
    with open(DUMP, "w") as f:
        for i, d in enumerate(dumps):
            f.write(f"\n===== screen {i + 1} =====\n{d}\n")
        f.write("\n===== settings =====\n")
        for k in ("hover-expand-delay", "leave-collapse-delay", "stats-modules",
                  "stats-compact-modules", "events", "accent-color"):
            f.write(f"{k} = {settings.get_value(k).print_(False)}\n")


class _Proxy:
    def __init__(self, scr, get_wch):
        self._scr, self.get_wch = scr, get_wch

    def __getattr__(self, name):
        return getattr(self._scr, name)


if __name__ == "__main__":
    pid, fd = pty.fork()
    if pid == 0:
        fcntl.ioctl(sys.stdout.fileno(), termios.TIOCSWINSZ, struct.pack("HHHH", 26, 96, 0, 0))
        try:
            child()
        except Exception as e:  # report to the parent through the dump file
            with open(DUMP, "a") as f:
                f.write(f"CHILD ERROR: {e!r}\n")
        os._exit(0)
    # drain the pty so the child never blocks on output
    while True:
        try:
            if not os.read(fd, 65536):
                break
        except OSError:
            break
    os.waitpid(pid, 0)
