// Disk throughput from /proc/diskstats, and a small state machine that tells
// "a big file operation is running" from normal background I/O.
// Pure JS: unit-tested with gjs.

/** Whole disks only (partitions would be counted twice; loop/dm/zram are not hardware). */
const WHOLE_DISK = /^(nvme\d+n\d+|sd[a-z]+|vd[a-z]+|xvd[a-z]+|mmcblk\d+)$/;
const SECTOR = 512;   // /proc/diskstats always counts 512-byte sectors

/** /proc/diskstats -> {readBytes, writeBytes}, summed over whole disks. */
export function parseDiskstats(text) {
    let read = 0, write = 0;
    for (const line of text.split('\n')) {
        const f = line.trim().split(/\s+/);
        // major minor name reads rmerged rsectors rms writes wmerged wsectors ...
        if (f.length < 10 || !WHOLE_DISK.test(f[2]))
            continue;
        read += Number(f[5]) * SECTOR;
        write += Number(f[9]) * SECTOR;
    }
    return {readBytes: read, writeBytes: write};
}

export class IoMeter {
    /**
     * @param {object} o
     * @param {number} o.on            B/s (read + write) that counts as "busy"
     * @param {number} o.off           B/s below which it counts as "quiet"
     * @param {number} o.startSamples  busy samples in a row before announcing
     * @param {number} o.stopSamples   quiet samples in a row before declaring it finished
     */
    // Defaults are strict on purpose: browsers, package updates, compilers and
    // indexers easily hit 50-100 MB/s for a few seconds on an NVMe disk. A "large
    // file operation" is a *sustained* ~150 MB/s or more (samples are 2 s apart,
    // so 5 samples = about 10 s).
    constructor({on = 150e6, off = 40e6, startSamples = 5, stopSamples = 3} = {}) {
        this._o = {on, off, startSamples, stopSamples};
        this._prev = null;
        this.active = false;
        this._hot = 0;
        this._cold = 0;
        this._moved = 0;       // bytes moved during the current busy period
    }

    /**
     * Feed one sample. `totals` is parseDiskstats() output, `t` seconds.
     * @returns {{event: 'start'|'end'|null, active: boolean, readBps: number,
     *            writeBps: number, moved: number}}
     */
    push(totals, t) {
        const prev = this._prev;
        this._prev = {...totals, t};
        const idle = {event: null, active: this.active, readBps: 0, writeBps: 0, moved: this._moved};
        if (!prev || t <= prev.t)
            return idle;

        const dt = t - prev.t;
        // counters can reset (device removed / re-added): never go negative
        const readBps = Math.max(0, totals.readBytes - prev.readBytes) / dt;
        const writeBps = Math.max(0, totals.writeBytes - prev.writeBytes) / dt;
        const bps = readBps + writeBps;
        const out = {event: null, active: this.active, readBps, writeBps, moved: this._moved};
        const {on, off, startSamples, stopSamples} = this._o;

        if (!this.active) {
            if (bps >= on) {
                this._hot++;
                this._moved += bps * dt;
            } else {
                this._hot = 0;
                this._moved = 0;
            }
            if (this._hot >= startSamples) {
                this.active = true;
                this._cold = 0;
                out.event = 'start';
            }
        } else {
            this._moved += bps * dt;
            if (bps < off) {
                this._cold++;
            } else {
                this._cold = 0;
            }
            if (this._cold >= stopSamples) {
                this.active = false;
                this._hot = 0;
                out.event = 'end';
                out.moved = this._moved;
                this._moved = 0;
            }
        }
        out.active = this.active;
        if (out.event !== 'end')
            out.moved = this._moved;
        return out;
    }
}

/** 1536 -> "1.5 KB", 12.4e9 -> "11.5 GB" */
export function formatBytes(b) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = Math.max(0, b), i = 0;
    while (v >= 1000 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(i === 0 || v >= 100 ? 0 : 1)} ${units[i]}`;
}
