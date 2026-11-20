// gjs -m tests/spring.test.js
import {Spring, SpringGroup} from '../dynamic-island@10sinan.github.io/lib/spring.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; print(`FAIL ${m}`); } };

function settle(s, damping, response = 0.42) {
    s.configure(response, damping);
    s.reset(0);
    s.target = 300;
    let t = 0, peak = 0, arrive = null;
    while (!s.resting && t < 5) {
        s.step(1 / 60);
        t += 1 / 60;
        peak = Math.max(peak, s.x);
        if (arrive === null && Math.abs(s.x - 300) < 3)
            arrive = t;
    }
    return {t, peak, arrive};
}

const crit = settle(new Spring(), 1);
ok(crit.peak <= 300.5, `critically damped must not overshoot (peak ${crit.peak})`);
ok(crit.t < 1.2, `critically damped rests quickly (${crit.t.toFixed(2)} s)`);
const bouncy = settle(new Spring(), 0.74);
ok(bouncy.peak > 302 && bouncy.peak < 315, `small bounce (peak ${bouncy.peak.toFixed(1)})`);
ok(bouncy.arrive < 0.45, `arrives within ~the response (${bouncy.arrive.toFixed(2)} s)`);
print(`  crit: rest ${crit.t.toFixed(2)} s · bouncy: arrive ${bouncy.arrive.toFixed(2)} s, peak ${bouncy.peak.toFixed(1)}, rest ${bouncy.t.toFixed(2)} s`);

// retarget keeps velocity: reversing mid-flight does not jump
const s = new Spring(0.42, 0.74);
s.reset(0);
s.target = 300;
for (let i = 0; i < 10; i++)
    s.step(1 / 60);
const x = s.x, v = s.v;
s.target = 0;
ok(s.x === x && s.v === v, 'retarget keeps position and velocity');
s.step(1 / 60);
ok(s.x > x, 'momentum carries on for a moment after reversing');

// stall: a long frame does not explode
const z = new Spring(0.42, 0.74);
z.reset(0);
z.target = 100;
z.step(5);
ok(Number.isFinite(z.x) && Math.abs(z.x) < 200, `stable after a stall (${z.x})`);

// group progress
const g = new SpringGroup(['x', 'w']);
g.reset({x: 100, w: 50});
g.retarget({x: 0, w: 450});
ok(g.progress === 0, 'progress starts at 0');
for (let i = 0; i < 120 && !g.resting; i++)
    g.step(1 / 60);
ok(g.resting && Math.abs(g.progress - 1) < 0.01, 'group rests at the target');

print(fails ? `${fails} FAILED` : 'spring ok');
imports.system.exit(fails ? 1 : 0);
