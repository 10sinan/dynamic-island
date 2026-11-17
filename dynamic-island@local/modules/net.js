import GLib from 'gi://GLib';

import {IslandModule} from './base.js';
import {Meter} from '../lib/widgets.js';
import {readText, listDir, exists, parseNetDev, formatRate, clamp01} from '../lib/proc.js';

const SYS_NET = '/sys/class/net';
const REDISCOVER_US = 60 * GLib.USEC_PER_SEC;   // pick up hot-plugged NICs
const FULL_SCALE = 50 * 1024 * 1024;           // 50 MB/s fills the bar (log scale)

export default class NetModule extends IslandModule {
    static id = 'net';
    static background = true;

    async init() {
        await this._discover();
        this._prev = this._sum(parseNetDev(await readText('/proc/net/dev', this.cancellable)));
        this._prevTime = GLib.get_monotonic_time();
    }

    // Only interfaces backed by a device: excludes lo, docker*, br-*, veth*,
    // tun/wg VPNs (whose traffic is already counted on the physical NIC).
    async _discover() {
        const ifaces = new Set();
        for (const name of await listDir(SYS_NET, this.cancellable).catch(() => [])) {
            if (await exists(`${SYS_NET}/${name}/device`, this.cancellable))
                ifaces.add(name);
        }
        this._ifaces = ifaces;
        this._discoveredAt = GLib.get_monotonic_time();
    }

    _sum(map) {
        let rx = 0, tx = 0;
        for (const [name, v] of map) {
            if (this._ifaces.has(name)) {
                rx += v.rx;
                tx += v.tx;
            }
        }
        return {rx, tx};
    }

    buildCompact() {
        this._compact = new Meter({accent: this.accent, title: 'NET', compact: true});
        return this._compact.actor;
    }

    buildExpanded() {
        this._tile = new Meter({accent: this.accent, title: 'NET'});
        return this._tile.actor;
    }

    async tick() {
        if (GLib.get_monotonic_time() - this._discoveredAt > REDISCOVER_US)
            await this._discover();

        const cur = this._sum(parseNetDev(await readText('/proc/net/dev', this.cancellable)));
        const now = GLib.get_monotonic_time();
        const dt = (now - this._prevTime) / GLib.USEC_PER_SEC;
        const prev = this._prev;
        this._prev = cur;
        this._prevTime = now;
        if (dt <= 0)
            return;

        // Counters may go backwards when an interface disappears; clamp.
        const down = Math.max(0, (cur.rx - prev.rx) / dt);
        const up = Math.max(0, (cur.tx - prev.tx) / dt);
        this.ctx?.history?.push('net-down', down);
        this.ctx?.history?.push('net-up', up);
        const frac = clamp01(Math.log10(down + up + 1) / Math.log10(FULL_SCALE));
        this._compact?.update(`↓${formatRate(down).replace(' ', '').replace('/s', '')}`, frac, 'ok');
        this._tile?.update(`↓ ${formatRate(down)}`, frac, 'ok', `↑ ${formatRate(up)}`);
    }

    destroy() {
        this._compact = null;
        this._tile = null;
        super.destroy();
    }
}
