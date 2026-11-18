// Claude Code token usage, estimated from the session logs Claude Code keeps
// on this computer (~/.claude/projects/**/*.jsonl). Pure JS, unit-tested.
//
// This is an ESTIMATE from local logs only: Anthropic does not publish the
// remaining quota of a plan locally, so "remaining" is relative to a limit the
// user types in (setting), and the window follows Claude's 5-hour sessions.

export const WINDOW_MS = 5 * 3600 * 1000;

/**
 * One JSONL line -> {id, t, tokens} or null. An assistant message is written
 * several times (once per content block) with the same message id, so callers
 * keep the maximum per id.
 */
export function parseLine(line) {
    if (!line.includes('"usage"'))
        return null;
    let o;
    try {
        o = JSON.parse(line);
    } catch {
        return null;
    }
    const m = o?.message;
    const u = m?.usage;
    if (!u || !m.id || !o.timestamp)
        return null;
    const t = Date.parse(o.timestamp);
    if (!Number.isFinite(t))
        return null;
    return {
        id: m.id,
        t,
        input: Number(u.input_tokens) || 0,
        output: Number(u.output_tokens) || 0,
        cacheWrite: Number(u.cache_creation_input_tokens) || 0,
        cacheRead: Number(u.cache_read_input_tokens) || 0,
    };
}

/** Merge a new sighting of a message into `byId` (max of every counter). */
export function addEntry(byId, e) {
    const old = byId.get(e.id);
    if (!old) {
        byId.set(e.id, {...e});
        return;
    }
    for (const k of ['input', 'output', 'cacheWrite', 'cacheRead'])
        old[k] = Math.max(old[k], e[k]);
    old.t = Math.min(old.t, e.t);
}

/** Tokens that count towards the estimate: new input, output, cache writes (not cache reads). */
export const billable = e => e.input + e.output + e.cacheWrite;

/**
 * Session block like Claude's rolling 5-hour window: it starts at the hour of
 * the first message and lasts 5 h; a message after that (or after a 5 h gap)
 * starts the next block.
 * @returns {{active: boolean, start: number, end: number, used: number, messages: number,
 *            today: number}}
 */
export function windowStats(entries, now, todayStart) {
    const sorted = [...entries].sort((a, b) => a.t - b.t);
    let start = null, last = 0, used = 0, messages = 0, today = 0;
    for (const e of sorted) {
        if (e.t >= todayStart)
            today += billable(e);
        if (start === null || e.t >= start + WINDOW_MS || e.t - last >= WINDOW_MS) {
            start = Math.floor(e.t / 3600000) * 3600000;
            used = 0;
            messages = 0;
        }
        used += billable(e);
        messages++;
        last = e.t;
    }
    if (start === null || now >= start + WINDOW_MS)
        return {active: false, start: 0, end: 0, used: 0, messages: 0, today};
    return {active: true, start, end: start + WINDOW_MS, used, messages, today};
}

/** 1234 -> "1.2K", 12_400_000 -> "12.4M" */
export function formatTokens(n) {
    if (n >= 1e9)
        return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6)
        return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
    if (n >= 1e3)
        return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`;
    return String(Math.round(n));
}

/** ms -> "2 h 10 min" style pieces: {h, m} */
export function splitDuration(ms) {
    const total = Math.max(0, Math.ceil(ms / 60000));
    return {h: Math.floor(total / 60), m: total % 60};
}
