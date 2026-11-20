// Damped spring for the island morph (pure maths, no GNOME imports, unit-tested).
//
// Each channel (x, y, width, height) is a mass on a spring pulled toward its
// target. Unlike a fixed easing curve, a spring keeps its velocity when the
// target changes mid-flight (hover in, out, in again): it turns around smoothly
// instead of restarting from zero.
//
//   response  seconds for one undamped oscillation (smaller = snappier)
//   damping   damping ratio: 1 = no overshoot, < 1 = a little bounce

const STEP = 1 / 240;          // fixed sub-step (s): stable at any frame rate
const MAX_DT = 1 / 20;         // a long frame (stall) is not simulated in full
const REST_POS = 0.35;         // px
const REST_VEL = 6;            // px/s

export class Spring {
    constructor(response = 0.42, damping = 0.78) {
        this.configure(response, damping);
        this.x = 0;
        this.v = 0;
        this.target = 0;
    }

    configure(response, damping) {
        const w = 2 * Math.PI / Math.max(0.05, response);
        this.k = w * w;                 // stiffness (mass = 1)
        this.c = 2 * damping * w;       // damping coefficient
    }

    /** Jump to `x` with no velocity. */
    reset(x) {
        this.x = this.target = x;
        this.v = 0;
    }

    step(dt) {
        let left = Math.min(dt, MAX_DT);
        while (left > 1e-9) {
            const h = Math.min(STEP, left);
            // semi-implicit Euler: stable for stiff springs
            this.v += (-this.k * (this.x - this.target) - this.c * this.v) * h;
            this.x += this.v * h;
            left -= h;
        }
        return this.x;
    }

    get resting() {
        return Math.abs(this.x - this.target) < REST_POS && Math.abs(this.v) < REST_VEL;
    }
}

/** A group of springs (one per key) that rest together. */
export class SpringGroup {
    constructor(keys) {
        this.keys = keys;
        this.s = Object.fromEntries(keys.map(k => [k, new Spring()]));
        this.start = null;
    }

    configure(response, damping) {
        for (const k of this.keys)
            this.s[k].configure(response, damping);
    }

    reset(values) {
        for (const k of this.keys)
            this.s[k].reset(values[k]);
    }

    /** New target; positions and velocities carry over. `keepStart`: same morph, refined target. */
    retarget(values, keepStart = false) {
        if (!keepStart || !this.start)
            this.start = this.values();
        for (const k of this.keys)
            this.s[k].target = values[k];
    }

    step(dt) {
        for (const k of this.keys)
            this.s[k].step(dt);
        return this.values();
    }

    values() {
        return Object.fromEntries(this.keys.map(k => [k, this.s[k].x]));
    }

    get resting() {
        return this.keys.every(k => this.s[k].resting);
    }

    targets() {
        return Object.fromEntries(this.keys.map(k => [k, this.s[k].target]));
    }

    /** 0 at the retarget point -> 1 at the target (largest channel; may pass 1 on overshoot). */
    get progress() {
        if (!this.start)
            return 1;
        let worst = 1, any = false;
        for (const k of this.keys) {
            const span = this.s[k].target - this.start[k];
            if (Math.abs(span) < 1)
                continue;
            any = true;
            worst = Math.min(worst, (this.s[k].x - this.start[k]) / span);
        }
        return any ? worst : 1;
    }
}
