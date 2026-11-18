// Top applications by CPU and by memory. Processes with the same name are
// merged (a browser is dozens of processes). Reads /proc/<pid>/stat
// asynchronously in small batches, only while the island is open.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {IslandModule} from '../base.js';
import {_} from '../../lib/i18n.js';
import {listDir, tryReadText, parseProcStat, topProcesses} from '../../lib/proc.js';

const BATCH = 24;
const ROWS = 3;

function mem(kb) {
    return kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`;
}

export default class ProcsModule extends IslandModule {
    static id = 'procs';
    static slot = 'main';

    async init() {
        this._prev = new Map();
        this._prevAt = 0;
    }

    _column(title) {
        const col = new St.BoxLayout({style_class: 'di-procs-col', orientation: Clutter.Orientation.VERTICAL,
            x_expand: true});
        col.add_child(new St.Label({style_class: 'di-section-title', text: title}));
        const rows = [];
        for (let i = 0; i < ROWS; i++) {
            const row = new St.BoxLayout({style_class: 'di-proc-row'});
            const name = new St.Label({style_class: 'di-proc-name', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            const value = new St.Label({style_class: 'di-proc-value', y_align: Clutter.ActorAlign.CENTER});
            row.add_child(name);
            row.add_child(value);
            col.add_child(row);
            rows.push({row, name, value});
        }
        return {col, rows};
    }

    buildExpanded() {
        const box = new St.BoxLayout({style_class: 'di-procs'});
        this._cpu = this._column(_('TOP CPU'));
        this._mem = this._column(_('TOP MEMORY'));
        box.add_child(this._cpu.col);
        box.add_child(this._mem.col);
        box.connect('destroy', () => {
            this._cpu = this._mem = null;
        });
        return box;
    }

    async _snapshot() {
        const pids = (await listDir('/proc', this.cancellable)).filter(n => /^\d+$/.test(n));
        const out = new Map();
        for (let i = 0; i < pids.length; i += BATCH) {
            const texts = await Promise.all(pids.slice(i, i + BATCH)
                .map(pid => tryReadText(`/proc/${pid}/stat`, this.cancellable)));
            for (const t of texts) {
                const p = t ? parseProcStat(t) : null;
                if (p)
                    out.set(p.pid, p);
            }
        }
        return out;
    }

    _fill(column, items, valueOf) {
        column.rows.forEach((r, i) => {
            const it = items[i];
            r.row.opacity = it ? 255 : 0;
            if (!it)
                return;
            if (r.name.text !== it.name)
                r.name.text = it.name;
            const v = valueOf(it);
            if (r.value.text !== v)
                r.value.text = v;
        });
    }

    async tick() {
        if (!this._cpu)
            return;
        const cur = await this._snapshot();
        const now = GLib.get_monotonic_time() / 1e6;
        const dt = this._prevAt ? now - this._prevAt : 0;
        const top = topProcesses(this._prev, cur, dt);
        this._prev = cur;
        this._prevAt = now;
        if (!this._cpu)
            return;
        this._fill(this._cpu, top.cpu, g => `${Math.round(g.cpu)}%`);
        this._fill(this._mem, top.mem, g => mem(g.memKb));
    }

    onShown() {
        // The first sample after opening has no baseline; take one right away.
        this._prevAt = 0;
        this.tick().catch(() => {});
    }

    destroy() {
        this._cpu = this._mem = null;
        this._prev = null;
        super.destroy();
    }
}
