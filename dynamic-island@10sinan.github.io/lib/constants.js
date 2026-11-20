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
export const HIT_SLACK_X = 4;
export const EXIT_SLACK = 8;         // an open island keeps hover this far outside its edge (hysteresis: entering needs the pill, leaving needs this much more)        // = SLOT_MARGIN / 2: hover area reaches the edges of the reserved slot

// Timing (ms) that is not user-configurable
export const HOVER_INTENT_MS = 60;     // the pointer must stay this long before the island opens (a brush-by does nothing)
export const MIN_OPEN_MS = 250;        // an island that just opened is not collapsed before this (no half-open twitch)
export const LEAVE_STREAK_MS = 900;    // leaving again within this long of the last leave = hand jitter at the edge: wait longer
export const COLLAPSE_MS = 260;                // island collapse (opening length is the user's `animation-duration`)
export const SPRING_DAMPING = 0.74;            // < 1: a small bounce when opening ('spring' setting)
export const SPRING_DAMPING_COLLAPSE = 0.92;
export const MORPH_BLUR = 14;                  // px, content blur at the start of a morph
export const MORPH_BLUR_SHARE = 0.8;           // blur fades over this share of the animation duration
export const FADE_IN_DELAY_MS = 90;    // incoming island content waits for the outgoing one to leave
export const REBUILD_DEBOUNCE_MS = 150;
export const ACTIVITY_LEAVE_MS = 1500;  // activity paused by hover ends this long after leaving
export const OSD_DURATION_MS = 1500;

// Liquid glass look (setting liquid-glass)
export const GLASS_BODY_ALPHA = 0.58;          // body opacity without blur (text must stay readable on any wallpaper)
export const GLASS_BODY_ALPHA_BLUR = 0.42;     // lower: the blurred backdrop carries the contrast
export const GLASS_BLUR_RADIUS = 14;           // px (sigma) of the backdrop blur behind an open island
export const GLASS_SHEEN = 0.14;               // share of white mixed into the top of the body
export const GLASS_RIM_ALPHA = 0.55;           // brightness of the top edge; sides and bottom are fractions of it
export const GLASS_RIM_HOVER = 1.25;           // edge brightens a little while hovered
export const GLASS_SHADOW_MARGIN = 6;          // px around the pill reserved for the outer shadow
export const GLASS_SHADOW_STEPS = 3;           // rings, falling off from the edge
export const GLASS_SHADOW_ALPHA = 0.30;        // alpha of the innermost ring
export const GLASS_SHADOW_DY = 1;              // shadow sits a little lower than the pill

// Meter bar widths
export const BAR_W_COMPACT = 22;
export const BAR_W_TILE = 58;
export const BAR_W_OSD = 200;

// ---------------------------------------------------------------------------
// Motion: ONE place for every animation length (ms) and easing. Animations of the
// same kind use the same entry, so the interface moves with one rhythm.
// (Dwell times - how long a popup stays - are not animations; they stay with their feature.)
//
//   kind        what                                             duration      easing
//   fade in     something appears / gets bright                 FADE_IN_MS    EASE_FADE
//   fade out    something goes away                             FADE_OUT_MS   EASE_FADE
//   slide in    a panel / row / page slides + fades in          SLIDE_IN_MS   EASE_SLIDE
//   snap        a small control moves (switch knob)             SNAP_MS       EASE_SLIDE
//   pop         scale-up with a little overshoot                POP_MS        EASE_POP
//   glide       a value moves (bars, ring, progress)            GLIDE_MS      EASE_SLIDE
//   colour      palette / tint changes                          COLOUR_MS     EASE_FADE
//   text swap   old text leaves, new text arrives               TEXT_OUT_MS / TEXT_IN_MS
//   live        follows a control that is being dragged         LIVE_MS       EASE_FADE
//   ambient     endless slow loops (flow, glow, pulse)          AMBIENT_*     EASE_LOOP
// ---------------------------------------------------------------------------
export const FADE_IN_MS = 220;
export const FADE_OUT_MS = 120;
export const SLIDE_IN_MS = 260;
export const SNAP_MS = 200;
export const POP_MS = 400;
export const GLIDE_MS = 500;
export const COLOUR_MS = 700;
export const TEXT_OUT_MS = 150;
export const TEXT_IN_MS = 340;
export const LIVE_MS = 120;
export const FLASH_MS = 340;
export const COVER_FADE_MS = 460;
export const AMBIENT_SLOW_MS = 4800;
export const AMBIENT_PULSE_MS = 1700;
export const AMBIENT_ICON_MS = 700;
// Expanded island: rows glide in one after the other (a slide-in per row)
export const STAGGER_MS = SLIDE_IN_MS;
export const STAGGER_STEP_MS = 45;     // delay between rows
export const STAGGER_RISE = 10;        // px each row rises from

export const EASE_FADE = Clutter.AnimationMode.EASE_OUT_QUAD;
export const EASE_SLIDE = Clutter.AnimationMode.EASE_OUT_CUBIC;
export const EASE_POP = Clutter.AnimationMode.EASE_OUT_BACK;
export const EASE_LEAVE = Clutter.AnimationMode.EASE_IN_QUAD;
export const EASE_LOOP = Clutter.AnimationMode.EASE_IN_OUT_SINE;
export const EASE_COLOUR_TIMELINE = Clutter.AnimationMode.EASE_IN_OUT_QUAD;
