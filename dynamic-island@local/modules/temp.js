import {IslandModule} from './base.js';
import {Meter} from '../lib/widgets.js';
import {findCpuTemp, tryReadText, clamp01, severity} from '../lib/proc.js';

export default class TempModule extends IslandModule {
    static id = 'temp';

    async init() {
        const sensor = await findCpuTemp(this.cancellable);
        this._path = sensor?.path ?? null;
        this._label = sensor?.label ?? '';
        this.available = this._path !== null;
    }

    buildCompact() {
        this._compact = new Meter({accent: this.accent, title: 'TEMP', compact: true});
        return this._compact.actor;
    }

    buildExpanded() {
        this._tile = new Meter({accent: this.accent, title: 'TEMP'});
        return this._tile.actor;
    }

    async tick() {
        const raw = await tryReadText(this._path, this.cancellable);
        if (raw === null)
            return;
        const c = Number(raw) / 1000;
        if (!Number.isFinite(c))
            return;
        const text = `${Math.round(c)}°C`, frac = clamp01(c / 100), sev = severity(c, 70, 85);
        this._compact?.update(text, frac, sev);
        this._tile?.update(text, frac, sev, this._label);
    }

    destroy() {
        this._compact = null;
        this._tile = null;
        super.destroy();
    }
}
