// Run: gjs -m tests/claudeagents.test.js
// Which Claude Code sessions are active and what they are doing (from log lines).
import {
    IDLE_MAX_MS, MAX_LISTED, ROW_PX, WORKING_MS, listAgents, parseActivity, projectName, pruneAgents, rowBudget,
    shortPath, summarizeTool, updateAgent,
} from '../dynamic-island@10sinan.github.io/lib/claudeAgents.js';

let failures = 0;
const check = (name, cond, detail = '') => {
    print(`  ${cond ? 'ok  ' : 'FAIL'} ${name} ${cond ? '' : detail}`);
    if (!cond)
        failures++;
};

const T0 = Date.parse('2026-11-21T10:00:00.000Z');
const iso = ms => new Date(T0 + ms).toISOString();
const line = o => JSON.stringify({sessionId: 's1', cwd: '/home/u/projects/app', timestamp: iso(0), ...o});
const asst = (content, o = {}) => line({type: 'assistant', message: {role: 'assistant', content}, ...o});
const user = (content, o = {}) => line({type: 'user', message: {role: 'user', content}, ...o});

print('summarizeTool');
check('bash first line, cut', summarizeTool('Bash', {command: `npm test\n${'x'.repeat(200)}`}) === 'npm test');
check('bash long cut with ellipsis', summarizeTool('Bash', {command: 'y'.repeat(200)}).length === 80 &&
    summarizeTool('Bash', {command: 'y'.repeat(200)}).endsWith('…'));
check('file tools: last two segments', summarizeTool('Edit', {file_path: '/a/b/lib/x.js', new_string: 'SECRET'}) === 'lib/x.js');
check('file content never shown', !summarizeTool('Write', {file_path: '/a/b.js', content: 'SECRET'}).includes('SECRET'));
check('grep pattern', summarizeTool('Grep', {pattern: 'foo.*bar'}) === 'foo.*bar');
check('unknown tool: nothing', summarizeTool('mcp__x__y', {token: 'SECRET'}) === '');
check('bad input', summarizeTool('Bash', null) === '' && summarizeTool('Read', 'x') === '');
check('shortPath', shortPath('/a/b/c.txt') === 'b/c.txt' && shortPath('c.txt') === 'c.txt' && shortPath('') === '');

print('parseActivity');
check('skips other record types', parseActivity(line({type: 'attachment'})) === null &&
    parseActivity(line({type: 'api-request-blob', message: {content: []}})) === null);
check('skips garbage', parseActivity('not json "type":"user"') === null && parseActivity('') === null);
check('skips missing session / time', parseActivity(JSON.stringify({type: 'user', timestamp: iso(0)})) === null &&
    parseActivity(JSON.stringify({type: 'user', sessionId: 's', timestamp: 'nope'})) === null);
let e = parseActivity(asst([{type: 'thinking', thinking: '...'}, {type: 'tool_use', id: 'tu1', name: 'Bash', input: {command: 'ls -la'}}]));
check('tool_use', e.tool.name === 'Bash' && e.tool.target === 'ls -la' && e.tool.id === 'tu1' && e.session === 's1' &&
    e.cwd === '/home/u/projects/app' && e.t === T0 && !e.sidechain, JSON.stringify(e));
e = parseActivity(asst([{type: 'text', text: 'Fixing   the\nbug'}]));
check('assistant text, whitespace collapsed', e.text === 'Fixing the bug' && !e.tool);
e = parseActivity(asst([{type: 'thinking', thinking: 'x'}]));
check('thinking only: still an event, no text', e && !e.text && !e.tool);
e = parseActivity(user([{type: 'tool_result', tool_use_id: 'tu1', content: 'SECRET OUTPUT'}]));
check('tool_result', e.results[0] === 'tu1' && !JSON.stringify(e).includes('SECRET'));
e = parseActivity(user('add a login page'));
check('typed prompt (string)', e.prompt === 'add a login page');
e = parseActivity(user([{type: 'text', text: 'and tests'}]));
check('typed prompt (blocks)', e.prompt === 'and tests');
e = parseActivity(user('<system-reminder>x</system-reminder>', {isMeta: true}));
check('meta records are not prompts', e && !e.prompt);
e = parseActivity(asst([{type: 'text', text: 'hi'}], {isSidechain: true}));
check('sidechain flag', e.sidechain === true);

