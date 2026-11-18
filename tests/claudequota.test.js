// gjs -m tests/claudequota.test.js
import {parseQuota, untilReset, readToken} from '../dynamic-island@local/lib/claudeQuota.js';

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

print(fails ? `${fails} FAILED` : 'claudequota ok');
imports.system.exit(fails ? 1 : 0);
