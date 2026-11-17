// PanelSlot: takes over the place of a top-panel button
// ('dateMenu' = the clock, 'quickSettings' = the status icons).
//
// The button is NOT removed — it stays in the panel, invisible (opacity 0)
// but mapped and allocated, so that:
//   * the panel keeps reserving its slot (we size it to the island width,
//     so neighbouring panel items never slide under the island),
//   * its popover menu still works and still points to the right place
//     (keyboard shortcuts like Super+V, clicks forwarded from the island),
//   * nothing has to be rebuilt on disable(): opacity and width are restored.
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Disposer} from './disposer.js';

export class PanelSlot {
    /**
     * @param {object} p
     * @param {'dateMenu'|'quickSettings'} p.target
     * @param {() => void} p.onChanged             slot moved / resized / disappeared
     * @param {(open: boolean) => void} p.onMenuToggled
     */
    constructor({target, onChanged, onMenuToggled}) {
        this._d = new Disposer();
        this._target = target;
        this._reserved = -1;
        this._button = Main.panel?.statusArea?.[target] ?? null;
        this._container = this._button?.container ?? null;
        if (!this._container)
            return;

        const container = this._container;
        const savedOpacity = container.opacity;
        container.opacity = 0;
        this._d.add(() => {
            if (!this._container)
                return;   // destroyed by someone else meanwhile
            container.opacity = savedOpacity;
            container.set_width(-1);
        });

        this._d.connect(container, 'notify::allocation', () => onChanged());
        this._d.connect(container, 'notify::mapped', () => onChanged());
        // If another extension / session-mode change destroys the button,
        // drop our references and fall back to the floating position.
        const destroyId = container.connect('destroy', () => {
            this._container = null;
            this._button = null;
            onChanged();
        });
        this._d.add(() => {
            if (this._container)
                container.disconnect(destroyId);
        });

        const menu = this._button.menu;
        if (typeof menu?.connect === 'function') {   // Activities has a dummy menu
            try {
                const menuId = menu.connect('open-state-changed', (_m, open) => onMenuToggled(open));
                this._d.add(() => menu.disconnect(menuId));
            } catch {
                // dummy menu without that signal: nothing to track
            }
        }
    }

    /** True while the panel slot exists and is on screen. */
    get active() {
        const panelBox = Main.layoutManager.panelBox;
        return !!this._container && this._container.mapped &&
            panelBox.visible && panelBox.height > 0;
    }

    /** Where the island should sit: the slot's horizontal span, panel band. */
    anchor() {
        if (!this.active)
            return null;
        const [x] = this._container.get_transformed_position();
        const width = this._container.width;
        const panelBox = Main.layoutManager.panelBox;
        return {
            x,
            width,
            centerX: x + width / 2,
            top: panelBox.y + panelBox.translation_y,
            height: panelBox.height,
        };
    }

    /** Make the panel reserve `width` px for this slot. */
    reserve(width) {
        if (!this._container || width === this._reserved)
            return;
        this._reserved = width;
        this._container.set_width(width);
    }

    /** Open/close the original popover (calendar or Quick Settings). */
    toggleMenu() {
        if (!this._container)
            return;
        if (this._target === 'dateMenu')
            Main.panel.toggleCalendar();
        else if (this._target === 'quickSettings')
            Main.panel.toggleQuickSettings();
        else
            this._button.menu?.toggle();
    }

    closeMenu() {
        if (this._button?.menu?.isOpen)
            this._button.menu.close();
    }

    get menuOpen() {
        return !!this._button?.menu?.isOpen;
    }

    /** The shell's "unread notifications" dot (clock only). */
    get notificationIndicator() {
        return this._target === 'dateMenu' ? this._button?._indicator ?? null : null;
    }

    destroy() {
        this._d.dispose();
        this._container = null;
        this._button = null;
    }
}
