import {IslandModule} from './base.js';
import {Meter} from '../lib/widgets.js';
import {listDir, tryReadText, clamp01} from '../lib/proc.js';

const PS = '/sys/class/power_supply';

const STATUS_TEXT = {
    'Charging': 'charging',
    'Discharging': 'on battery',
    'Full': 'full',
    'Not charging': 'plugged in',
};

export default class BatteryModule extends IslandModule {
    static id = 'battery';

    async init() {
        this._dir = null;
        for (const name of await listDir(PS, this.cancellable).catch(() => [])) {
            const type = await tryReadText(`${PS}/${name}/type`, this.cancellable);
            // scope=Device means a peripheral (mouse, headset) — skip those.
            const scope = await tryReadText(`${PS}/${name}/scope`, this.cancellable);
            if (type === 'Battery' && scope !== 'Device') {
                this._dir = `${PS}/${name}`;
                break;
            }
        }
        this.available = this._dir !== null;
    }

    buildCompact() {
        this._compact = new Meter({accent: this.accent, title: 'BAT', compact: true});
        return this._compact.actor;
    }

    buildExpanded() {
        this._tile = new Meter({accent: this.accent, title: 'BAT'});
        return this._tile.actor;
    }

    async tick() {
        const [cap, status] = await Promise.all([
            tryReadText(`${this._dir}/capacity`, this.cancellable),
            tryReadText(`${this._dir}/status`, this.cancellable),
        ]);
        const pct = Number(cap);
        if (cap === null || !Number.isFinite(pct))
            return;

        const charging = status === 'Charging' || status === 'Full' || status === 'Not charging';
        let sev = 'ok';
        if (!charging)
            sev = pct <= 15 ? 'crit' : pct <= 30 ? 'warn' : 'ok';

        this._compact?.update(`${pct}%`, clamp01(pct / 100), sev);
        this._tile?.setTitle(status === 'Charging' ? 'BAT +' : 'BAT');
        this._tile?.update(`${pct}%`, clamp01(pct / 100), sev,
            STATUS_TEXT[status] ?? (status ?? '').toLowerCase());
    }

    destroy() {
        this._compact = null;
        this._tile = null;
        super.destroy();
    }
}
