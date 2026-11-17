// Non-blocking readers for /proc and /sys plus pure parsers.
// Parsers take plain strings so they can be unit-tested with `gjs -m`.
import Gio from 'gi://Gio';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'close_async', 'close_finish');

const decoder = new TextDecoder('utf-8');

/** Read a whole (pseudo-)file asynchronously and return it as a string. */
export async function readText(path, cancellable = null) {
    const result = await Gio.File.new_for_path(path).load_contents_async(cancellable);
    // GJS resolves with [contents, etag]; be tolerant of a leading boolean.
    const bytes = Array.isArray(result)
        ? result.find(v => v instanceof Uint8Array)
        : result;
    return decoder.decode(bytes);
}

/** Read a file and return trimmed text, or null if it cannot be read. */
export async function tryReadText(path, cancellable = null) {
    try {
        return (await readText(path, cancellable)).trim();
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            throw e;
        return null;
    }
}

/** List entry names of a directory asynchronously. */
export async function listDir(path, cancellable = null) {
    const dir = Gio.File.new_for_path(path);
    const enumerator = await dir.enumerate_children_async(
        'standard::name', Gio.FileQueryInfoFlags.NONE, 0, cancellable);
    const names = [];
    try {
        for (;;) {
            const infos = await enumerator.next_files_async(32, 0, cancellable);
            if (!infos.length)
                break;
            for (const info of infos)
                names.push(info.get_name());
        }
    } finally {
        await enumerator.close_async(0, null).catch(() => {});
    }
    return names.sort();
}

/** Asynchronous existence check (follows symlinks). */
export async function exists(path, cancellable = null) {
    try {
        await Gio.File.new_for_path(path).query_info_async(
            'standard::type', Gio.FileQueryInfoFlags.NONE, 0, cancellable);
        return true;
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            throw e;
        return false;
    }
}

const TEMP_PREFERRED = ['k10temp', 'zenpower', 'coretemp', 'cpu_thermal', 'soc_thermal', 'acpitz'];

/** Find the CPU temperature sensor: {path, label} or null. */
export async function findCpuTemp(cancellable = null) {
    const HWMON = '/sys/class/hwmon';
    const found = new Map();
    for (const dir of await listDir(HWMON, cancellable).catch(() => [])) {
        const name = await tryReadText(`${HWMON}/${dir}/name`, cancellable);
        if (name && !found.has(name))
            found.set(name, `${HWMON}/${dir}`);
    }
    for (const name of TEMP_PREFERRED) {
        const dir = found.get(name);
        if (dir && await exists(`${dir}/temp1_input`, cancellable))
            return {path: `${dir}/temp1_input`, label: name};
    }
    const zone = '/sys/class/thermal/thermal_zone0';
    if (await exists(`${zone}/temp`, cancellable))
        return {path: `${zone}/temp`, label: (await tryReadText(`${zone}/type`, cancellable)) ?? 'thermal'};
    return null;
}

// ---------------------------------------------------------------- parsers

/** /proc/stat -> aggregate CPU jiffies {idle, total}. */
export function parseCpuStat(text) {
    const line = text.split('\n').find(l => l.startsWith('cpu '));
    if (!line)
        throw new Error('no aggregate cpu line in /proc/stat');
    // user nice system idle iowait irq softirq steal [guest guest_nice]
    // guest/guest_nice are already included in user/nice, so stop at steal.
    const v = line.trim().split(/\s+/).slice(1, 9).map(Number);
    const idle = v[3] + (v[4] || 0);
    const total = v.reduce((a, b) => a + (b || 0), 0);
    return {idle, total};
}

/** Fraction of CPU busy between two parseCpuStat() samples, or null. */
export function cpuUsage(prev, cur) {
    const dTotal = cur.total - prev.total;
    const dIdle = cur.idle - prev.idle;
    if (dTotal <= 0)
        return null;
    return clamp01(1 - dIdle / dTotal);
}

/** /proc/meminfo -> {totalKb, availableKb}. */
export function parseMeminfo(text) {
    const get = key => {
        const m = text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
        return m ? Number(m[1]) : null;
    };
    const totalKb = get('MemTotal');
    let availableKb = get('MemAvailable');
    if (availableKb === null) // very old kernels
        availableKb = (get('MemFree') ?? 0) + (get('Buffers') ?? 0) + (get('Cached') ?? 0);
    if (!totalKb)
        throw new Error('MemTotal missing in /proc/meminfo');
    return {totalKb, availableKb};
}

/** /proc/net/dev -> Map(iface -> {rx, tx}) in bytes. */
export function parseNetDev(text) {
    const out = new Map();
    for (const line of text.split('\n').slice(2)) {
        const idx = line.indexOf(':');
        if (idx < 0)
            continue;
        const name = line.slice(0, idx).trim();
        const f = line.slice(idx + 1).trim().split(/\s+/).map(Number);
        out.set(name, {rx: f[0], tx: f[8]});
    }
    return out;
}

/**
 * /proc/<pid>/stat -> {pid, comm, ticks (utime+stime), rssPages}.
 * `comm` is in parentheses and may itself contain spaces and parentheses,
 * so split at the LAST ')'.
 */
export function parseProcStat(text) {
    const open = text.indexOf('(');
    const close = text.lastIndexOf(')');
    if (open < 0 || close < open)
        return null;
    const f = text.slice(close + 2).trim().split(/\s+/);   // field 3 (state) is f[0]
    const utime = Number(f[11]), stime = Number(f[12]), rss = Number(f[21]);
    if (![utime, stime, rss].every(Number.isFinite))
        return null;
    return {pid: Number(text.slice(0, open)), comm: text.slice(open + 1, close), ticks: utime + stime, rssPages: rss};
}

/** Group processes by name (a browser is dozens of processes) and rank them. */
export function topProcesses(prev, cur, dtSec, {count = 3, ticksPerSec = 100, pageKb = 4} = {}) {
    const groups = new Map();
    for (const [pid, p] of cur) {
        const g = groups.get(p.comm) ?? {name: p.comm, cpu: 0, memKb: 0};
        const before = prev.get(pid);
        if (before && dtSec > 0)
            g.cpu += Math.max(0, p.ticks - before.ticks) / ticksPerSec / dtSec * 100;   // % of one core
        g.memKb += p.rssPages * pageKb;
        groups.set(p.comm, g);
    }
    const all = [...groups.values()];
    return {
        cpu: all.filter(g => g.cpu >= 0.1).sort((a, b) => b.cpu - a.cpu).slice(0, count),
        mem: all.sort((a, b) => b.memKb - a.memKb).slice(0, count),
    };
}

// ---------------------------------------------------------------- helpers

export function clamp01(x) {
    return Math.max(0, Math.min(1, x));
}

/** Bytes/second -> short human string, e.g. "1.2 MB/s". */
export function formatRate(bps) {
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let v = Math.max(0, bps);
    let i = 0;
    while (v >= 1000 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    const digits = i === 0 || v >= 10 ? 0 : 1;
    return `${v.toFixed(digits)} ${units[i]}`;
}

/** 'ok' | 'warn' | 'crit' for a value where higher is worse. */
export function severity(value, warn, crit) {
    if (value >= crit)
        return 'crit';
    if (value >= warn)
        return 'warn';
    return 'ok';
}
