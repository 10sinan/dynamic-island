#!/usr/bin/env python3
"""A tiny fake MPRIS player for tests (private session bus only).

  fake-player.py <art-dir>

Owns org.mpris.MediaPlayer2.fakeplayer with two "tracks" whose covers are
generated PNGs (vivid red and vivid blue, both with a white border so the
colour extraction has to ignore the border). Next / Previous / PlayPause /
SetPosition behave like a real player and emit PropertiesChanged.
"""
import os
import sys
import time

import gi

gi.require_version("Gio", "2.0")
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import Gio, GLib, GdkPixbuf  # noqa: E402

ART_DIR = sys.argv[1]
IFACE = "org.mpris.MediaPlayer2.Player"
XML = """
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/><method name="Previous"/><method name="PlayPause"/>
    <method name="SetPosition"><arg direction="in" name="TrackId" type="o"/><arg direction="in" name="Position" type="x"/></method>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Position" type="x" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
  </interface>
</node>
"""


def make_cover(path, body, border=(255, 255, 255), size=96, bw=10):
    data = bytearray()
    for y in range(size):
        for x in range(size):
            edge = x < bw or y < bw or x >= size - bw or y >= size - bw
            data += bytes(border if edge else body)
    pb = GdkPixbuf.Pixbuf.new_from_bytes(GLib.Bytes.new(bytes(data)), GdkPixbuf.Colorspace.RGB,
                                         False, 8, size, size, size * 3)
    pb.savev(path, "png", [], [])


COVERS = [os.path.join(ART_DIR, "red.png"), os.path.join(ART_DIR, "blue.png")]
make_cover(COVERS[0], (225, 45, 35))
make_cover(COVERS[1], (30, 90, 230))

TRACKS = [
    {"title": "Yak", "artist": ["Aydın Kurtoğlu"], "album": "Heyecan", "len": 207_000_000, "art": COVERS[0]},
    {"title": "Mavi Gece", "artist": ["Test Sanatçı"], "album": "Okyanus", "len": 180_000_000, "art": COVERS[1]},
]


class Player:
    def __init__(self, conn):
        self.conn = conn
        self.idx = 0
        self.status = "Playing"
        self.base = 12_000_000
        self.t0 = time.monotonic()

    def position(self):
        if self.status != "Playing":
            return self.base
        return self.base + int((time.monotonic() - self.t0) * 1e6)

    def metadata(self):
        t = TRACKS[self.idx]
        return GLib.Variant("a{sv}", {
            "mpris:trackid": GLib.Variant("o", f"/fake/track/{self.idx}"),
            "mpris:length": GLib.Variant("x", t["len"]),
            "mpris:artUrl": GLib.Variant("s", "file://" + t["art"]),
            "xesam:title": GLib.Variant("s", t["title"]),
            "xesam:artist": GLib.Variant("as", t["artist"]),
            "xesam:album": GLib.Variant("s", t["album"]),
        })

    def props(self):
        return {
            "PlaybackStatus": GLib.Variant("s", self.status),
            "Metadata": self.metadata(),
            "Position": GLib.Variant("x", self.position()),
            "CanGoNext": GLib.Variant("b", True),
            "CanGoPrevious": GLib.Variant("b", True),
            "CanSeek": GLib.Variant("b", True),
            "CanControl": GLib.Variant("b", True),
        }

    def changed(self, *names):
        p = self.props()
        self.conn.emit_signal(None, "/org/mpris/MediaPlayer2", "org.freedesktop.DBus.Properties",
                              "PropertiesChanged",
                              GLib.Variant("(sa{sv}as)", (IFACE, {n: p[n] for n in names}, [])))

    def method(self, conn, sender, path, iface, name, params, invocation):
        if name in ("Next", "Previous"):
            self.idx = (self.idx + (1 if name == "Next" else -1)) % len(TRACKS)
            self.base, self.t0 = 0, time.monotonic()
            self.changed("Metadata")
        elif name == "PlayPause":
            self.base = self.position()
            self.status = "Paused" if self.status == "Playing" else "Playing"
            self.t0 = time.monotonic()
            self.changed("PlaybackStatus")
        elif name == "SetPosition":
            self.base, self.t0 = params.unpack()[1], time.monotonic()
        invocation.return_value(None)

    def get(self, conn, sender, path, iface, prop):
        return self.props()[prop]


def on_bus(conn, name):
    player = Player(conn)
    node = Gio.DBusNodeInfo.new_for_xml(XML)
    conn.register_object("/org/mpris/MediaPlayer2", node.interfaces[0], player.method, player.get, None)


Gio.bus_own_name(Gio.BusType.SESSION, "org.mpris.MediaPlayer2.fakeplayer", Gio.BusNameOwnerFlags.NONE,
                 on_bus, None, None)
GLib.MainLoop().run()
