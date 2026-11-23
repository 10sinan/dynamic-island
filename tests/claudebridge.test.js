// Run: gjs -m tests/claudebridge.test.js
// The token bucket that keeps other processes from flooding the Claude bridge.
import {TokenBucket} from '../dynamic-island@10sinan.github.io/lib/claudeBridge.js';

let failures = 0;
const check = (name, cond) => {
    print(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
    if (!cond)
        failures++;
};

let t = 0;
const bucket = new TokenBucket(3, 2, () => t);
check('burst passes', bucket.take() && bucket.take() && bucket.take());
check('then it is limited', !bucket.take());
t += 0.5;
check('half a second refills one token (2/s)', bucket.take() && !bucket.take());
t += 100;
check('never refills past the burst', [1, 2, 3].every(() => bucket.take()) && !bucket.take());
t += 0.1;
check('a fraction of a token is not enough', !bucket.take());

print(failures ? `${failures} FAILED` : 'all passed');
if (failures)
    imports.system.exit(1);
