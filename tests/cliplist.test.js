// Run: gjs -m tests/cliplist.test.js
import {ClipList, isSecret, oneLine, pickKind} from '../dynamic-island@10sinan.github.io/lib/clipList.js';

let failures = 0;
const check = (name, cond, detail = '') => {
    print(`  ${cond ? 'ok  ' : 'FAIL'} ${name} ${cond ? '' : detail}`);
    if (!cond)
        failures++;
};

print('ClipList');
const l = new ClipList(10);
for (let i = 0; i < 12; i++)
    l.add({key: `t:${i}`, text: String(i)});
check('keeps only the last 10', l.items.length === 10, String(l.items.length));
check('newest first, oldest two dropped', l.items[0].text === '11' && l.items[9].text === '2');
l.add({key: 't:5', text: '5'});
check('copying an existing entry moves it to the top, no duplicate',
    l.items[0].text === '5' && l.items.filter(x => x.key === 't:5').length === 1 && l.items.length === 10);
const before = JSON.stringify(l.items);
l.add({key: 't:5', text: '5'});
check('copying the newest again changes nothing', JSON.stringify(l.items) === before);
l.remove('t:5');
check('remove', l.items.length === 9 && l.items[0].text === '11');
l.clear();
check('clear', l.items.length === 0);
check('timestamp is set', new ClipList().add({key: 'x'}).at > 0);

print('formats');
check('plain text', pickKind(['text/plain;charset=utf-8', 'text/html']) === 'text' && pickKind(['UTF8_STRING']) === 'text');
check('png image', pickKind(['image/png']) === 'image');
check('text wins over an image offered together', pickKind(['image/png', 'text/plain']) === 'text');
check('unknown formats are ignored', pickKind(['application/x-foo']) === null && pickKind([]) === null);
check('password manager hint -> secret, never stored',
    isSecret(['text/plain', 'x-kde-passwordManagerHint']) && pickKind(['text/plain', 'x-kde-passwordManagerHint']) === null);
check('hint is matched case-insensitively', isSecret(['X-KDE-PasswordManagerHint']));

print('oneLine');
check('whitespace collapsed', oneLine('  a \n\n  b\t c ') === 'a b c');
check('long text is cut with an ellipsis', oneLine('x'.repeat(200), 20) === `${'x'.repeat(19)}…`);

print(failures ? `\n${failures} FAILED` : '\nall passed');
if (failures)
    imports.system.exit(1);
