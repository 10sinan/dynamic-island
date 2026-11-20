// Run: gjs -m tests/color.test.js
import {accentFrom, dominantColor, hexToRgb, hslToRgb, mix, palette, rgbToHsl, roundedRgba, tintFrom, toHex} from '../dynamic-island@10sinan.github.io/lib/color.js';

let failures = 0;
const check = (name, cond, detail = '') => {
    print(`  ${cond ? 'ok  ' : 'FAIL'} ${name} ${cond ? '' : detail}`);
    if (!cond)
        failures++;
};

// 20x20 image: vivid red body, 4 px white border, RGB
function image(body, border = [255, 255, 255], size = 20, bw = 4) {
    const px = new Uint8Array(size * size * 3);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const c = x < bw || y < bw || x >= size - bw || y >= size - bw ? border : body;
            px.set(c, (y * size + x) * 3);
        }
    }
    return px;
}

const rgbClose = (a, b, tol = 3) => Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;

print('hsl round trip');
for (const c of [{r: 225, g: 45, b: 35}, {r: 30, g: 90, b: 230}, {r: 20, g: 200, b: 90}, {r: 128, g: 128, b: 128}]) {
    const {h, s, l} = rgbToHsl(c.r, c.g, c.b);
    check(`round trip ${toHex(c)}`, rgbClose(hslToRgb(h, s, l), c));
}

print('dominant colour ignores a white border');
const red = dominantColor(image([225, 45, 35]), 3, 60, 20, 20);
const hr = rgbToHsl(red.r, red.g, red.b);
check('red cover -> red', hr.h < 0.04 || hr.h > 0.96, JSON.stringify(red));
check('red cover is vivid', hr.s > 0.6, JSON.stringify(hr));
const blue = dominantColor(image([30, 90, 230]), 3, 60, 20, 20);
const hb = rgbToHsl(blue.r, blue.g, blue.b);
check('blue cover -> blue', hb.h > 0.55 && hb.h < 0.7, JSON.stringify(blue));

print('grey art stays grey');
const grey = dominantColor(image([120, 120, 120], [200, 200, 200]), 3, 60, 20, 20);
check('grey', rgbToHsl(grey.r, grey.g, grey.b).s < 0.05, JSON.stringify(grey));

print('RGBA: transparent pixels are skipped');
const rgba = new Uint8Array(4 * 4 * 4);
for (let i = 0; i < 16; i++)
    rgba.set(i < 8 ? [0, 255, 0, 0] : [225, 45, 35, 255], i * 4);
const t = dominantColor(rgba, 4, 16, 4, 4);
check('only opaque pixels count', rgbClose(t, {r: 225, g: 45, b: 35}), JSON.stringify(t));

print('accent + tint');
const acc = rgbToHsl(...Object.values(accentFrom(red)));
check('accent is bright (readable on black)', acc.l >= 0.55 && acc.l <= 0.7, JSON.stringify(acc));
check('accent keeps the hue', Math.abs(acc.h - hr.h) < 0.02 || Math.abs(acc.h - hr.h) > 0.98);
const tint = rgbToHsl(...Object.values(tintFrom(red)));
check('tint is dark', tint.l < 0.2, JSON.stringify(tint));
check('grey accent stays grey', rgbToHsl(...Object.values(accentFrom(grey))).s < 0.12);

print('palette: two distinct colours');
// half red, half blue, white border
function split(a, b, size = 20, bw = 2) {
    const px = new Uint8Array(size * size * 3);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const edge = x < bw || y < bw || x >= size - bw || y >= size - bw;
            px.set(edge ? [255, 255, 255] : x < size / 2 ? a : b, (y * size + x) * 3);
        }
    }
    return px;
}
const pal = palette(split([225, 45, 35], [30, 90, 230]), 3, 60, 20, 20);
const hp = rgbToHsl(pal.primary.r, pal.primary.g, pal.primary.b);
const hs = rgbToHsl(pal.secondary.r, pal.secondary.g, pal.secondary.b);
const isRed = h => h < 0.05 || h > 0.95, isBlue = h => h > 0.55 && h < 0.7;
check('red + blue image gives one red and one blue colour',
    (isRed(hp.h) && isBlue(hs.h)) || (isBlue(hp.h) && isRed(hs.h)), JSON.stringify(pal));

const mono = palette(split([225, 45, 35], [225, 45, 35]), 3, 60, 20, 20);
const hm = rgbToHsl(mono.primary.r, mono.primary.g, mono.primary.b);
const hn = rgbToHsl(mono.secondary.r, mono.secondary.g, mono.secondary.b);
check('single-hue image: secondary is a different shade of a nearby hue',
    isRed(hm.h) && (hn.h !== hm.h) && Math.abs(hn.h - hm.h) < 0.2, JSON.stringify(mono));

const gp = palette(split([120, 120, 120], [120, 120, 120]), 3, 60, 20, 20);
check('grey image stays low-saturation', rgbToHsl(gp.primary.r, gp.primary.g, gp.primary.b).s < 0.05 &&
    rgbToHsl(gp.secondary.r, gp.secondary.g, gp.secondary.b).s < 0.2, JSON.stringify(gp));

check('mix', JSON.stringify(mix({r: 0, g: 0, b: 0}, {r: 100, g: 200, b: 50}, 0.5)) === '{"r":50,"g":100,"b":25}');
check('hexToRgb', JSON.stringify(hexToRgb('#e12d23')) === '{"r":225,"g":45,"b":35}' && hexToRgb('nope').g === 230);

print('rounded corners');
const px = 40, rad = 12;
const solid = new Uint8Array(px * px * 3).fill(200);
const rc = roundedRgba(solid, 3, px * 3, px, rad);
const alpha = (x, y) => rc[(y * px + x) * 4 + 3];
check('RGB input gets an alpha channel (4 bytes per pixel)', rc.length === px * px * 4);
check('corner pixel is transparent', alpha(0, 0) === 0 && alpha(px - 1, 0) === 0 && alpha(0, px - 1) === 0 && alpha(px - 1, px - 1) === 0,
    [alpha(0, 0), alpha(px - 1, 0), alpha(0, px - 1), alpha(px - 1, px - 1)].join());
check('centre and edge midpoints stay opaque', alpha(20, 20) === 255 && alpha(20, 0) === 255 && alpha(0, 20) === 255 && alpha(px - 1, 20) === 255);
check('edge anti-aliasing gives partial alpha on the arc', (() => {
    let partial = 0;
    for (let i = 0; i < rad; i++)
        if (alpha(i, i) > 0 && alpha(i, i) < 255 || alpha(i, 2) > 0 && alpha(i, 2) < 255)
            partial++;
    return partial > 0;
})());
check('all four corners are symmetric', alpha(2, 3) === alpha(px - 3, 3) && alpha(2, 3) === alpha(2, px - 4) && alpha(2, 3) === alpha(px - 3, px - 4));
check('colour is untouched', rc[(20 * px + 20) * 4] === 200);
const withAlpha = new Uint8Array(px * px * 4).fill(128);
check('existing alpha is respected', roundedRgba(withAlpha, 4, px * 4, px, rad)[(20 * px + 20) * 4 + 3] === 128);
check('radius larger than half the size is clamped', roundedRgba(solid, 3, px * 3, px, 999)[(20 * px + 20) * 4 + 3] === 255);

print(failures ? `\n${failures} FAILED` : '\nall passed');
if (failures)
    imports.system.exit(1);
