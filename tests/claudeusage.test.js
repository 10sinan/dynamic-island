// gjs -m tests/claudeusage.test.js
import {parseLine, addEntry, windowStats, formatTokens, splitDuration, billable, WINDOW_MS, calibratedLimit}
    from '../dynamic-island@local/lib/claudeUsage.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; print(`FAIL ${m}`); } };
const H = 3600000;
const T0 = Date.parse('2026-11-18T08:20:00Z');

const line = (id, iso, u) => JSON.stringify({timestamp: iso, message: {id, usage: u}});

ok(parseLine('not json "usage"') === null, 'garbage ignored');
ok(parseLine('{"a":1}') === null, 'no usage ignored');
ok(parseLine(line('m1', 'bad-date', {input_tokens: 1})) === null, 'bad timestamp ignored');
const p = parseLine(line('m1', '2026-11-18T08:20:00Z',
    {input_tokens: 2, output_tokens: 300, cache_creation_input_tokens: 1000, cache_read_input_tokens: 50000}));
ok(p && p.id === 'm1' && p.t === T0 && billable(p) === 1302, `parse + billable (${p && billable(p)})`);

// the same message is logged once per content block: keep the max, count once
const by = new Map();
addEntry(by, {...p, output: 10});
addEntry(by, {...p, output: 300});
addEntry(by, {...p, output: 120});
ok(by.size === 1 && by.get('m1').output === 300, 'dedupe keeps the max per message');

const e = (t, tokens) => ({id: `x${t}`, t, input: tokens, output: 0, cacheWrite: 0, cacheRead: 0});
const today = Date.parse('2026-11-18T00:00:00Z');

let w = windowStats([e(T0, 100), e(T0 + H, 200), e(T0 + 2 * H, 300)], T0 + 3 * H, today);
ok(w.active && w.used === 600 && w.messages === 3, `one window sums (${w.used})`);
ok(w.start === Date.parse('2026-11-18T08:00:00Z') && w.end === w.start + WINDOW_MS, 'window starts on the hour, lasts 5 h');

w = windowStats([e(T0, 100), e(T0 + 6 * H, 50)], T0 + 6.5 * H, today);
ok(w.active && w.used === 50 && w.start === Date.parse('2026-11-18T14:00:00Z'), `a message after 5 h opens a new window (${w.used})`);

w = windowStats([e(T0, 100)], T0 + 6 * H, today);
ok(!w.active && w.used === 0, 'no active window once the 5 h passed');
ok(w.today === 100, 'today total still counted');

w = windowStats([], T0, today);
ok(!w.active && w.today === 0, 'no data');

ok(formatTokens(950) === '950' && formatTokens(1234) === '1.2K' && formatTokens(12400) === '12K', 'K format');
ok(formatTokens(2_500_000) === '2.5M' && formatTokens(48_000_000) === '48M', 'M format');
const d = splitDuration(2.5 * H);
ok(d.h === 2 && d.m === 30, 'duration split');
ok(splitDuration(1000).m === 1, 'rounds up to a minute');

ok(calibratedLimit(1_400_000, 7) === 20_000_000, 'calibration: 1.4M at 7% -> 20M');
ok(calibratedLimit(0, 50) === 0 && calibratedLimit(1000, 0) === 0 && calibratedLimit(1000, 120) === 0, 'calibration rejects bad input');

print(fails ? `${fails} FAILED` : 'claudeusage ok');
imports.system.exit(fails ? 1 : 0);
