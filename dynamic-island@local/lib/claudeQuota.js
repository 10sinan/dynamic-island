// Claude plan quota as reported by Anthropic (the same data as Claude Code's
// /usage screen). Pure parsing + formatting, unit-tested; the request itself
// lives in modules/claude.js.
//
// Two response shapes exist:
//   legacy:  {five_hour: {utilization: 4.0, resets_at}, seven_day: {...},
//             seven_day_opus: {...}, seven_day_sonnet: {...}}   (utilization 0..100)
//   newer:   {limits: [{kind: 'session'|'weekly_all'|'weekly_scoped', percent: 4,
//             resets_at, scope: {model: {id, display_name}}}]}

export const QUOTA_URL = 'https://api.anthropic.com/api/oauth/usage';
export const QUOTA_BETA = 'oauth-2025-04-20';

/**
 * @returns {Array<{kind: 'session'|'weekly'|'weekly-model', model: string|null,
 *                  percent: number, resetsAt: number|null}>}  session first, then weekly
 */
export function parseQuota(json) {
    if (!json || typeof json !== 'object')
        return [];
    const pct = v => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
    };
    const when = v => {
        const t = Date.parse(v ?? '');
        return Number.isFinite(t) ? t : null;
    };
    const rows = [];
    if (Array.isArray(json.limits) && json.limits.length) {
        for (const e of json.limits.slice(0, 8)) {
            if (!e || typeof e !== 'object')
                continue;
            const p = pct(e.percent ?? e.utilization);
            if (p === null)
                continue;
            const model = e.scope?.model?.display_name ?? e.scope?.model?.id ?? null;
            const kind = e.kind === 'session' ? 'session'
                : e.kind === 'weekly_all' ? 'weekly'
                    : e.kind === 'weekly_scoped' ? 'weekly-model' : null;
            if (kind)
                rows.push({kind, model: kind === 'weekly-model' ? model : null, percent: p, resetsAt: when(e.resets_at)});
        }
    } else {
        for (const [field, kind, model] of [['five_hour', 'session', null], ['seven_day', 'weekly', null],
            ['seven_day_opus', 'weekly-model', 'Opus'], ['seven_day_sonnet', 'weekly-model', 'Sonnet']]) {
            const l = json[field];
            const p = pct(l?.utilization);
            if (l && p !== null)
                rows.push({kind, model, percent: p, resetsAt: when(l.resets_at)});
        }
    }
    const rank = {session: 0, weekly: 1, 'weekly-model': 2};
    return rows.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/** Time until a reset: {value: 4.8, unit: 'h'} / {value: 5.2, unit: 'd'} / {value: 40, unit: 'min'} */
export function untilReset(resetsAt, now) {
    if (!resetsAt)
        return null;
    const ms = Math.max(0, resetsAt - now);
    if (ms >= 24 * 3600e3)
        return {value: Math.round(ms / 86400e3 * 10) / 10, unit: 'd'};
    if (ms >= 3600e3)
        return {value: Math.round(ms / 3600e3 * 10) / 10, unit: 'h'};
    return {value: Math.max(1, Math.round(ms / 60e3)), unit: 'min'};
}

/** Claude Code's OAuth credentials file content -> {token, expired} | null */
export function readToken(text, now) {
    let o;
    try {
        o = JSON.parse(text);
    } catch {
        return null;
    }
    const c = o?.claudeAiOauth;
    if (!c?.accessToken)
        return null;
    const exp = Number(c.expiresAt);
    return {token: String(c.accessToken), expired: Number.isFinite(exp) && now >= exp - 60e3};
}
