// gjs -m tests/claudequota.test.js
import {parseQuota, untilReset, readToken, crossedThresholds} from '../dynamic-island@10sinan.github.io/lib/claudeQuota.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; print(`FAIL ${m}`); } };

const legacy = parseQuota({
    five_hour: {utilization: 4.0, resets_at: '2026-11-19T01:30:00Z'},
    seven_day: {utilization: 44.0, resets_at: '2026-11-24T02:00:00Z'},
    seven_day_opus: null,
    seven_day_sonnet: {utilization: 12.5, resets_at: '2026-11-24T02:00:00Z'},
});
ok(legacy.length === 3, `legacy rows (${legacy.length})`);
ok(legacy[0].kind === 'session' && legacy[0].percent === 4, 'five_hour -> session 4%');
ok(legacy[1].kind === 'weekly' && legacy[1].percent === 44, 'seven_day -> weekly 44%');
ok(legacy[2].kind === 'weekly-model' && legacy[2].model === 'Sonnet' && legacy[2].percent === 12.5, 'sonnet scoped');
ok(legacy[0].resetsAt === Date.parse('2026-11-19T01:30:00Z'), 'reset time parsed');

const generic = parseQuota({limits: [
    {kind: 'weekly_scoped', percent: 7, resets_at: '2026-11-24T02:00:00Z', scope: {model: {id: 'x', display_name: 'Opus'}}},
    {kind: 'session', percent: 3, resets_at: '2026-11-19T01:30:00Z'},
    {kind: 'weekly_all', percent: 40, resets_at: 'bad'},
    {kind: 'monthly_credits', percent: 1},
    'junk',
]});
ok(generic.map(r => r.kind).join(',') === 'session,weekly,weekly-model', `limits sorted: ${generic.map(r => r.kind)}`);
ok(generic[1].resetsAt === null && generic[2].model === 'Opus', 'bad date -> null, model name');
ok(parseQuota(null).length === 0 && parseQuota({}).length === 0, 'empty');
ok(parseQuota({five_hour: {utilization: 250}})[0].percent === 100, 'clamped');

const now = Date.parse('2026-11-18T20:42:00Z');
const h = untilReset(Date.parse('2026-11-19T01:30:00Z'), now);
ok(h.unit === 'h' && h.value === 4.8, `4.8 h (${JSON.stringify(h)})`);
const d = untilReset(Date.parse('2026-11-24T02:00:00Z'), now);
ok(d.unit === 'd' && d.value === 5.2, `5.2 d (${JSON.stringify(d)})`);
ok(untilReset(now + 30 * 60e3, now).unit === 'min', 'minutes');

ok(readToken('{"claudeAiOauth":{"accessToken":"t","expiresAt":9999999999999}}', now)?.expired === false, 'valid token');
ok(readToken('{"claudeAiOauth":{"accessToken":"t","expiresAt":1}}', now)?.expired === true, 'expired token');
ok(readToken('nope', now) === null && readToken('{}', now) === null, 'no token');

// thresholds
const T = new Map();
const R = (kind, percent, resetsAt = 1000) => ({kind, percent, resetsAt});
ok(crossedThresholds([R('session', 85)], T, true).length === 0, 'first reading only records (no pop-up at startup)');
ok(crossedThresholds([R('session', 86)], T).length === 0, 'already announced level is not repeated');
let c = crossedThresholds([R('session', 96)], T);
ok(c.length === 1 && c[0].level === 95, '95 % is a new level');
ok(crossedThresholds([R('session', 99)], T).length === 0, 'and only once');
c = crossedThresholds([R('session', 81, 2000)], T);
ok(c.length === 1 && c[0].level === 80, 'a new window (reset moved on) warns again');
c = crossedThresholds([R('session', 10, 3000), R('weekly', 81, 9)], T);
ok(c.length === 1 && c[0].row.kind === 'weekly', 'windows are tracked separately');
ok(crossedThresholds([{kind: 'weekly-model', model: 'Opus', percent: 99, resetsAt: 1}], new Map()).length === 0, 'model rows never warn');
const T2 = new Map();
crossedThresholds([R('session', 70)], T2, true);
c = crossedThresholds([R('session', 97)], T2);
ok(c.length === 1 && c[0].level === 95, 'jumping past 80 straight to 97 announces 95 once');

print(fails ? `${fails} FAILED` : 'claudequota ok');
imports.system.exit(fails ? 1 : 0);
