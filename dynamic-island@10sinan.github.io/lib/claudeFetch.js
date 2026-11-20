// One request to Anthropic for the plan quota (same data as Claude Code's
// /usage). Reads Claude Code's login token (read only, never refreshed here)
// and sends it only to api.anthropic.com.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {QUOTA_BETA, QUOTA_URL, parseQuota, readToken} from './claudeQuota.js';

/**
 * @param {{soup: object|null}} holder  keeps one Soup session between calls
 * @returns {Promise<{rows?: Array, error?: string}>}  error is an i18n key
 */
export async function fetchQuota(holder, cancellable) {
    try {
        const file = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']));
        const [bytes] = await file.load_contents_async(cancellable);
        const tok = readToken(new TextDecoder().decode(bytes), Date.now());
        if (!tok)
            return {error: 'No Claude Code login found'};
        if (tok.expired)
            return {error: 'Login expired · opening Claude Code renews it'};
        const Soup = (await import('gi://Soup?version=3.0')).default;
        Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');
        holder.soup ??= new Soup.Session({timeout: 10, user_agent: 'dynamic-island'});
        const msg = Soup.Message.new('GET', QUOTA_URL);
        msg.request_headers.append('Authorization', `Bearer ${tok.token}`);
        msg.request_headers.append('anthropic-beta', QUOTA_BETA);
        msg.request_headers.append('Content-Type', 'application/json');
        const body = await holder.soup.send_and_read_async(msg, GLib.PRIORITY_LOW, cancellable);
        if (msg.status_code === 401)
            return {error: 'Login expired · opening Claude Code renews it'};
        if (msg.status_code !== 200)
            return {error: 'Anthropic answered', status: msg.status_code};
        const rows = parseQuota(JSON.parse(new TextDecoder().decode(body.toArray())));
        return rows.length ? {rows} : {error: 'Anthropic not reachable'};
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            return {cancelled: true};
        console.debug(`[dynamic-island] claude quota: ${e.message}`);
        return {error: 'Anthropic not reachable'};
    }
}
