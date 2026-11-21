// Safety checks for cover-art URLs. The URL comes from an MPRIS player
// (mpris:artUrl), i.e. from any program on the session bus or, through a
// browser's MediaSession, from a web page. It must not make the shell talk
// to the local network or read unbounded amounts of data.
import GLib from 'gi://GLib';

export const MAX_ART_BYTES = 8 * 1024 * 1024;
const CHUNK = 64 * 1024;

/** True for hosts that point at this machine or a private / link-local network. */
export function isPrivateHost(host) {
    const h = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal'))
        return true;
    const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (v4) {
        const [a, b] = [Number(v4[1]), Number(v4[2])];
        return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    }
    if (h.includes(':')) {   // IPv6 literal: only globally routable (2000::/3) addresses pass
        const m = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (m)
            return isPrivateHost(m[1]);
        return !/^[23][0-9a-f]{0,3}:/.test(h);
    }
    return /^[0-9.]+$/.test(h) || /^0x[0-9a-f]+$/.test(h);   // odd numeric forms (2130706433, 0x7f.1): refuse
}

/**
 * @returns {{kind: 'file'|'https', url: string} | null}  null = do not fetch.
 * Only file:// (checked again for type/size by the caller) and https:// to a public host.
 */
export function checkArtUrl(url) {
    if (typeof url !== 'string' || !url || url.length > 2048)
        return null;
    if (url.startsWith('file://'))
        return {kind: 'file', url};
    if (!url.startsWith('https://'))
        return null;
    let uri;
    try {
        uri = GLib.Uri.parse(url, GLib.UriFlags.NONE);
    } catch {
        return null;
    }
    if (uri.get_scheme() !== 'https' || uri.get_userinfo() || isPrivateHost(uri.get_host()))
        return null;
    return {kind: 'https', url};
}

/**
 * Read a Gio.InputStream up to `max` bytes; throws if there is more.
 * @param {Gio.InputStream} stream   needs read_bytes_async promisified by the caller
 */
export async function readCapped(stream, max, cancellable = null) {
    const parts = [];
    let total = 0;
    for (;;) {
        const chunk = await stream.read_bytes_async(CHUNK, GLib.PRIORITY_LOW, cancellable);
        const n = chunk.get_size();
        if (n === 0)
            break;
        total += n;
        if (total > max)
            throw new Error('art too large');
        parts.push(chunk.toArray());
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
        out.set(p, off);
        off += p.length;
    }
    return out;
}
