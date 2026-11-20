// Music: shows what is playing in any MPRIS player (Spotify, browsers, VLC,
// Rhythmbox, ...).
//   panel pill   cover thumbnail + animated equalizer
//   hover        card under the clock: cover, title, artist, progress (click
//                to seek), previous / play-pause / next
//   new track    short "now playing" preview
// Everything is tinted with colours taken from the cover art.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Graphene from 'gi://Graphene';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {IslandModule} from './base.js';
import {accentFrom, clamp, hexToRgb, mix, palette, roundedRgba, tintFrom, toHex} from '../lib/color.js';

const MPRIS = 'org.mpris.MediaPlayer2.';
const PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const COVER_PX = 176;            // decoded cover size (88 logical px at 2x)
const ART_CACHE = 8;
const ART_SETTLE_MS = 350;
const COLOR_GLIDE_MS = 700;   // palette change on a new cover   // wait for a late cover URL after a track change
const POPUP_MS = 4000;
const VIDEO_MAX_W = 232;   // the live window preview fits into this box
const VIDEO_MAX_H = 130;
const EQ_FLAT = 0.22;

Gio._promisify(Gio.DBusConnection.prototype, 'call', 'call_finish');
Gio._promisify(Gio.DBusProxy, 'new_for_bus', 'new_for_bus_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

/** Scale a square pixbuf to `px` and round its corners (alpha), as a new pixbuf. */
function roundedPixbuf(src, px, radius) {
    const sq = src.get_width() === px && src.get_height() === px
        ? src : src.scale_simple(px, px, GdkPixbuf.InterpType.BILINEAR);
    const rgba = roundedRgba(sq.get_pixels(), sq.get_n_channels(), sq.get_rowstride(), px, radius);
    return GdkPixbuf.Pixbuf.new_from_bytes(GLib.Bytes.new(rgba), GdkPixbuf.Colorspace.RGB, true, 8, px, px, px * 4);
}

function formatTime(us) {
    const s = Math.max(0, Math.floor(us / 1e6));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function rgbCss({r, g, b}, a = 1) {
    return a === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

function ellipsized(styleClass) {
    const l = new St.Label({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
    l.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return l;
}

// ---------------------------------------------------------------- widgets

/** Square cover with a cross-fade when the picture changes. */
class Cover {
    constructor(size, radius) {
        this._dead = false;
        this.actor = new St.Widget({
            style_class: 'di-music-cover',
            style: `border-radius: ${radius}px;`,
            layout_manager: new Clutter.BinLayout(),
            width: size,
            height: size,
            // parents stretch children by default; a cover must stay square
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            clip_to_allocation: true,
        });
        this._placeholder = new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: Math.round(size * 0.45),
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, opacity: 120});
        this._bottom = new St.Icon({icon_size: size, pivot_point: new Graphene.Point({x: 0.5, y: 0.5})});
        this._top = new St.Icon({icon_size: size, opacity: 0, pivot_point: new Graphene.Point({x: 0.5, y: 0.5})});
        this.actor.add_child(this._placeholder);
        this.actor.add_child(this._bottom);
        this.actor.add_child(this._top);
        this.actor.connect('destroy', () => {
            this._dead = true;
        });
    }

    set(pixbuf) {
        if (this._dead)
            return;
        this._top.remove_all_transitions();
        if (!pixbuf) {
            this._bottom.gicon = null;
            this._top.opacity = 0;
            this._placeholder.show();
            return;
        }
        this._placeholder.hide();
        if (!this._bottom.gicon) {
            this._bottom.gicon = pixbuf;
            this._top.opacity = 0;
            return;
        }
        // new cover zooms in over the old one, which sinks back and dims
        this._bottom.remove_all_transitions();
        this._top.gicon = pixbuf;
        this._top.opacity = 0;
        this._top.set_scale(1.14, 1.14);
        this._top.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            duration: 460,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (this._dead)
                    return;
                this._bottom.gicon = pixbuf;
                this._bottom.set_scale(1, 1);
                this._bottom.opacity = 255;
                this._top.opacity = 0;
            },
        });
        this._bottom.ease({
            scale_x: 0.9,
            scale_y: 0.9,
            opacity: 120,
            duration: 460,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }
}

/** Animated equalizer bars: each bar bounces on its own rhythm while playing. */
class Equalizer {
    constructor(height, bars = 4, width = 3) {
        this._dead = false;
        this._playing = false;
        this.actor = new St.BoxLayout({style_class: 'di-eq', y_align: Clutter.ActorAlign.CENTER});
        this._bars = [];
        for (let i = 0; i < bars; i++) {
            const bar = new St.Widget({style_class: 'di-eq-bar', width, height, y_align: Clutter.ActorAlign.END});
            bar.set_pivot_point(0.5, 1);
            bar.set_scale(1, EQ_FLAT);
            // Clutter skips animations off screen: restart this bar when it shows again
            bar.connect('notify::mapped', () => {
                if (bar.mapped && this._playing && !this._dead && !bar.get_transition('scale-y'))
                    this._kick(bar, this._gen);
            });
            this.actor.add_child(bar);
            this._bars.push(bar);
        }
        this.actor.connect('destroy', () => {
            this._dead = true;
            this._gen = (this._gen ?? 0) + 1;
        });
    }

    /** Colour the bars with a gradient from hex a (left) to hex b (right). */
    setColors(a, b = a) {
        const ca = hexToRgb(a), cb = hexToRgb(b);
        this._bars.forEach((bar, i) => {
            const t = this._bars.length > 1 ? i / (this._bars.length - 1) : 0;
            bar.set_style(`background-color: ${toHex(mix(ca, cb, t))};`);
        });
    }

    setColor(hex) {
        this.setColors(hex, hex);
    }

    /**
     * While playing, every bar keeps easing to a new random height at its own
     * random speed (not tied to the real audio: reading the sound would cost
     * far more). Clutter skips animations on actors that are not on screen, so
     * the loop runs only while mapped and restarts when the bars show again.
     */
    setPlaying(on) {
        if (this._dead || on === this._playing)
            return;
        this._playing = on;
        this._gen = (this._gen ?? 0) + 1;
        if (on) {
            this._bars.forEach(bar => this._kick(bar, this._gen));
        } else {
            this._bars.forEach(bar => {
                bar.remove_all_transitions();
                if (bar.mapped)
                    bar.ease({scale_y: EQ_FLAT, duration: 260, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
                else
                    bar.scale_y = EQ_FLAT;
            });
        }
    }

    _kick(bar, gen) {
        if (this._dead || !this._playing || gen !== this._gen)
            return;
        if (!bar.mapped)
            return;   // picked up again by the bar's notify::mapped (constructor)
        const cur = bar.scale_y;
        // mostly mid-high, sometimes a dip; never the same height twice in a row
        let target = 0.3 + Math.random() * 0.7;
        if (Math.random() < 0.18)
            target = 0.2 + Math.random() * 0.2;
        if (Math.abs(target - cur) < 0.12)
            target = cur > 0.6 ? target - 0.3 : target + 0.3;
        bar.ease({
            scale_y: Math.max(EQ_FLAT, Math.min(1, target)),
            duration: 110 + Math.random() * 230,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => this._kick(bar, gen),
        });
    }
}

// ---------------------------------------------------------------- module

export default class MusicModule extends IslandModule {
    static id = 'music';
    static slot = 'banner';

    async init() {
        // Not at module load: a failure here must only disable the music module.
        Gio._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_at_scale_async', 'new_from_stream_finish');
        this._dead = false;
        this._players = new Map();     // bus name -> {name, proxy, ids, activeAt}
        this._artCache = new Map();    // url -> Promise<{pixbuf, thumb, popup, accent, ...}|null>
        this._info = null;
        this._trackKey = null;
        this._art = null;              // current {pixbuf, accent, tint}
        this._artToken = 0;
        this._pos = 0;
        this._firstRefresh = true;
        this._bus = Gio.DBus.session;

        this._subId = this._bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _sig, params) => {
                const [name, , owner] = params.deepUnpack();
                if (!name.startsWith(MPRIS))
                    return;
                if (owner)
                    this._addPlayer(name).catch(() => {});
                else
                    this._removePlayer(name);
            });

        const res = await this._bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null, null, Gio.DBusCallFlags.NONE, 2000, this.cancellable);
        const names = res.deepUnpack()[0].filter(n => n.startsWith(MPRIS));
        await Promise.all(names.map(n => this._addPlayer(n).catch(() => {})));
    }

    // ------------------------------------------------------------ players

    async _addPlayer(name) {
        if (this._players.has(name) || this._dead)
            return;
        this._players.set(name, null);   // reserve: NameOwnerChanged may fire twice
        const proxy = await Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE,
            null, name, PATH, PLAYER_IFACE, this.cancellable);
        if (this._dead || !this._players.has(name)) {
            return;
        }
        const player = {name, proxy, ids: [], activeAt: 0, root: {}};
        try {   // who is this player? (used to find its window)
            const res = await this._bus.call(name, PATH, 'org.freedesktop.DBus.Properties', 'GetAll',
                new GLib.Variant('(s)', ['org.mpris.MediaPlayer2']), new GLib.VariantType('(a{sv})'),
                Gio.DBusCallFlags.NONE, 1000, this.cancellable);
            const props = res.get_child_value(0).recursiveUnpack();
            player.root = {identity: props.Identity, desktopEntry: props.DesktopEntry};
        } catch {
            // no root interface information: the bus name is still used
        }
        if (this._dead || !this._players.has(name))
            return;
        player.ids.push(proxy.connect('g-properties-changed', () => this._onPlayerChanged(player)));
        if (this._status(player) === 'Playing')
            player.activeAt = GLib.get_monotonic_time();
        this._players.set(name, player);
        this._refresh();
    }

    _removePlayer(name) {
        const p = this._players.get(name);
        this._players.delete(name);
        if (p) {
            for (const id of p.ids)
                p.proxy.disconnect(id);
        }
        this._refresh();
    }

    _status(p) {
        return p.proxy.get_cached_property('PlaybackStatus')?.unpack() ?? 'Stopped';
    }

    _onPlayerChanged(player) {
        if (this._status(player) === 'Playing')
            player.activeAt = Math.max(player.activeAt, GLib.get_monotonic_time());
        this._refresh();
    }

    _metadata(p) {
        const md = p.proxy.get_cached_property('Metadata')?.recursiveUnpack() ?? {};
        const artist = md['xesam:artist'];
        return {
            title: String(md['xesam:title'] ?? ''),
            artist: Array.isArray(artist) ? artist.join(', ') : String(artist ?? ''),
            album: String(md['xesam:album'] ?? ''),
            artUrl: String(md['mpris:artUrl'] ?? ''),
            length: Number(md['mpris:length'] ?? 0),
            trackId: String(md['mpris:trackid'] ?? '/'),
        };
    }

    /** Playing player first, then the one that played most recently. */
    _pick() {
        let best = null;
        for (const p of this._players.values()) {
            if (!p || !this._metadata(p).title)
                continue;
            const playing = this._status(p) === 'Playing';
            const bestPlaying = best && this._status(best) === 'Playing';
            if (!best || (playing && !bestPlaying) ||
                (playing === bestPlaying && p.activeAt > best.activeAt))
                best = p;
        }
        return best;
    }

    _prop(p, name, fallback = false) {
        return p.proxy.get_cached_property(name)?.unpack() ?? fallback;
    }

    // ------------------------------------------------------------ state -> UI

    _refresh() {
        if (this._dead)
            return;
        const p = this._pick();
        const was = !!this._info;
        if (!p) {
            this._info = null;
            this._trackKey = null;
            this._player = null;
            this._art = null;
            this._artUrl = null;
            this._clearArtTimer();
            this._applyVisibility(was);
            this.ctx?.setAccentBorder?.(null);
            this.ctx?.setBodyTint?.(null);
            return;
        }
        const md = this._metadata(p);
        const info = {
            ...md,
            name: p.name,
            status: this._status(p),
            canNext: this._prop(p, 'CanGoNext'),
            canPrev: this._prop(p, 'CanGoPrevious'),
            canSeek: this._prop(p, 'CanSeek'),
        };
        const key = `${p.name}|${md.trackId}|${md.title}|${md.artist}`;
        const changed = key !== this._trackKey;
        this._info = info;
        this._player = p;
        this._trackKey = key;

        this._applyVisibility(was);
        this._renderText(changed && was);
        this._renderStatus();
        if (changed) {
            this._skipDir = 1;
            this._pos = 0;
            this._renderProgress(true);
            // Players often send the new title first and the new cover URL a
            // moment later (still carrying the previous track's URL, or none).
            // Wait for the metadata to settle before picking the cover; a
            // later URL change is picked up below.
            const popup = !this._firstRefresh && info.status === 'Playing';
            this._firstRefresh = false;
            this._artUrl = null;
            this._dropFileArt();
            this._clearArtTimer();
            this._artTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ART_SETTLE_MS, () => {
                this._artTimer = 0;
                const url = this._info?.artUrl ?? '';
                this._artUrl = url;
                this._loadArt(url, popup);
                return GLib.SOURCE_REMOVE;
            });
        } else if (!this._artTimer && md.artUrl !== this._artUrl) {
            // cover arrived (or changed) after the track did
            this._artUrl = md.artUrl;
            this._loadArt(md.artUrl, false);
        }
        this._fetchPosition();
    }

    _applyVisibility(was) {
        const on = !!this._info;
        if (this._card)
            this._card.visible = on;
        if (this._compact)
            this._compact.visible = on;
        if (on !== was) {
            // pill width changes when the compact view appears / disappears
            this.ctx?.requestRelayout?.(true);
            this.ctx?.requestExpandedRelayout?.();
        }
        if (!on)
            this._eqs().forEach(e => e.setPlaying(false));
    }

    _eqs() {
        return [this._compactEq, this._cardEq, this._popupEq].filter(Boolean);
    }

    _renderText(slide = false) {
        const i = this._info;
        if (!i)
            return;
        // On a track change (card visible) the lines slide out and the new
        // ones slide in, one after another, in the skip direction.
        const animate = slide && this.ctx?.isExpanded?.() && this._title?.mapped;
        const dir = this._skipDir ?? 1;
        const lines = [[this._title, i.title], [this._artist, i.artist || '—'], [this._album, i.album]];
        lines.forEach(([label, text], n) => {
            if (!label || label.text === text)
                return;
            label.remove_all_transitions();
            if (!animate) {
                label.text = text;
                label.set({translation_x: 0, opacity: 255});
                return;
            }
            label.ease({
                translation_x: -18 * dir,
                opacity: 0,
                delay: n * 45,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (this._dead)
                        return;
                    label.text = text;
                    label.translation_x = 22 * dir;
                    label.ease({
                        translation_x: 0,
                        opacity: 255,
                        duration: 340,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });
                },
            });
        });
        if (this._album)
            this._album.visible = i.album.length > 0;
    }

    _renderStatus() {
        const i = this._info;
        if (!i)
            return;
        const playing = i.status === 'Playing';
        this._eqs().forEach(e => e.setPlaying(playing));
        if (this._playIcon) {
            this._playIcon.icon_name = playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
            this._prev.reactive = this._prev.can_focus = i.canPrev;
            this._prev.opacity = i.canPrev ? 255 : 90;
            this._next.reactive = this._next.can_focus = i.canNext;
            this._next.opacity = i.canNext ? 255 : 90;
        }
        if (this._track)
            this._track.reactive = i.canSeek && i.length > 0;
        if (!playing)
            this._fill?.remove_all_transitions();
        this._updateBorder();
        if (this.ctx?.isExpanded?.())
            this._cardMotion(playing);
    }

    // ------------------------------------------------------------ cover art + colours

    async _fetchBytes(url) {
        if (url.startsWith('file://')) {
            const r = await Gio.File.new_for_uri(url).load_contents_async(this.cancellable);
            return Array.isArray(r) ? r.find(v => v instanceof Uint8Array) : r;
        }
        if (/^https?:\/\//.test(url)) {
            const Soup = (await import('gi://Soup?version=3.0')).default;
            Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');
            this._soup ??= new Soup.Session({timeout: 8});
            const msg = Soup.Message.new('GET', url);
            if (!msg)
                throw new Error('bad url');
            const bytes = await this._soup.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this.cancellable);
            if (msg.status_code !== 200)
                throw new Error(`HTTP ${msg.status_code}`);
            return bytes.toArray();
        }
        throw new Error('unsupported art url');
    }

    /** -> {pixbuf, accent, tint} | null. Cached per URL. */
    _artFor(url) {
        if (!url)
            return Promise.resolve(null);
        let p = this._artCache.get(url);
        if (!p) {
            p = (async () => {
                const bytes = await this._fetchBytes(url);
                const stream = Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(bytes));
                const full = await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                    stream, 256, 256, true, this.cancellable);
                const w = full.get_width(), h = full.get_height();
                const side = Math.min(w, h);
                const square = full.new_subpixbuf((w - side) >> 1, (h - side) >> 1, side, side);
                const tiny = square.scale_simple(16, 16, GdkPixbuf.InterpType.BILINEAR);
                const pal = palette(tiny.get_pixels(), tiny.get_n_channels(), tiny.get_rowstride(), 16, 16);
                return {
                    // one picture per use, each with the corner radius of its Cover (2x scale):
                    // card 88 px / r 14, panel pill 18 px / r 6, popup 40 px / r 11
                    pixbuf: roundedPixbuf(square, COVER_PX, 28),
                    thumb: roundedPixbuf(square, 36, 12),
                    popup: roundedPixbuf(square, 80, 22),
                    accent: toHex(accentFrom(pal.primary)),
                    accent2: toHex(accentFrom(pal.secondary)),
                    tint: tintFrom(pal.primary),
                    tint2: tintFrom(pal.secondary),
                    flow1: tintFrom(pal.secondary, 0.30),
                    flow2: tintFrom(pal.primary, 0.30),
                };
            })().catch(e => {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.debug(`[dynamic-island] cover art failed (${url.slice(0, 60)}): ${e.message}`);
                this._artCache.delete(url);   // retry next time
                return null;
            });
            this._artCache.set(url, p);
            if (this._artCache.size > ART_CACHE)
                this._artCache.delete(this._artCache.keys().next().value);
        }
        return p;
    }

    _clearArtTimer() {
        if (this._artTimer) {
            GLib.source_remove(this._artTimer);
            this._artTimer = 0;
        }
    }

    /** Players (browsers, VLC) may reuse the same local file for every cover. */
    _dropFileArt() {
        for (const url of [...this._artCache.keys()]) {
            if (url.startsWith('file://'))
                this._artCache.delete(url);
        }
    }

    async _loadArt(url, popup) {
        const token = ++this._artToken;
        const art = await this._artFor(url);
        if (this._dead || token !== this._artToken)
            return;   // a newer track arrived meanwhile
        this._art = art;
        this._applyArt(art);
        if (popup && this.ctx?.config?.musicPopup && !this.ctx.isExpanded?.())
            this._showPopup();
    }

    _applyArt(art) {
        const accent = art?.accent ?? this.accent;
        const tint = art?.tint ?? {r: 28, g: 28, b: 32};
        this._cardCover?.set(art?.pixbuf ?? null);
        this._compactCover?.set(art?.thumb ?? null);
        this._popupCover?.set(art?.popup ?? null);
        this._setTint(tint);
        this._accentNow = accent;
        const target = {
            a: hexToRgb(accent),
            a2: hexToRgb(art?.accent2 ?? accent),
            f1: art?.flow1 ?? tint,
            f2: art?.flow2 ?? tint,
        };
        this._glideColors(target);
        this._updateBorder();
    }

    /** Accent, equalizer, progress, flow layers and glow glide to the new palette. */
    _glideColors(target) {
        this._colorTl?.stop();
        this._colorTl = null;
        const from = this._colorsNow;
        if (!from || !this._card?.mapped) {
            this._paintColors(target);
            return;
        }
        const tl = new Clutter.Timeline({actor: this._card, duration: COLOR_GLIDE_MS});
        tl.set_progress_mode(Clutter.AnimationMode.EASE_IN_OUT_QUAD);
        const lerp = t => Object.fromEntries(Object.keys(target).map(k => [k, mix(from[k], target[k], t)]));
        tl.connect('new-frame', () => {
            if (!this._dead)
                this._paintColors(lerp(tl.get_progress()));
        });
        tl.connect('completed', () => {
            if (this._colorTl === tl)
                this._colorTl = null;
            if (!this._dead)
                this._paintColors(target);
        });
        this._colorTl = tl;
        tl.start();
    }

    _paintColors(c) {
        this._colorsNow = c;
        const hex = toHex;
        const fade = (x, al) => `rgba(${x.r}, ${x.g}, ${x.b}, ${al})`;
        const grad = (dir, from, to) => `background-gradient-direction: ${dir}; background-gradient-start: ${from}; background-gradient-end: ${to};`;
        this._eqs().forEach(e => e.setColors(hex(c.a), hex(c.a2)));
        this._fill?.set_style(grad('horizontal', hex(c.a), hex(c.a2)));
        this._playButton?.set_style(`background-color: ${hex(c.a)};`);
        // flowing colour layers behind the content, and the glow behind the cover
        this._flowA?.set_style(grad('horizontal', fade(c.f1, 0.95), fade(c.f1, 0)));
        this._flowB?.set_style(grad('horizontal', fade(c.f2, 0), fade(c.f2, 0.95)));
        this._glow?.set_style(grad('radial', fade(c.a, 0.55), fade(c.a, 0)));
    }

    /**
     * Playing: the island takes the album colours — body gradient (primary ->
     * secondary, dark enough for white text) and a brighter outline. Paused
     * or nothing playing: back to the theme colours.
     */
    _updateBorder() {
        const playing = this._info?.status === 'Playing';
        const c = playing && this._accentNow ? hexToRgb(this._accentNow) : null;
        this.ctx?.setAccentBorder?.(c ? `rgba(${c.r}, ${c.g}, ${c.b}, 0.6)` : null);
        const art = this._art;
        this.ctx?.setBodyTint?.(playing && art?.tint ? {a: art.tint, b: art.tint2 ?? art.tint} : null);
    }

    /** Slow colour flow, glow and cover pulse: only while the card is open and playing. */
    _cardMotion(on) {
        const E = Clutter.AnimationMode.EASE_IN_OUT_SINE;
        const stop = a => a?.remove_all_transitions();
        for (const a of [this._flowA, this._flowB, this._glow, this._cardCover?.actor])
            stop(a);
        if (!this._flowA)
            return;
        if (!on) {
            this._flowA.opacity = this._flowB.opacity = 150;
            this._glow.set({opacity: 150, scale_x: 1, scale_y: 1});
            this._cardCover?.actor.set_scale(1, 1);
            return;
        }
        this._flowA.opacity = 255;
        this._flowB.opacity = 40;
        this._flowA.ease({opacity: 40, duration: 4800, mode: E, repeatCount: -1, autoReverse: true});
        this._flowB.ease({opacity: 255, duration: 4800, mode: E, repeatCount: -1, autoReverse: true});
        this._glow.set({opacity: 110, scale_x: 0.92, scale_y: 0.92});
        this._glow.ease({opacity: 230, scale_x: 1.08, scale_y: 1.08, duration: 1700, mode: E,
            repeatCount: -1, autoReverse: true});
        this._cardCover?.actor.ease({scale_x: 1.025, scale_y: 1.025, duration: 1700, mode: E,
            repeatCount: -1, autoReverse: true});
    }

    /** Cross-fade the card background to the new colour. */
    _setTint(rgb) {
        if (!this._tintNew)
            return;
        const css = `background-color: ${rgbCss(rgb)};`;
        this._tintNew.remove_all_transitions();
        this._tintNew.set_style(css);
        this._tintNew.opacity = 0;
        this._tintNew.ease({
            opacity: 255,
            duration: 650,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._dead || !this._tintOld)
                    return;
                this._tintOld.set_style(css);
                this._tintNew.opacity = 0;
            },
        });
    }

    // ------------------------------------------------------------ position / progress

    async _fetchPosition() {
        const p = this._player;
        if (!p || !this._fill)
            return;
        try {
            const res = await this._bus.call(p.name, PATH, 'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']), new GLib.VariantType('(v)'),
                Gio.DBusCallFlags.NONE, 1000, this.cancellable);
            if (this._dead || p !== this._player)
                return;
            this._pos = Number(res.get_child_value(0).get_variant().get_int64());
            this._renderProgress();
        } catch {
            // player went away or does not report a position
        }
    }

    _renderProgress(reset = false) {
        if (!this._fill)
            return;
        const i = this._info;
        const len = i?.length ?? 0;
        const hasProgress = len > 0;
        this._progressBox.visible = hasProgress;
        if (!hasProgress)
            return;
        const frac = clamp(this._pos / len, 0, 1);
        if (!Number.isFinite(frac))
            return;
        this._fill.remove_all_transitions();
        this._fill.set_scale(reset ? 0 : frac, 1);
        const t = formatTime(this._pos);
        const r = `-${formatTime(len - this._pos)}`;
        if (this._elapsed.text !== t)
            this._elapsed.text = t;
        if (this._remaining.text !== r)
            this._remaining.text = r;
        if (i.status === 'Playing' && !reset) {
            // glide to where the song will be at the next refresh
            const ms = this.ctx?.config?.pollExpanded ?? 1000;
            this._fill.ease({
                scale_x: clamp((this._pos + ms * 1000) / len, 0, 1),
                duration: ms,
                mode: Clutter.AnimationMode.LINEAR,
            });
        }
    }

    _seekFromPointer() {
        const i = this._info;
        if (!i?.canSeek || !(i.length > 0) || !this._track)
            return;
        const [px, py] = global.get_pointer();
        const [ok, x] = this._track.transform_stage_point(px, py);
        if (!ok || this._track.width <= 0)
            return;
        const pos = Math.round(clamp(x / this._track.width, 0, 1) * i.length);
        this._pos = pos;
        this._renderProgress();
        this._call('SetPosition', new GLib.Variant('(ox)', [i.trackId, pos]));
    }

    // ------------------------------------------------------------ controls

    _call(method, params = null) {
        const p = this._player;
        if (!p)
            return;
        this._bus.call(p.name, PATH, PLAYER_IFACE, method, params, null, Gio.DBusCallFlags.NONE, -1, null)
            .catch(e => console.debug(`[dynamic-island] ${method}: ${e.message}`));
    }

    // ------------------------------------------------------------ views

    buildCompact() {
        const box = new St.BoxLayout({style_class: 'di-music-compact', y_align: Clutter.ActorAlign.CENTER,
            visible: !!this._info});
        this._compactCover = new Cover(18, 6);
        this._compactEq = new Equalizer(12, 4, 2);
        box.add_child(this._compactCover.actor);
        box.add_child(this._compactEq.actor);
        this._compact = box;
        box.connect('destroy', () => {
            this._compact = this._compactCover = this._compactEq = null;
        });
        this._applyArt(this._art);
        this._renderStatus();
        return box;
    }

    buildExpanded() {
        // card = [tint layers][content]
        const card = new St.Widget({style_class: 'di-music', layout_manager: new Clutter.BinLayout(),
            x_expand: true, visible: !!this._info});
        this._tintOld = new St.Widget({style_class: 'di-music-tint', x_expand: true, y_expand: true});
        this._tintNew = new St.Widget({style_class: 'di-music-tint', x_expand: true, y_expand: true, opacity: 0});
        card.add_child(this._tintOld);
        card.add_child(this._tintNew);
        // two colour layers that slowly cross-fade: the "flowing" background
        this._flowA = new St.Widget({style_class: 'di-music-flow', x_expand: true, y_expand: true});
        this._flowB = new St.Widget({style_class: 'di-music-flow', x_expand: true, y_expand: true});
        card.add_child(this._flowA);
        card.add_child(this._flowB);

        const row = new St.BoxLayout({style_class: 'di-music-row', x_expand: true});
        this._cardCover = new Cover(88, 14);
        this._cardCover.actor.set_pivot_point(0.5, 0.5);
        // the glow lives in a 112 px square around the 88 px cover, inside the card
        const coverWrap = new St.Widget({style_class: 'di-music-coverwrap', layout_manager: new Clutter.BinLayout(),
            width: 112, height: 112, y_align: Clutter.ActorAlign.CENTER});
        this._glow = new St.Widget({style_class: 'di-music-glow', x_expand: true, y_expand: true, opacity: 150});
        this._glow.set_pivot_point(0.5, 0.5);
        coverWrap.add_child(this._glow);
        coverWrap.add_child(this._cardCover.actor);
        row.add_child(coverWrap);

        const col = new St.BoxLayout({style_class: 'di-music-col', orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_align: Clutter.ActorAlign.CENTER});

        const titleRow = new St.BoxLayout({style_class: 'di-music-titlerow'});
        this._title = ellipsized('di-music-title');
        this._title.x_expand = true;
        this._cardEq = new Equalizer(16, 5, 3);
        titleRow.add_child(this._title);
        titleRow.add_child(this._cardEq.actor);
        this._artist = ellipsized('di-music-artist');
        this._album = ellipsized('di-music-album');
        col.add_child(titleRow);
        col.add_child(this._artist);
        col.add_child(this._album);

        // progress: click to seek
        this._progressBox = new St.BoxLayout({style_class: 'di-music-progress', orientation: Clutter.Orientation.VERTICAL});
        this._track = new St.Button({style_class: 'di-music-seek', can_focus: false, x_expand: true});
        const bar = new St.Widget({style_class: 'di-music-track', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._fill = new St.Widget({style_class: 'di-music-fill'});
        this._fill.set_pivot_point(0, 0.5);
        this._fill.set_scale(0, 1);
        bar.add_child(this._fill);
        bar.connect('notify::width', () => this._fill?.set_width(bar.width));
        bar.connect('notify::height', () => this._fill?.set_height(bar.height));
        this._track.set_child(bar);
        this._track.connect('clicked', () => this._seekFromPointer());
        const times = new St.BoxLayout({style_class: 'di-music-times'});
        this._elapsed = new St.Label({style_class: 'di-music-time'});
        this._remaining = new St.Label({style_class: 'di-music-time', x_expand: true, x_align: Clutter.ActorAlign.END});
        times.add_child(this._elapsed);
        times.add_child(this._remaining);
        this._progressBox.add_child(this._track);
        this._progressBox.add_child(times);
        col.add_child(this._progressBox);

        // transport
        const controls = new St.BoxLayout({style_class: 'di-music-controls', x_align: Clutter.ActorAlign.CENTER});
        const button = (iconName, style, onClick) => {
            const icon = new St.Icon({icon_name: iconName, icon_size: 16});
            const b = new St.Button({style_class: style, child: icon, can_focus: false});
            b.connect('clicked', onClick);
            controls.add_child(b);
            return [b, icon];
        };
        [this._prev] = button('media-skip-backward-symbolic', 'di-music-btn', () => {
            this._skipDir = -1;
            this._call('Previous');
        });
        [this._playButton, this._playIcon] = button('media-playback-start-symbolic', 'di-music-btn di-music-play',
            () => this._call('PlayPause'));
        [this._next] = button('media-skip-forward-symbolic', 'di-music-btn', () => this._call('Next'));
        col.add_child(controls);

        row.add_child(col);
        card.add_child(row);
        this._card = card;
        card.connect('destroy', () => {
            this._card = this._tintOld = this._tintNew = this._cardCover = this._cardEq = null;
            this._flowA = this._flowB = this._glow = null;
            this._title = this._artist = this._album = this._fill = this._track = null;
            this._progressBox = this._elapsed = this._remaining = null;
            this._prev = this._next = this._playButton = this._playIcon = null;
        });

        this._renderText();
        this._renderStatus();
        this._applyArt(this._art);
        this._renderProgress(true);
        return card;
    }

    // ------------------------------------------------------------ "now playing" popup

    _showPopup() {
        const i = this._info;
        if (!i || !this.ctx?.showActivity)
            return;
        this.ctx.showActivity('music', {
            priority: 0,
            duration: POPUP_MS,
            build: () => this._buildPopup(),
            update: d => this._updatePopup(d),
            onEnd: () => {
                this._popupCover = this._popupEq = this._popupTitle = this._popupArtist = null;
            },
        }, {title: i.title, artist: i.artist});
    }

    _buildPopup() {
        const box = new St.BoxLayout({style_class: 'di-music-popup', y_align: Clutter.ActorAlign.CENTER});
        this._popupCover = new Cover(40, 11);
        const col = new St.BoxLayout({style_class: 'di-music-popup-text', orientation: Clutter.Orientation.VERTICAL,
            x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._popupTitle = ellipsized('di-music-title');
        this._popupArtist = ellipsized('di-music-artist');
        col.add_child(this._popupTitle);
        col.add_child(this._popupArtist);
        this._popupEq = new Equalizer(16, 5, 3);
        box.add_child(this._popupCover.actor);
        box.add_child(col);
        box.add_child(this._popupEq.actor);
        this._popupCover.set(this._art?.popup ?? null);
        this._popupEq.setColors(this._art?.accent ?? this.accent, this._art?.accent2 ?? this._art?.accent ?? this.accent);
        this._popupEq.setPlaying(this._info?.status === 'Playing');
        return box;
    }

    _updatePopup({title, artist}) {
        if (this._popupTitle)
            this._popupTitle.text = title;
        if (this._popupArtist)
            this._popupArtist.text = artist || '—';
    }

    // ------------------------------------------------------------ island hooks

    onShown() {
        this._fetchPosition();
        this._cardMotion(this._info?.status === 'Playing');
    }

    onHidden() {
        this._cardMotion(false);   // nothing animates while the card is closed
    }

    async tick() {
        if (!this._info || !this.ctx?.isExpanded?.())
            return;   // position is only needed while the card is open
        await this._fetchPosition();
    }

    destroy() {
        this._dead = true;
        this._clearArtTimer();
        this._colorTl?.stop();
        this._colorTl = null;
        this.ctx?.setAccentBorder?.(null);
        this.ctx?.setBodyTint?.(null);
        if (this._subId) {
            this._bus.signal_unsubscribe(this._subId);
            this._subId = 0;
        }
        for (const p of this._players?.values() ?? []) {
            if (!p)
                continue;
            for (const id of p.ids)
                p.proxy.disconnect(id);
        }
        this._players?.clear();
        this._artCache?.clear();
        this._soup?.abort();
        this._soup = null;
        this._player = this._info = this._art = null;
        this._card = this._compact = null;
        super.destroy();
    }
}
