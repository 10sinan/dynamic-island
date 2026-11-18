// Run: gjs -m tests/glyphs.test.js   (decision functions only; drawing is checked in the shell)
import {batteryColor, volumeLevel, wifiLevel} from '../dynamic-island@local/lib/glyphLogic.js';

let failures = 0;
const check = (name, cond, detail = '') => {
    print(`  ${cond ? 'ok  ' : 'FAIL'} ${name} ${cond ? '' : detail}`);
    if (!cond)
        failures++;
};

print('wifiLevel');
check('0 / 4 -> no arcs', wifiLevel(0) === 0 && wifiLevel(4) === 0);
check('weak', wifiLevel(5) === 1 && wifiLevel(33) === 1);
check('fair', wifiLevel(34) === 2 && wifiLevel(66) === 2);
check('strong', wifiLevel(67) === 3 && wifiLevel(100) === 3);

print('volumeLevel');
check('muted or zero -> 0', volumeLevel(0.8, true) === 0 && volumeLevel(0, false) === 0);
check('1 / 2 / 3 waves', volumeLevel(0.2, false) === 1 && volumeLevel(0.5, false) === 2 && volumeLevel(0.9, false) === 3);

print('batteryColor');
const same = (a, b) => a.every((v, i) => v === b[i]);
check('white when normal', same(batteryColor(80, false), [1, 1, 1]));
check('red at 20 % and below', batteryColor(20, false)[1] < 0.4 && batteryColor(5, false)[0] === 1);
check('green while charging, even when low', batteryColor(10, true)[1] > 0.7 && batteryColor(10, true)[0] < 0.3);

print(failures ? `\n${failures} FAILED` : '\nall passed');
if (failures)
    imports.system.exit(1);
