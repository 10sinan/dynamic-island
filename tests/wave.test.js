// gjs -m tests/wave.test.js
import {perimeterPoints, waveOffset, perimeterLength} from '../dynamic-island@10sinan.github.io/lib/wave.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; print(`FAIL ${m}`); } };

const W = 300, H = 80, R = 26;
const pts = perimeterPoints(W, H, R, 3);
const total = perimeterLength(W, H, R);
ok(Math.abs(total - (2 * 248 + 2 * 28 + 2 * Math.PI * 26)) < 1e-6, 'perimeter length');
ok(Math.abs(pts.length - Math.round(total / 3)) <= 1, `even steps (${pts.length})`);

// every point is on the border and its normal points outwards
const cx = W / 2, cy = H / 2;
let onBorder = true, outward = true;
for (const p of pts) {
    if (p.x < -0.01 || p.x > W + 0.01 || p.y < -0.01 || p.y > H + 0.01)
        onBorder = false;
    const dot = (p.x - cx) * p.nx + (p.y - cy) * p.ny;
    if (dot <= 0)
        outward = false;
    if (Math.abs(Math.hypot(p.nx, p.ny) - 1) > 1e-6)
        outward = false;
}
ok(onBorder, 'points stay on the rectangle');
ok(outward, 'normals are unit length and point outwards');

// the loop closes: last point next to the first
const a = pts[0], b = pts[pts.length - 1];
ok(Math.hypot(a.x - b.x, a.y - b.y) < 4, 'loop closes');

// radius clamped to half the height (pill shape)
const pill = perimeterPoints(200, 28, 99, 2);
ok(pill.every(p => p.y >= -0.01 && p.y <= 28.01), 'radius clamped to h/2');

// wave: periodic and seamless at the loop end
const off0 = waveOffset(0, total, 1.3, 2, 30);
const offEnd = waveOffset(total, total, 1.3, 2, 30);
ok(Math.abs(off0 - offEnd) < 1e-9, 'whole number of waves: seamless');
ok(Math.max(...pts.map(p => Math.abs(waveOffset(p.s, total, 0.7, 2.2, 30)))) <= 2.2 + 1e-9, 'amplitude bound');
ok(perimeterPoints(0, 0, 0).length === 0, 'empty rect');

print(fails ? `${fails} FAILED` : 'wave ok');
imports.system.exit(fails ? 1 : 0);
