// Run: gjs -m tests/claudeRealQuota.test.js
// When the real-quota service switches the feature off: at once on credential
// problems, after 3 network / server failures in a row otherwise.
import {MAX_FAILURES, RealQuota} from '../dynamic-island@10sinan.github.io/lib/claudeRealQuota.js';

let failures = 0;
const check = (name, cond) => {
    print(`  ${cond ? 'ok  ' : 'FAIL'} ${name}`);
    if (!cond)
        failures++;
};

const ROWS = [{kind: 'session', model: null, percent: 10, resetsAt: null}];
const NET = {error: 'Anthropic not reachable'};
const SERVER = {error: 'Anthropic answered', status: 503};
const AUTH = {error: 'Login expired · opening Claude Code renews it', auth: true};

/** A service whose answers come from `script`, one per request, and a clock we move by hand. */
function make(script) {
    const setting = {value: true};
    const settings = {set_boolean: (k, v) => { if (k === 'claude-real-usage') setting.value = v; }};
    let t = 1000;
    const calls = {n: 0};
    const q = new RealQuota(settings, async () => script[Math.min(calls.n++, script.length - 1)], () => t);
    return {q, setting, calls, tick: s => { t += s; }};
}

print('credential problems switch it off at once');
for (const [name, res] of [['no login / unreadable file / expired token / 401 / 403', AUTH]]) {
    const {q, setting} = make([res]);
    await q.refresh();
    check(name, setting.value === false && (await q.refresh()) === null);
}

print('network and server failures are tolerated');
{
    const {q, setting, tick} = make([NET, SERVER, NET]);
    await q.refresh(); tick(61);
    check('1st failure: still on', setting.value === true);
    await q.refresh(); tick(61);
    check('2nd failure: still on', setting.value === true);
    await q.refresh();
    check(`${MAX_FAILURES}rd failure in a row: off`, setting.value === false);
}

print('a good answer resets the count');
{
    const {q, setting, tick} = make([NET, NET, {rows: ROWS}, NET, NET, {rows: ROWS}]);
    await q.refresh(); tick(61);
    await q.refresh(); tick(61);
    const rows = await q.refresh(); tick(61);
    check('good answer after two failures returns the rows', rows?.length === 1);
    await q.refresh(); tick(61);
    await q.refresh(); tick(61);
    check('two more failures after it: still on (count restarted)', setting.value === true);
    check('a good answer again', (await q.refresh())?.length === 1);
}

print('no hammering after a failure');
{
    const {q, calls, tick} = make([NET, {rows: ROWS}]);
    await q.refresh();
    await q.refresh();
    check('a second ask within a minute does not call again', calls.n === 1);
    tick(61);
    await q.refresh();
    check('after a minute it does', calls.n === 2);
}

print('a failure keeps the last good rows');
{
    const {q, tick} = make([{rows: ROWS}, NET]);
    await q.refresh(); tick(61);
    check('still returns the older rows', (await q.refresh())?.length === 1);
}

print('one request at a time');
{
    const {q, calls} = make([{rows: ROWS}]);
    await Promise.all([q.refresh(), q.refresh(), q.refresh()]);
    check('three simultaneous asks, one request', calls.n === 1);
}

print(failures ? `${failures} FAILED` : 'all passed');
if (failures)
    imports.system.exit(1);
