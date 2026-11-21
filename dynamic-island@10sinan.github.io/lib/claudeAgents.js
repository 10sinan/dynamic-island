// Which Claude Code sessions ("agents") are active and what each one is doing,
// read from the local session logs (~/.claude/projects/**/*.jsonl). Pure JS,
// unit-tested; modules/claude.js feeds it the log lines it already reads for
// the token count. Nothing is sent anywhere.
//
// This is an ESTIMATE from the logs: Claude Code does not tell us which
// terminals are still open. A session counts as "working" while it wrote to
// its log in the last minute or a tool call is still unanswered, and as
// "idle" for IDLE_MAX_MS after its last record.

export const WORKING_MS = 60 * 1000;
export const PENDING_MS = 10 * 60 * 1000;    // a tool call without a result this young still counts as running
export const IDLE_MAX_MS = 30 * 60 * 1000;   // older sessions are not listed
export const FORGET_MS = 60 * 60 * 1000;     // ... and forgotten after this
export const MAX_LISTED = 6;
const TEXT_MAX = 80;

const clean = (s, max = TEXT_MAX) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
};

/** Last two path segments: "lib/claudeAgents.js". */
export function shortPath(p) {
    const parts = String(p ?? '').split('/').filter(Boolean);
    return parts.slice(-2).join('/');
}

/** What a tool call is about, in a few words (never the whole input). */
export function summarizeTool(name, input) {
    const i = input && typeof input === 'object' ? input : {};
    switch (name) {
    case 'Bash':
        return clean(String(i.command ?? '').split('\n')[0]);
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit':
        return shortPath(i.file_path ?? i.notebook_path);
    case 'Grep': case 'Glob':
        return clean(i.pattern);
    case 'WebFetch':
        return clean(i.url);
    case 'WebSearch':
        return clean(i.query);
    case 'Task': case 'Agent':
        return clean(i.description ?? i.subagent_type);
    default:
        return '';
    }
}

/**
 * One JSONL line -> {session, cwd, t, sidechain, role, tool?, text?, prompt?, results?} or null.
 * Only user / assistant records matter; everything else (snapshots, titles,
 * request blobs) is skipped before parsing.
 */
export function parseActivity(line) {
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"'))
        return null;
    let o;
    try {
        o = JSON.parse(line);
    } catch {
        return null;
    }
    if ((o?.type !== 'assistant' && o?.type !== 'user') || !o.sessionId || !o.timestamp)
        return null;
    const t = Date.parse(o.timestamp);
    if (!Number.isFinite(t))
        return null;
    const ev = {session: String(o.sessionId), cwd: String(o.cwd ?? ''), t, sidechain: o.isSidechain === true,
        role: o.type};
    const content = o.message?.content;
    if (o.type === 'assistant') {
        const blocks = Array.isArray(content) ? content : [];
        const use = [...blocks].reverse().find(b => b?.type === 'tool_use');
        if (use) {
            ev.tool = {id: String(use.id ?? ''), name: String(use.name ?? ''), target: summarizeTool(use.name, use.input)};
            return ev;
        }
        const text = [...blocks].reverse().find(b => b?.type === 'text' && b.text);
        if (text)
            ev.text = clean(text.text);
        return ev;   // thinking-only record: still proof of life
    }
    // user: a tool result (the tool finished) or something the person typed
    if (Array.isArray(content)) {
        const ids = content.filter(b => b?.type === 'tool_result').map(b => String(b.tool_use_id ?? ''));
        if (ids.length) {
            ev.results = ids;
            return ev;
        }
        const text = content.find(b => b?.type === 'text' && b.text);
        if (text && !o.isMeta)
            ev.prompt = clean(text.text);
    } else if (typeof content === 'string' && !o.isMeta) {
        ev.prompt = clean(content);
    }
    return ev;
}

/** Fold one event into `agents` (Map session -> agent), in place. */
export function updateAgent(agents, ev) {
    let a = agents.get(ev.session);
    if (!a) {
        a = {session: ev.session, cwd: '', t: 0, subT: 0, tool: null, text: '', prompt: '', pending: null};
        agents.set(ev.session, a);
    }
    if (ev.cwd && !ev.sidechain)
        a.cwd = ev.cwd;
    if (ev.t < a.t - 1000)
        return;   // an older record read late (files are read in no fixed order)
    if (ev.sidechain) {
        // a sub-agent (Task tool) of this session is busy
        a.subT = Math.max(a.subT, ev.t);
        a.t = Math.max(a.t, ev.t);
        return;
    }
    a.t = Math.max(a.t, ev.t);
    if (ev.tool) {
        a.tool = ev.tool;
        a.text = '';
        a.pending = ev.tool.id || true;
    } else if (ev.text) {
        a.text = ev.text;
    }
    if (ev.prompt) {
        a.prompt = ev.prompt;
        a.text = '';
    }
    if (ev.results && (a.pending === true || ev.results.includes(a.pending)))
        a.pending = null;
}

export function projectName(cwd) {
    const parts = String(cwd ?? '').split('/').filter(Boolean);
    return parts[parts.length - 1] || cwd || '?';
}

/**
 * @returns {Array<{session, project, state: 'working'|'idle', agoMs, tool, target, text, prompt, sub}>}
 * working first, then the most recently active; at most MAX_LISTED.
 */
export function listAgents(agents, now) {
    const out = [];
    for (const a of agents.values()) {
        const age = now - a.t;
        if (age > IDLE_MAX_MS || !a.t)
            continue;
        const running = a.pending && age < PENDING_MS;
        out.push({
            session: a.session,
            project: projectName(a.cwd),
            state: age < WORKING_MS || running ? 'working' : 'idle',
            agoMs: Math.max(0, age),
            tool: a.tool?.name ?? '',
            target: a.tool?.target ?? '',
            text: a.text,
            prompt: a.prompt,
            sub: now - a.subT < WORKING_MS,
        });
    }
    out.sort((x, y) => (x.state === y.state ? x.agoMs - y.agoMs : x.state === 'working' ? -1 : 1));
    return out.slice(0, MAX_LISTED);
}

/** Drop sessions that have been quiet for good. */
export function pruneAgents(agents, now) {
    for (const [k, a] of agents) {
        if (now - a.t > FORGET_MS)
            agents.delete(k);
    }
}

export const ROW_PX = 66;   // one agent row in the panel (name, activity, sub-agent, request), with spacing

/** How many rows fit in `availablePx` of screen height (at least 1, at most `max`). */
export function rowBudget(availablePx, rowPx = ROW_PX, max = MAX_LISTED) {
    const n = Math.floor((Number(availablePx) || 0) / rowPx);
    return Math.max(1, Math.min(max, n));
}
