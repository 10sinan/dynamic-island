// Run: gjs -m tests/history.test.js
import {History} from '../dynamic-island@10sinan.github.io/lib/history.js';

let failures = 0;
const check = (name, cond, detail = '') => {
    print(`  ${cond ? 'ok  ' : 'FAIL'} ${name} ${cond ? '' : detail}`);
    if (!cond)
        failures++;
};

const h = new History(10);   // keep 10 s
for (let i = 0; i <= 20; i++)
    h.push('cpu', i / 20, i * 1000);   // 21 samples, 1 per second
check('old samples are dropped', h.series('cpu', 60, 20000).length === 11, String(h.series('cpu', 60, 20000).length));
check('series window', h.series('cpu', 5, 20000).length === 6);
const s = h.series('cpu', 5, 20000);
check('ago is relative to now, oldest first', s[0].ago === 5000 && s[s.length - 1].ago === 0, JSON.stringify(s));
check('last value', h.last('cpu') === 1);
h.push('cpu', NaN, 21000);
check('NaN ignored', h.last('cpu') === 1);
check('unknown key', h.series('x').length === 0 && h.last('x') === null);
h.clear();
check('clear', h.last('cpu') === null);

print(failures ? `\n${failures} FAILED` : '\nall passed');
if (failures)
    imports.system.exit(1);
