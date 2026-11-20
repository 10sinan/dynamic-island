import {IslandModule} from './base.js';
import {Meter} from '../lib/widgets.js';
import {readText, parseMeminfo, severity} from '../lib/proc.js';

const GIB_IN_KB = 1024 * 1024;

export default class RamModule extends IslandModule {
    static id = 'ram';
    static background = true;

    buildCompact() {
        this._compact = new Meter({accent: this.accent, title: 'RAM', compact: true});
        return this._compact.actor;
    }

    buildExpanded() {
        this._tile = new Meter({accent: this.accent, title: 'RAM'});
        return this._tile.actor;
    }

    async tick() {
        const {totalKb, availableKb} = parseMeminfo(await readText('/proc/meminfo', this.cancellable));
        const usedKb = totalKb - availableKb;
        const frac = usedKb / totalKb;
        this.ctx?.history?.push('ram', frac);
        const text = `${Math.round(frac * 100)}%`;
        const sev = severity(frac, 0.75, 0.9);
        const sub = `${(usedKb / GIB_IN_KB).toFixed(1)}/${(totalKb / GIB_IN_KB).toFixed(0)} GB`;
        this._compact?.update(text, frac, sev);
        this._tile?.update(text, frac, sev, sub);
    }

    destroy() {
        this._compact = null;
        this._tile = null;
        super.destroy();
    }
}
