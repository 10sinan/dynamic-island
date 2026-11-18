// Synchronous scan of Claude Code's local session logs, for the settings
// window (calibration). The island module uses its own incremental async scan.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {WINDOW_MS, addEntry, parseLine, windowStats} from './claudeUsage.js';

/** Current 5-hour session from ~/.claude/projects (files changed in the last 6 h). */
export function currentWindowSync() {
    const root = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_home_dir(), '.claude', 'projects']));
    const now = Date.now();
    const since = now - WINDOW_MS - 3600000;
    const byId = new Map();
    const walk = (dir, depth) => {
        let en;
        try {
            en = dir.enumerate_children('standard::name,standard::type,time::modified', Gio.FileQueryInfoFlags.NONE, null);
        } catch {
            return;
        }
        let info;
        while ((info = en.next_file(null))) {
            const child = dir.get_child(info.get_name());
            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                if (depth < 4)
                    walk(child, depth + 1);
            } else if (info.get_name().endsWith('.jsonl') &&
                       info.get_attribute_uint64('time::modified') * 1000 >= since) {
                try {
                    const [, bytes] = child.load_contents(null);
                    for (const line of new TextDecoder().decode(bytes).split('\n')) {
                        const e = parseLine(line);
                        if (e && e.t >= since)
                            addEntry(byId, e);
                    }
                } catch {}
            }
        }
        en.close(null);
    };
    walk(root, 0);
    const d = new Date(now);
    return windowStats([...byId.values()], now, new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime());
}
