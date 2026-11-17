// Contract every island module follows.
//
// Lifecycle (driven by lib/island.js):
//   new Module(ctx)  -> await init()  -> if (!available) destroy() and drop it
//   buildHeader()    optional: big line at the top of the expanded island
//   buildCompact()   optional: widget inside the pill in the panel
//   buildExpanded()  optional: tile in the expanded island
//   tick()           called every 1-2 s while the island is visible; async, never blocks
//   destroy()        drop references / disconnect own signals;
//                    actors are destroyed together with the island
//
// ctx = {
//   cancellable,      Gio.Cancellable — pass to every async read
//   config,           snapshot from lib/settings.js (accent, showSeconds, ...)
//   panelSlot,        lib/panelSlot.js of this island
//   requestRelayout,  call when the compact content changed size
//   requestExpandedRelayout,  call when expanded content changed size
//   holdOpen(bool),   keep the island open while e.g. a slider is dragged
//   collapse(),       close the island (after an action)
//   history,          shared samples (lib/history.js) for graphs
//   setAccentBorder(hex|null)  tint the pill outline
// }

export class IslandModule {
    /** Unique, stable id (used in settings and logs). */
    static id = 'base';

    /**
     * Where buildExpanded()'s actor goes: 'tiles' (small metric row at the
     * bottom) or 'main' (big content: calendar, notification list, controls).
     */
    static slot = 'tiles';

    /** true: refreshed on every poll even while the island is compact (feeds graph history). */
    static background = false;

    /** Optional: called every time the island opens (expanded view). */
    onShown() {}

    /** Optional: called when the expanded view closes (stop animations here). */
    onHidden() {}

    constructor(ctx) {
        this.ctx = ctx;
        /** Set to false in init() if the data source does not exist (e.g. no battery). */
        this.available = true;
    }

    /** One-off async discovery (find sensors, take a first sample...). */
    async init() {}

    /** @returns {Clutter.Actor|null} */
    buildHeader() {
        return null;
    }

    /** @returns {Clutter.Actor|null} */
    buildCompact() {
        return null;
    }

    /** @returns {Clutter.Actor|null} */
    buildExpanded() {
        return null;
    }

    /** Read fresh data and update the widgets. */
    async tick() {}

    destroy() {
        this.ctx = null;
    }

    get cancellable() {
        return this.ctx?.cancellable ?? null;
    }

    get accent() {
        return this.ctx?.config?.accent ?? '#5ee6b5';
    }
}
