// Run: gjs -m tests/proc.test.js
// Pure parser tests + live async reads of /proc and /sys (no GNOME Shell needed).
import GLib from 'gi://GLib';

import {
    parseCpuStat, cpuUsage, parseMeminfo, parseNetDev, formatRate, severity, parseProcStat, topProcesses,
    readText, tryReadText, listDir, exists,
} from '../dynamic-island@10sinan.github.io/lib/proc.js';

let failures = 0;
function check(name, cond, detail = '') {
    if (cond) {
        print(`  ok   ${name}`);
    } else {
        failures++;
        print(`  FAIL ${name} ${detail}`);
    }
}

print('parsers');
const stat1 = 'cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4\n';
const stat2 = 'cpu  160 0 70 900 70 0 0 0 0 0\n';
const a = parseCpuStat(stat1), b = parseCpuStat(stat2);
check('cpu idle includes iowait', a.idle === 850 && a.total === 1000, JSON.stringify(a));
check('cpu usage delta', Math.abs(cpuUsage(a, b) - 80 / 200) < 1e-9, String(cpuUsage(a, b)));
check('cpu usage null on no delta', cpuUsage(a, a) === null);

const mem = parseMeminfo('MemTotal:       32000000 kB\nMemFree:  1000 kB\nMemAvailable:   8000000 kB\n');
check('meminfo', mem.totalKb === 32000000 && mem.availableKb === 8000000, JSON.stringify(mem));

const netdev = `Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 5000 10 0 0 0 0 0 0 5000 10 0 0 0 0 0 0
wlp3s0: 123456 100 0 0 0 0 0 0 654321 90 0 0 0 0 0 0
`;
const nd = parseNetDev(netdev);
check('netdev', nd.get('wlp3s0').rx === 123456 && nd.get('wlp3s0').tx === 654321 && nd.has('lo'));

check('formatRate B', formatRate(512) === '512 B/s', formatRate(512));
check('formatRate KB', formatRate(1536) === '1.5 KB/s', formatRate(1536));
check('formatRate MB', formatRate(25 * 1024 * 1024) === '25 MB/s', formatRate(25 * 1024 * 1024));
check('severity', severity(0.5, 0.6, 0.85) === 'ok' && severity(0.7, 0.6, 0.85) === 'warn' &&
    severity(0.9, 0.6, 0.85) === 'crit');

print('process stat');
// comm with spaces and parentheses: "(Web Content (x))"
const line = '4242 (Web Content (x)) S 1 4242 4242 0 -1 4194560 100 0 0 0 150 50 0 0 20 0 5 0 12345 1000000 2500 18446744073709551615';
const ps = parseProcStat(line);
check('comm with spaces/parens', ps?.comm === 'Web Content (x)' && ps.pid === 4242, JSON.stringify(ps));
check('ticks = utime + stime', ps?.ticks === 200, JSON.stringify(ps));
check('rss pages', ps?.rssPages === 2500, JSON.stringify(ps));
check('garbage -> null', parseProcStat('nonsense') === null);

const mk = (pid, comm, ticks, rss) => [pid, {pid, comm, ticks, rssPages: rss}];
const before = new Map([mk(1, 'chrome', 1000, 100), mk(2, 'chrome', 500, 100), mk(3, 'gjs', 10, 50)]);
const after = new Map([mk(1, 'chrome', 1100, 100), mk(2, 'chrome', 600, 100), mk(3, 'gjs', 10, 50), mk(4, 'chrome', 0, 100)]);
const top = topProcesses(before, after, 1);   // 1 s: chrome used 200 ticks = 2 s of CPU = 200 %
check('same-name processes merge', top.cpu[0].name === 'chrome' && Math.round(top.cpu[0].cpu) === 200, JSON.stringify(top.cpu));
check('idle processes are not listed', !top.cpu.some(g => g.name === 'gjs'), JSON.stringify(top.cpu));
check('memory ranking', top.mem[0].name === 'chrome' && top.mem[0].memKb === 3 * 100 * 4, JSON.stringify(top.mem));

print('live async reads');
const loop = new GLib.MainLoop(null, false);
(async () => {
    try {
        const s = parseCpuStat(await readText('/proc/stat'));
        check('read /proc/stat', s.total > 0);
        const m = parseMeminfo(await readText('/proc/meminfo'));
        check('read /proc/meminfo', m.totalKb > 0, JSON.stringify(m));
        const n = parseNetDev(await readText('/proc/net/dev'));
        check('read /proc/net/dev', n.size > 0, [...n.keys()].join(','));

        const hw = await listDir('/sys/class/hwmon');
        const names = [];
        for (const d of hw)
            names.push(await tryReadText(`/sys/class/hwmon/${d}/name`));
        check('list hwmon', hw.length > 0, names.join(','));
        print(`       hwmon: ${names.join(', ')}`);

        const physical = [];
        for (const i of await listDir('/sys/class/net')) {
            if (await exists(`/sys/class/net/${i}/device`))
                physical.push(i);
        }
        check('physical NICs found', physical.length > 0);
        print(`       physical NICs: ${physical.join(', ')}`);

        const ps = [];
        for (const p of await listDir('/sys/class/power_supply'))
            ps.push(`${p}=${await tryReadText(`/sys/class/power_supply/${p}/type`)}`);
        print(`       power_supply: ${ps.join(', ')}`);

        const proc = [];
        for (const pid of (await listDir('/proc')).filter(n => /^\d+$/.test(n)).slice(0, 40)) {
            const t = await tryReadText(`/proc/${pid}/stat`);
            const p = t && parseProcStat(t);
            if (p)
                proc.push(p);
        }
        check('live /proc/<pid>/stat parses', proc.length > 10 && proc.every(p => p.comm.length > 0), String(proc.length));

        check('tryReadText missing -> null', await tryReadText('/nonexistent/x') === null);
    } catch (e) {
        failures++;
        print(`  FAIL exception ${e}\n${e.stack}`);
    } finally {
        loop.quit();
    }
})();
loop.run();

print(failures ? `\n${failures} FAILED` : '\nall passed');
if (failures)
    imports.system.exit(1);
