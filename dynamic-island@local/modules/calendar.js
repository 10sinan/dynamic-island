// Month calendar for the centre island (replaces GNOME's calendar popover).
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {IslandModule} from './base.js';
import {weekStart, weekdayName, monthTitle} from '../lib/i18n.js';

const CELLS = 42;   // 6 weeks

function today() {
    return GLib.DateTime.new_now_local();
}

function sameDay(a, b) {
    return a.get_year() === b.get_year() && a.get_day_of_year() === b.get_day_of_year();
}

export default class CalendarModule extends IslandModule {
    static id = 'calendar';
    static slot = 'main';

    async init() {
        // 0 = Sunday ... 6 = Saturday, from the locale (same as GNOME's calendar).
        this._weekStart = weekStart();
        this._resetMonth();
    }

    _resetMonth() {
        const now = today();
        this._year = now.get_year();
        this._month = now.get_month();
        this._lastDay = now.get_day_of_year();
    }

    buildExpanded() {
        const box = new St.BoxLayout({
            style_class: 'di-cal',
            orientation: Clutter.Orientation.VERTICAL,
        });

        const header = new St.BoxLayout({style_class: 'di-cal-header'});
        const prev = new St.Button({style_class: 'di-cal-nav', label: '‹', can_focus: false});
        const next = new St.Button({style_class: 'di-cal-nav', label: '›', can_focus: false});
        this._title = new St.Label({
            style_class: 'di-cal-title',
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        prev.connect('clicked', () => this._shift(-1));
        next.connect('clicked', () => this._shift(1));
        // Clicking the month name jumps back to today.
        const titleButton = new St.Button({child: this._title, x_expand: true, can_focus: false});
        titleButton.connect('clicked', () => {
            this._resetMonth();
            this._render();
        });
        header.add_child(prev);
        header.add_child(titleButton);
        header.add_child(next);
        box.add_child(header);

        // weekday names, starting at the locale's first day
        const names = new St.BoxLayout({style_class: 'di-cal-row'});
        const sunday = GLib.DateTime.new_local(2023, 1, 1, 12, 0, 0);   // a Sunday
        for (let i = 0; i < 7; i++) {
            const d = sunday.add_days((this._weekStart + i) % 7);
            names.add_child(new St.Label({style_class: 'di-cal-weekday', text: weekdayName(d.get_day_of_week() % 7, true).slice(0, 2)}));
        }
        box.add_child(names);

        this._cells = [];
        for (let r = 0; r < 6; r++) {
            const row = new St.BoxLayout({style_class: 'di-cal-row'});
            for (let c = 0; c < 7; c++) {
                const cell = new St.Label({style_class: 'di-cal-day', x_align: Clutter.ActorAlign.CENTER});
                row.add_child(cell);
                this._cells.push(cell);
            }
            box.add_child(row);
        }
        box.connect('destroy', () => {
            this._cells = null;
            this._title = null;
        });
        this._render();
        return box;
    }

    _shift(delta) {
        this._month += delta;
        if (this._month < 1) {
            this._month = 12;
            this._year--;
        } else if (this._month > 12) {
            this._month = 1;
            this._year++;
        }
        this._render();
    }

    _render() {
        if (!this._cells)
            return;
        const first = GLib.DateTime.new_local(this._year, this._month, 1, 12, 0, 0);
        this._title.text = monthTitle(this._year, this._month);
        // get_day_of_week: 1 = Monday ... 7 = Sunday
        const offset = (first.get_day_of_week() % 7 - this._weekStart + 7) % 7;
        const start = first.add_days(-offset);
        const now = today();
        for (let i = 0; i < CELLS; i++) {
            const d = start.add_days(i);
            const cell = this._cells[i];
            const text = String(d.get_day_of_month());
            if (cell.text !== text)
                cell.text = text;
            const dow = d.get_day_of_week() % 7;   // 0 = Sunday
            cell.remove_style_class_name('di-cal-other');
            cell.remove_style_class_name('di-cal-today');
            cell.remove_style_class_name('di-cal-weekend');
            cell.set_style(null);
            if (d.get_month() !== this._month)
                cell.add_style_class_name('di-cal-other');
            else if (dow === 0 || dow === 6)
                cell.add_style_class_name('di-cal-weekend');
            if (sameDay(d, now)) {
                cell.add_style_class_name('di-cal-today');
                cell.set_style(`background-color: ${this.accent};`);
            }
        }
    }

    onShown() {
        // Always open on the current month.
        this._resetMonth();
        this._render();
    }

    async tick() {
        const day = today().get_day_of_year();
        if (day !== this._lastDay) {   // midnight
            this._lastDay = day;
            this._render();
        }
    }

    destroy() {
        this._cells = null;
        this._title = null;
        super.destroy();
    }
}
