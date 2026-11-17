// Last 60 seconds of CPU, RAM and network activity as live area graphs.
// The data comes from the cpu / ram / net modules through the island's
// shared history; this module only draws.
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {IslandModule} from '../base.js';
import {Graph} from '../../lib/graph.js';
import {formatRate} from '../../lib/proc.js';

const W = 250, H = 44;

export default class GraphModule extends IslandModule {
    static id = 'graph';
    static slot = 'main';

    _row(title, color, source, max) {
        const box = new St.BoxLayout({style_class: 'di-graph-row', orientation: Clutter.Orientation.VERTICAL});
        const head = new St.BoxLayout({style_class: 'di-graph-head'});
        head.add_child(new St.Label({style_class: 'di-section-title', text: title, x_expand: true,
            y_align: Clutter.ActorAlign.CENTER}));
        const value = new St.Label({style_class: 'di-graph-value', y_align: Clutter.ActorAlign.CENTER});
        head.add_child(value);
        const graph = new Graph({width: W, height: H, color, source, max});
        box.add_child(head);
        box.add_child(graph.actor);
        return {box, value, graph};
    }

    buildExpanded() {
        const h = this.ctx?.history;
        const box = new St.BoxLayout({style_class: 'di-graphs', orientation: Clutter.Orientation.VERTICAL});
        this._rows = {
            cpu: this._row('CPU', this.accent, () => h.series('cpu'), () => 1),
            ram: this._row('RAM', '#b48cff', () => h.series('ram'), () => 1),
            net: this._row('AĞ  ↓', '#5ab8ff', () => h.series('net-down'),
                () => Math.max(100 * 1024, ...h.series('net-down').map(s => s.v))),
        };
        for (const r of Object.values(this._rows))
            box.add_child(r.box);
        box.connect('destroy', () => {
            this._rows = null;
        });
        this.tick();
        return box;
    }

    onShown() {
        this.tick();
    }

    async tick() {
        if (!this._rows)
            return;
        const h = this.ctx?.history;
        const cpu = h?.last('cpu'), ram = h?.last('ram');
        const down = h?.last('net-down'), up = h?.last('net-up');
        this._rows.cpu.value.text = cpu === null ? '–' : `${Math.round(cpu * 100)}%`;
        this._rows.ram.value.text = ram === null ? '–' : `${Math.round(ram * 100)}%`;
        this._rows.net.value.text = down === null ? '–' : `${formatRate(down)}  ↑ ${formatRate(up ?? 0)}`;
        for (const r of Object.values(this._rows))
            r.graph.redraw();
    }

    destroy() {
        this._rows = null;
        super.destroy();
    }
}
