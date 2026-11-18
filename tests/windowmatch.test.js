// Run: gjs -m tests/windowmatch.test.js
import {appMatches, fold, needlesFor, pickWindow} from '../dynamic-island@local/lib/windowMatch.js';

let failures = 0;
const check = (name, cond, detail = '') => {
    print(`  ${cond ? 'ok  ' : 'FAIL'} ${name} ${cond ? '' : detail}`);
    if (!cond)
        failures++;
};

print('needlesFor');
const chrome = needlesFor({identity: 'Chrome', busName: 'org.mpris.MediaPlayer2.chromium.instance14907'});
check('identity and bus token (no instance suffix)', JSON.stringify(chrome) === '["chrome","chromium"]', JSON.stringify(chrome));
check('desktop entry without .desktop, lowercase',
    needlesFor({desktopEntry: 'org.videolan.VLC.desktop', identity: 'VLC media player', busName: 'org.mpris.MediaPlayer2.vlc'})[0] === 'org.videolan.vlc');
check('too short names are dropped (no accidental matches)', needlesFor({identity: 'ab', busName: 'org.mpris.MediaPlayer2.x'}).length === 0);

print('appMatches');
check('Chrome identity finds google-chrome', appMatches(chrome, {id: 'google-chrome.desktop', name: 'Google Chrome'}));
check('chromium token finds chromium-browser', appMatches(chrome, {id: 'chromium-browser.desktop', name: 'Chromium Web Browser'}));
check('mpv by desktop entry', appMatches(['io.mpv.mpv'], {id: 'io.mpv.Mpv.desktop', name: 'mpv Media Player'}));
check('unrelated app does not match', !appMatches(chrome, {id: 'org.gnome.Calculator.desktop', name: 'Calculator'}));
check('a short app id does not swallow every needle', !appMatches(['spotify-client'], {id: 'gz.desktop', name: 'x'}));

print('pickWindow');
const wins = [
    {title: 'Inbox - Mail', minimized: false},
    {title: 'Yak - Aydın Kurtoğlu - YouTube', minimized: false},
    {title: 'Docs', minimized: true},
];
check('track title in the window title wins', pickWindow(wins, 'Yak').title.startsWith('Yak'));
check('title match is case-insensitive', pickWindow(wins, 'AYDIN KURTOĞLU').title.includes('YouTube'));
check('no title match -> first visible window', pickWindow(wins, 'Something else').title === 'Inbox - Mail');
check('all minimized -> still returns one', pickWindow([{title: 'a', minimized: true}], 'x').title === 'a');
check('no windows -> null', pickWindow([], 'x') === null);
check('a two-letter title is too weak to match on', pickWindow(wins, 'Ya').title === 'Inbox - Mail');

check('fold: dotless i, capital İ, accents', fold('AYDIN') === fold('Aydın') && fold('İstanbul') === 'istanbul' && fold('Çay') === 'cay');

print(failures ? `\n${failures} FAILED` : '\nall passed');
if (failures)
    imports.system.exit(1);
