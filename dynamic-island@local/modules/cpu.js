import {IslandModule} from './base.js';
import {Meter} from '../lib/widgets.js';
import {readText, parseCpuStat, cpuUsage, severity} from '../lib/proc.js';

export default class CpuModule extends IslandModule {
    static id = 'cpu';
    static background = true;

    async init() {
        this._prev = parseCpuStat(await readText('/proc/stat', this.cancellable));
    }

    buildCompact() {
        this._compact = new Meter({accent: this.accent, title: 'CPU', compact: true});
        return this._compact.actor;
    }

    buildExpanded() {
        this._tile = new Meter({accent: this.accent, title: 'CPU'});
        return this._tile.actor;
    }

    async tick() {
        const cur = parseCpuStat(await readText('/proc/stat', this.cancellable));
        const usage = cpuUsage(this._prev, cur);
        this._prev = cur;
        if (usage === null)
            return;
        this.ctx?.history?.push('cpu', usage);
        const text = `${Math.round(usage * 100)}%`;
        const sev = severity(usage, 0.6, 0.85);
        this._compact?.update(text, usage, sev);
        this._tile?.update(text, usage, sev, '');
    }

    destroy() {
        this._compact = null;
        this._tile = null;
        super.destroy();
    }
}
