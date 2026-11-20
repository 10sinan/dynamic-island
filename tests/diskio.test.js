// Run: gjs -m tests/diskio.test.js
import {IoMeter, formatBytes, parseDiskstats} from '../dynamic-island@10sinan.github.io/lib/diskio.js';

let failures = 0;
const check = (name, cond, detail = '') => {
    print(`  ${cond ? 'ok  ' : 'FAIL'} ${name} ${cond ? '' : detail}`);
    if (!cond)
        failures++;
};

print('parseDiskstats');
const text = `
 259       0 nvme0n1 192237 6620 1000 251621 404327 1208 2000 1033186 0 102031 1301005 9765 0 3563168 6224 11895 9973
 259       1 nvme0n1p1 100 0 99999 0 100 0 99999 0 0 0 0 0 0 0 0 0 0
   8       0 sda 10 0 10 0 10 0 20 0 0 0 0 0 0 0 0 0 0
   7       0 loop0 5 0 5 0 5 0 5 0 0 0 0 0 0 0 0 0 0
 252       0 zram0 5 0 5 0 5 0 5 0 0 0 0 0 0 0 0 0 0
 253       0 dm-0 5 0 5 0 5 0 5 0 0 0 0 0 0 0 0 0 0
`;
const t = parseDiskstats(text);
check('whole disks only, 512-byte sectors', t.readBytes === (1000 + 10) * 512 && t.writeBytes === (2000 + 20) * 512, JSON.stringify(t));
check('empty input', parseDiskstats('').readBytes === 0);

print('IoMeter');
const MB = 1024 * 1024;
const m = new IoMeter({on: 50 * MB, off: 20 * MB, startSamples: 2, stopSamples: 3});   // explicit: the test uses its own limits
let r = 0, w = 0, now = 0;
const step = (readMb, writeMb, dt = 2) => {
    r += readMb * MB * dt; w += writeMb * MB * dt; now += dt;
    return m.push({readBytes: r, writeBytes: w}, now);
};
check('first sample is only a baseline', step(0, 0).event === null);
check('quiet disk stays idle', step(2, 1).event === null && !m.active);
check('one busy sample is not enough', step(100, 90).event === null && !m.active);
const s = step(100, 90);
check('second busy sample starts the episode', s.event === 'start' && m.active, JSON.stringify(s));
check('rates are reported (100 + 90 MB/s)', Math.round(s.readBps / MB) === 100 && Math.round(s.writeBps / MB) === 90);
check('a dip below `off` once does not end it', step(5, 5).event === null && m.active);
check('busy again resets the quiet counter', step(120, 100).event === null && step(5, 5).event === null && step(5, 5).event === null && m.active);
const e = step(5, 5);
check('three quiet samples end it', e.event === 'end' && !m.active, JSON.stringify(e));
const gb = 4 * 2 * (100 + 90) * MB / (1024 ** 3);   // rough: 4 busy samples of 2 s
check('moved bytes were counted for the whole episode (> 1 GB)', e.moved > 1024 ** 3, String(e.moved / 1024 ** 3));
check('after the end it can start again', step(100, 100).event === null && step(100, 100).event === 'start');
const c = new IoMeter();
c.push({readBytes: 1000, writeBytes: 0}, 1);
check('counter reset never gives negative rates', c.push({readBytes: 0, writeBytes: 0}, 2).readBps === 0);

print('defaults ignore everyday bursts');
const d = new IoMeter();
let dr = 0, dn = 0;
const dstep = mbps => { dr += mbps * MB * 2; dn += 2; return d.push({readBytes: dr, writeBytes: 0}, dn); };
dstep(0);
let started = false;
for (let i = 0; i < 4; i++)    // 8 s of 100 MB/s: a browser / update burst
    started ||= dstep(100).event === 'start';
check('8 s at 100 MB/s is not a large file operation', !started && !d.active);
for (let i = 0; i < 3; i++)
    dstep(5);
for (let i = 0; i < 4; i++)    // 8 s at 400 MB/s: short copy burst
    started ||= dstep(400).event === 'start';
check('8 s at 400 MB/s is still not announced', !started);
dstep(400);
check('10 s sustained at 400 MB/s is', dstep(400).event === 'start' || d.active);

print('formatBytes');
check('MB', formatBytes(860 * MB) === '860 MB', formatBytes(860 * MB));
check('GB with decimal', formatBytes(12.4 * 1024 ** 3) === '12.4 GB', formatBytes(12.4 * 1024 ** 3));
check('bytes', formatBytes(512) === '512 B');

print(failures ? `\n${failures} FAILED` : '\nall passed');
if (failures)
    imports.system.exit(1);
