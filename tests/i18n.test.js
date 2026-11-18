// gjs -m tests/i18n.test.js
import GLib from 'gi://GLib';
import {_, _f, pct, setLanguage, shortDate, monthTitle, weekdayName, weekStart, getLanguage} from '../dynamic-island@local/lib/i18n.js';

let fails = 0;
const eq = (a, b, m) => { if (a !== b) { fails++; print(`FAIL ${m}: ${a} !== ${b}`); } };

setLanguage('tr');
eq(_('Clear'), 'Temizle', 'tr clear');
eq(_f('%s left', pct(12)), '%12 kaldı', 'tr fmt');
eq(weekStart(), 1, 'tr week');
const dt = GLib.DateTime.new_local(2026, 11, 18, 12, 0, 0);   // a Wednesday
eq(shortDate(dt), 'Çar 18 Kas', 'tr date');
eq(monthTitle(2026, 11), 'Kasım 2026', 'tr month');
eq(weekdayName(0, true) + weekdayName(1, true), 'PazPzt', 'tr short days are distinct');

setLanguage('en');
eq(_('Clear'), 'Clear', 'en clear');
eq(_f('%s left', pct(12)), '12% left', 'en fmt');
eq(weekStart(), 0, 'en week');
eq(shortDate(dt), 'Wed 18 Nov', 'en date');
eq(weekdayName(0), 'Sunday', 'en sunday');
eq(_('not translated'), 'not translated', 'fallback');

setLanguage('de');
eq(getLanguage(), 'tr', 'unknown falls back');

print(fails ? `${fails} FAILED` : 'i18n ok');
imports.system.exit(fails ? 1 : 0);
