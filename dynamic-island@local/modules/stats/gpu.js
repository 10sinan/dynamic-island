// GPU load (AMD: amdgpu exposes gpu_busy_percent in sysfs). Hidden elsewhere.
import {IslandModule} from '../base.js';
import {Meter} from '../../lib/widgets.js';
import {listDir, tryReadText, clamp01, severity} from '../../lib/proc.js';

const DRM = '/sys/class/drm';

export default class GpuModule extends IslandModule {
    static id = 'gpu';

    async init() {
        this._busy = null;
        this._temp = null;
        for (const name of (await listDir(DRM, this.cancellable).catch(() => [])).filter(n => /^card\d+$/.test(n))) {
            const dev = `${DRM}/${name}/device`;
            if ((await tryReadText(`${dev}/gpu_busy_percent`, this.cancellable)) === null)
                continue;
            this._busy = `${dev}/gpu_busy_percent`;
            for (const hw of await listDir(`${dev}/hwmon`, this.cancellable).catch(() => [])) {
                if ((await tryReadText(`${dev}/hwmon/${hw}/temp1_input`, this.cancellable)) !== null) {
                    this._temp = `${dev}/hwmon/${hw}/temp1_input`;
                    break;
                }
            }
            break;
        }
        this.available = this._busy !== null;
    }

    buildExpanded() {
        this._tile = new Meter({accent: this.accent, title: 'GPU'});
        return this._tile.actor;
    }

    async tick() {
        const [busy, temp] = await Promise.all([
            tryReadText(this._busy, this.cancellable),
            this._temp ? tryReadText(this._temp, this.cancellable) : null,
        ]);
        const pct = Number(busy);
        if (busy === null || !Number.isFinite(pct))
            return;
        const frac = clamp01(pct / 100);
        const c = temp === null ? null : Number(temp) / 1000;
        this._tile?.update(`${Math.round(pct)}%`, frac, severity(frac, 0.7, 0.9),
            Number.isFinite(c) ? `${Math.round(c)}°C` : 'amdgpu');
    }

    destroy() {
        this._tile = null;
        super.destroy();
    }
}
