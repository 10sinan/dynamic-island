// Fixed values. Everything a user may want to change lives in GSettings
// (schemas/*.gschema.xml, edited with tools/di-config).
import Clutter from 'gi://Clutter';

export const LOG_PREFIX = '[dynamic-island]';

// Geometry (logical pixels)
export const PANEL_INSET = 2;        // compact pill = panel height - 2 * inset
export const BORDER = 2;             // 2 * border width of .di-island
export const COMPACT_MIN_W = 60;
export const EXPANDED_MIN_W = 300;
export const ACTIVITY_MIN_W = 200;
export const SLOT_MARGIN = 8;        // extra panel space reserved around the pill
export const EXPANDED_RADIUS = 26;   // radius = min(EXPANDED_RADIUS, height / 2), every frame
export const FLOAT_H = 34;           // height when there is no panel slot
export const FLOAT_GAP = 6;
export const SCREEN_MARGIN = 4;
export const HIT_SLACK_X = 4;        // = SLOT_MARGIN / 2: hover area reaches the edges of the reserved slot

// Timing (ms) that is not user-configurable
export const COLLAPSE_MS = 260;
export const FADE_OUT_MS = 110;
export const FADE_IN_MS = 220;
export const FADE_IN_DELAY_MS = 90;
export const APPEAR_MS = 360;
export const REBUILD_DEBOUNCE_MS = 150;
export const ACTIVITY_LEAVE_MS = 1500;  // activity paused by hover ends this long after leaving
export const OSD_DURATION_MS = 1500;
export const MENU_CLOSE_MS = 160;

export const COLLAPSE_MODE = Clutter.AnimationMode.EASE_IN_OUT_CUBIC;

// Meter bar widths
export const BAR_W_COMPACT = 22;
export const BAR_W_TILE = 58;
export const BAR_W_OSD = 200;
