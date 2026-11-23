// Run: gjs -m tests/artfetch.test.js
// Cover-art URL checks: which URLs the music card may fetch, and the size cap.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {MAX_ART_BYTES, allPublic, assertPublicHost, checkArtUrl, isPrivateHost, readCapped} from '../dynamic-island@10sinan.github.io/lib/artFetch.js';

Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');

let failures = 0;
const check = (name, cond, detail = '') => {
    print(`  ${cond ? 'ok  ' : 'FAIL'} ${name} ${cond ? '' : detail}`);
    if (!cond)
        failures++;
};

print('allowed');
check('https public host', checkArtUrl('https://i.scdn.co/image/ab67616d0000b273')?.kind === 'https');
check('file url', checkArtUrl('file:///tmp/cover.jpg')?.kind === 'file');
check('public ipv4', checkArtUrl('https://93.184.216.34/a.png')?.kind === 'https');
check('public ipv6', checkArtUrl('https://[2606:4700::1111]/a.png')?.kind === 'https');

print('refused');
for (const u of [
    'http://i.scdn.co/a.jpg',                 // cleartext
    'https://localhost/a.png',
    'https://foo.localhost/a.png',
    'https://127.0.0.1:631/',
    'https://10.0.0.1/',
    'https://172.16.5.4/',
    'https://192.168.1.1/admin',
    'https://169.254.169.254/latest/meta-data/',
    'https://100.64.0.1/',
    'https://0.0.0.0/',
    'https://[::1]/',
    'https://[fe80::1]/',
    'https://[fd00::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://2130706433/',                    // 127.0.0.1 as a number
    'https://0x7f000001/',
    'https://printer.local/',
    'https://user:pw@example.com/a.png',
    'ftp://example.com/a.png',
    'data:image/png;base64,AAAA',
    'resource:///org/gnome/shell/x.png',
    '',
    'https://' + 'a'.repeat(3000) + '.com/',
])
    check(`refused ${u.slice(0, 50)}`, checkArtUrl(u) === null);
check('non-string', checkArtUrl(null) === null && checkArtUrl(42) === null);
check('isPrivateHost trailing dot', isPrivateHost('localhost.'));
check('isPrivateHost public name', !isPrivateHost('example.com'));

print('allPublic');
check('public addresses', allPublic(['93.184.216.34', '2606:4700::1111']));
check('one private address spoils it', !allPublic(['93.184.216.34', '127.0.0.1']));
check('ipv6 loopback', !allPublic(['::1']));
check('mapped ipv4 loopback', !allPublic(['::ffff:127.0.0.1']));
check('no answer', !allPublic([]));

print('assertPublicHost');
const rejects = async (host, why = /./) => {
    try {
        await assertPublicHost(host);
        return false;
    } catch (e) {
        return why.test(e.message);
    }
};

print('readCapped');
const loop = GLib.MainLoop.new(null, false);
(async () => {
    try {
        check('refuses a private literal', await rejects('192.168.1.1'));
        check('refuses localhost', await rejects('localhost'));
        // not caught by the name rules: only the lookup (/etc/hosts -> ::1 / 127.0.0.1) reveals it
        if (GLib.spawn_command_line_sync('getent hosts localhost.localdomain')[3] === 0)
            check('refuses a name that resolves to loopback', await rejects('localhost.localdomain', /resolves to a private/));
        else
            print('  skip: localhost.localdomain is not defined on this machine');
        const small = new Uint8Array(200000).map((_v, i) => i & 0xff);
        const got = await readCapped(Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(small)), MAX_ART_BYTES);
        check('reads whole small stream', got.length === small.length && got[199999] === (199999 & 0xff));
        const empty = await readCapped(Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(new Uint8Array(0))), 10);
        check('empty stream', empty.length === 0);
        let threw = false;
        try {
            await readCapped(Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(new Uint8Array(1000))), 999);
        } catch (e) {
            threw = /too large/.test(e.message);
        }
        check('over the cap throws', threw);
        const exact = await readCapped(Gio.MemoryInputStream.new_from_bytes(GLib.Bytes.new(new Uint8Array(999))), 999);
        check('exactly the cap is fine', exact.length === 999);
        // /dev/zero never ends: must stop at the cap instead of eating memory
        threw = false;
        try {
            await readCapped(Gio.File.new_for_path('/dev/zero').read(null), 1 << 20);
        } catch (e) {
            threw = /too large/.test(e.message);
        }
        check('endless stream stops at the cap', threw);
    } catch (e) {
        check('no exception', false, e.message);
    }
    loop.quit();
})();
loop.run();

print(failures ? `${failures} FAILED` : 'all passed');
if (failures)
    imports.system.exit(1);