print('updateAgent / listAgents');
const feed = (agents, lines) => lines.forEach(l => updateAgent(agents, parseActivity(l)));
let agents = new Map();
feed(agents, [
    user('add tests', {timestamp: iso(0)}),
    asst([{type: 'tool_use', id: 'a', name: 'Read', input: {file_path: '/x/y/z.js'}}], {timestamp: iso(2000)}),
    user([{type: 'tool_result', tool_use_id: 'a'}], {timestamp: iso(3000)}),
    asst([{type: 'tool_use', id: 'b', name: 'Bash', input: {command: 'npm test'}}], {timestamp: iso(5000)}),
]);
let L = listAgents(agents, T0 + 6000);
check('one agent, working', L.length === 1 && L[0].state === 'working' && L[0].project === 'app', JSON.stringify(L));
check('current tool + target', L[0].tool === 'Bash' && L[0].target === 'npm test');
check('last prompt kept', L[0].prompt === 'add tests');
L = listAgents(agents, T0 + 5000 + 5 * 60 * 1000);
check('quiet but tool still running (under 10 min): working', L[0].state === 'working');
L = listAgents(agents, T0 + 5000 + 11 * 60 * 1000);
check('tool call unanswered for 11 min: idle', L[0].state === 'idle');
feed(agents, [user([{type: 'tool_result', tool_use_id: 'b'}], {timestamp: iso(8000)})]);
L = listAgents(agents, T0 + 8000 + WORKING_MS + 1000);
check('result received, quiet for a minute: idle', L[0].state === 'idle' && L[0].tool === 'Bash');
feed(agents, [asst([{type: 'text', text: 'Done: tests pass'}], {timestamp: iso(9000)})]);
L = listAgents(agents, T0 + 10000);
check('reply text shown, tool cleared from focus', L[0].text === 'Done: tests pass' && L[0].state === 'working');
check('too old: not listed', listAgents(agents, T0 + 9000 + IDLE_MAX_MS + 1).length === 0);
check('exactly at the limit still listed', listAgents(agents, T0 + 9000 + IDLE_MAX_MS).length === 1);

print('several sessions, sub-agents, ordering');
agents = new Map();
const mk = (s, cwd, ms) => asst([{type: 'text', text: 't'}], {sessionId: s, cwd, timestamp: iso(ms)});
feed(agents, [mk('idle1', '/p/one', 0), mk('work1', '/p/two', 200000), mk('idle2', '/p/three', 100000)]);
L = listAgents(agents, T0 + 210000);
check('working first, then most recent', L.map(a => a.project).join() === 'two,three,one', L.map(a => a.project).join());
feed(agents, [asst([{type: 'text', text: 'sub'}], {sessionId: 'work1', isSidechain: true, cwd: '/tmp/other', timestamp: iso(209000)})]);
L = listAgents(agents, T0 + 210000);
check('sidechain: sub-agent flag on, project not changed', L[0].sub === true && L[0].project === 'two');
check('sub-agent flag fades', listAgents(agents, T0 + 209000 + WORKING_MS + 1)[0].sub === false);
agents = new Map();
for (let i = 0; i < 20; i++)
    feed(agents, [mk(`s${i}`, `/p/${i}`, i * 1000)]);
check(`capped at ${MAX_LISTED}`, listAgents(agents, T0 + 30000).length === MAX_LISTED);
agents = new Map();
feed(agents, [mk('o', '/p/o', 5000), mk('o', '/p/o', 1000)]);
check('older record read late does not move the clock back', agents.get('o').t === T0 + 5000);

print('pruneAgents / projectName');
agents = new Map();
feed(agents, [mk('old', '/p/old', 0), mk('new', '/p/new', 3600 * 1000)]);
pruneAgents(agents, T0 + 3600 * 1000 + 1000);
check('forgotten after an hour', agents.size === 1 && agents.has('new'));
check('projectName', projectName('/a/b/app/') === 'app' && projectName('') === '?' && projectName('/') === '/');

print('rowBudget');
check('big screen: capped at the maximum', rowBudget(5000) === MAX_LISTED);
check('exact fit', rowBudget(ROW_PX * 3) === 3 && rowBudget(ROW_PX * 3 - 1) === 2);
check('never below one row', rowBudget(0) === 1 && rowBudget(-300) === 1 && rowBudget(NaN) === 1 && rowBudget(undefined) === 1);
check('custom row height / max', rowBudget(100, 20, 4) === 4 && rowBudget(100, 20, 9) === 5);

print(failures ? `${failures} FAILED` : 'all passed');
if (failures)
    imports.system.exit(1);
