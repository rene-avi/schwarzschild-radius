import test from 'node:test';
import assert from 'node:assert/strict';
import {
  G, C, SOLAR_MASS, schwarzschildRadius, timeDilation,
  createProbe, updateProbe, probeCycloid, probeProperTime, probeCoordinateTime,
  tortoiseRadius, probeSignal, probeArrivalTime, probeReceptionTime, probeObservedEvent, probeRadiusAtCoordinateTime,
  probePulse,
} from '../src/physics.js';

function near(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≉ ${expected}`);
}

test('physical constants use SI units', () => {
  assert.equal(C, 299_792_458);
  assert.equal(G, 6.67430e-11);
  assert.equal(SOLAR_MASS, 1.98847e30);
});

test('one solar mass has a Schwarzschild radius of approximately 2.953 km', () => {
  near(schwarzschildRadius(1), 2953.34, 0.02);
  near(schwarzschildRadius(4_300_000) / 1e9, 12.6994, 0.001);
});

test('Schwarzschild radius scales linearly with mass and vanishes at zero', () => {
  assert.equal(schwarzschildRadius(0), 0);
  near(schwarzschildRadius(100) / schwarzschildRadius(1), 100);
});

test('invalid masses are rejected', () => {
  for (const mass of [-1, NaN, Infinity, '10']) {
    assert.throws(() => schwarzschildRadius(mass), RangeError);
  }
});

test('time dilation is zero at and within the horizon and unity at infinity', () => {
  assert.equal(timeDilation(1), 0);
  assert.equal(timeDilation(0.5), 0);
  assert.equal(timeDilation(Infinity), 1);
  assert.equal(timeDilation(10, 0), 1);
});

test('time dilation matches known Schwarzschild values and respects physical scaling', () => {
  near(timeDilation(2), Math.SQRT1_2);
  near(timeDilation(4 / 3), 0.5);
  near(timeDilation(6000, 3000), Math.SQRT1_2);
  assert.ok(timeDilation(1.01) < timeDilation(2));
  assert.ok(timeDilation(2) < timeDilation(100));
});

test('invalid dilation inputs are rejected', () => {
  assert.throws(() => timeDilation(NaN), RangeError);
  assert.throws(() => timeDilation(2, -1), RangeError);
  assert.throws(() => timeDilation(2, Infinity), RangeError);
});

// Integrate r''=-1/(2r²), t'=E/f independently in proper time, including release from rest.
function integrateFall(properTime, step = 0.0005) {
  const energy = Math.sqrt(6 / 7);
  const derivative = ([r, v]) => [v, -0.5 / (r * r), energy / (1 - 1 / r)];
  const add = (y, k, h) => y.map((v, i) => v + h * k[i]);
  let y = [7, 0, 0];
  const count = Math.ceil(properTime / step);
  const h = properTime / count;
  for (let i = 0; i < count; i++) {
    const a = derivative(y);
    const b = derivative(add(y, a, h / 2));
    const c = derivative(add(y, b, h / 2));
    const d = derivative(add(y, c, h));
    y = y.map((v, j) => v + h / 6 * (a[j] + 2 * b[j] + 2 * c[j] + d[j]));
  }
  return { radius: y[0], radialVelocity: y[1], coordinateTime: y[2] };
}

test('cycloid and analytic coordinate time agree with independent timelike integration', () => {
  for (const radius of [6.9, 5, 3, 1.5, 1.02]) {
    const properTime = probeProperTime(radius);
    const numeric = integrateFall(properTime);
    near(numeric.radius, radius, 2e-9);
    near(numeric.radialVelocity ** 2, 1 / radius - 1 / 7, 2e-9);
    near(numeric.coordinateTime, probeCoordinateTime(radius), 2e-7);
    const cycloid = probeCycloid(2 * Math.acos(Math.sqrt(radius / 7)));
    near(cycloid.radius, radius, 1e-13);
    near(cycloid.properElapsed, properTime);
  }
});

test('onboard clock reaches the horizon and singularity in finite proper time', () => {
  near(probeProperTime(1), 28.3939046924635, 1e-12);
  near(probeProperTime(0), Math.PI / 2 * 7 ** 1.5);
  near(probeProperTime(0), 29.09155508723129, 1e-12);
  assert.ok(probeProperTime(1) < probeProperTime(0));
  near(probeCycloid(Math.PI).radius, 0);
});

test('coordinate time grows monotonically with a logarithmic horizon divergence', () => {
  assert.equal(probeCoordinateTime(7), 0);
  let previous = 0;
  for (const radius of [6.99, 6, 3, 1.1, 1.001, 1 + 1e-6, 1 + 1e-9, 1 + 1e-12]) {
    const time = probeCoordinateTime(radius);
    assert.ok(time > previous);
    near(probeRadiusAtCoordinateTime(time), radius, 2e-12);
    previous = time;
  }
  near(probeCoordinateTime(1 + 1e-9) - probeCoordinateTime(1 + 1e-6), Math.log(1000), 5e-6);
  assert.equal(probeCoordinateTime(1), Infinity);
});

test('radial redshift follows photon and emitter four-vectors, including both limits', () => {
  const energy = Math.sqrt(6 / 7);
  const observer = 23;
  const observerLapse = Math.sqrt(1 - 1 / observer);
  near(probeSignal(7, observer), energy / observerLapse);
  near(probeSignal(7, Infinity), energy);
  assert.equal(probeSignal(1, observer), 0);
  for (const r of [6, 3, 1.5, 1.01]) {
    const f = 1 - 1 / r;
    const velocity = -Math.sqrt(energy ** 2 - f);
    // k^mu=(1/f,1), u_emit^mu=(E/f,velocity), metric=(-f,1/f).
    const frequencyEmit = f * (1 / f) * (energy / f) - velocity / f;
    const frequencyObs = 1 / observerLapse;
    near(probeSignal(r, observer), frequencyObs / frequencyEmit, 1e-13);
    const frequencyStatic = f * (1 / f) / Math.sqrt(f);
    near(frequencyObs / frequencyStatic, Math.sqrt(f) / observerLapse);
  }
  let previous = Infinity;
  for (let i = 0; i <= 600; i++) {
    const g = probeSignal(7 - i / 100, observer);
    assert.ok(g < previous);
    previous = g;
  }
});

test('reception starts when release is seen and retains differential tortoise delay', () => {
  const delay = tortoiseRadius(23) - tortoiseRadius(7);
  near(delay, 17.29928298413026);
  const released = createProbe();
  near(released.arrivalDelay, delay);
  assert.equal(probeObservedEvent(0).radius, 7);
  assert.equal(probeObservedEvent(0).properElapsed, 0);
  updateProbe(released, 1 / 60);
  assert.ok(released.radius < 7);
  assert.ok(released.properElapsed > 0 && released.observerElapsed > 0);
  near(released.lostTime, 47.596258, 1e-5);
  for (const r of [6.9, 5, 3, 1.5, 1.01]) {
    const reception = probeReceptionTime(r);
    near(probeArrivalTime(r), probeCoordinateTime(r) + tortoiseRadius(23) - tortoiseRadius(r));
    near(reception, probeCoordinateTime(r) + tortoiseRadius(7) - tortoiseRadius(r));
    const seen = probeObservedEvent(reception);
    near(seen.radius, r, 1e-12);
    near(seen.properElapsed, probeProperTime(r), 1e-12);
    assert.ok(seen.radius >= probeRadiusAtCoordinateTime(reception + delay));
  }
  for (let time = 0; time < 90; time += 0.5) {
    assert.ok(probeObservedEvent(time).radius >= probeRadiusAtCoordinateTime(time));
    assert.ok(probeObservedEvent(time).radius >= probeRadiusAtCoordinateTime(time + delay));
  }
});

test('late ln g slope against coordinate reception time is minus one half', () => {
  const times = [1 + 1e-4, 1 + 1e-5, 1 + 1e-6].map(r => probeReceptionTime(r));
  const logSignals = times.map(time => Math.log(probeObservedEvent(time).signal));
  for (let i = 1; i < times.length; i++) {
    const slope = (logSignals[i] - logSignals[i - 1]) / (times[i] - times[i - 1]);
    assert.ok(Math.abs(slope / -0.5 - 1) < 0.05, `late slope ${slope}`);
  }
});

test('received clock rate equals the frequency shift relative to the receiver proper clock', () => {
  for (const r of [6, 3, 1.1]) {
    const time = probeReceptionTime(r);
    const h = 0.0001;
    const rate = (probeObservedEvent(time + h).properElapsed - probeObservedEvent(time - h).properElapsed)
      / (2 * h * Math.sqrt(22 / 23));
    near(rate, probeSignal(r), 2e-8);
  }
});

test('probe transitions through fading to lost and keeps the exact cutoff snapshot', () => {
  const probe = createProbe();
  assert.equal(probe.state, 'falling');
  updateProbe(probe, probeReceptionTime(1.5));
  assert.equal(probe.state, 'fading');
  assert.ok(probe.signal < 0.25);
  near(probe.properElapsed, probeProperTime(1.5));
  assert.ok(probe.trail.length >= 2 && probe.trail.length <= 8);
  for (const event of probe.trail) {
    assert.ok(event.radius > probe.radius);
    assert.ok(event.properElapsed < probe.properElapsed);
    assert.equal(event.properElapsed, Math.floor(event.properElapsed));
    assert.ok(event.age > 0 && event.age < 12);
    near(event.radius, probeObservedEvent(probe.elapsed - event.age).radius);
  }
  updateProbe(probe, 1000);
  assert.equal(probe.state, 'lost');
  assert.ok(probe.signal < 0.02);
  assert.ok(probe.properElapsed > 28.3 && probe.properElapsed < probeProperTime(1));
  assert.equal(probe.trail.length, 0);
  assert.equal(probe.pulse, 0);
  assert.equal(probe.flashCount, 28);
  assert.equal(probe.flashTotal, 28);
  near(probe.observerElapsed, probe.elapsed * Math.sqrt(22 / 23));
  const snapshot = structuredClone(probe);
  updateProbe(probe, 1000);
  assert.deepEqual(probe, snapshot);
  assert.deepEqual(probe, updateProbe(createProbe(), 2000));
});

test('received pulse count between reception times equals the change in floored onboard time', () => {
  const probe = createProbe();
  let previousPulse = probe.pulse;
  let received = 0;
  const flashes = [];
  for (const end of [15, 35, probe.lostTime]) {
    const startProper = probe.properElapsed;
    const startCount = received;
    while (probe.elapsed < end) {
      updateProbe(probe, Math.min(0.02, end - probe.elapsed));
      if (probe.pulse > previousPulse) {
        received++;
        flashes.push(probe.elapsed);
      }
      previousPulse = probe.pulse;
    }
    assert.equal(received - startCount, Math.floor(probe.properElapsed) - Math.floor(startProper));
    assert.equal(probe.flashCount, received);
  }
  assert.equal(flashes.length, 28);
  assert.ok(flashes.filter(time => time <= 15).length >= 6);
});

test('the last received flash interval before loss is at least 3.5 times the first', () => {
  const first = updateProbe(createProbe(), 3).trail;
  const last = updateProbe(createProbe(), 44).trail;
  assert.deepEqual(first.slice(0, 2).map(event => event.properElapsed), [2, 1]);
  assert.deepEqual(last.slice(0, 2).map(event => event.properElapsed), [28, 27]);
  const firstInterval = first[0].receptionTime - first[1].receptionTime;
  const lastInterval = last[0].receptionTime - last[1].receptionTime;
  assert.ok(lastInterval >= firstInterval * 3.5, `first ${firstInterval}, last ${lastInterval}`);
});

test('pulse phase is the fractional received proper time and freezes with pause', () => {
  assert.equal(probePulse(0), 1);
  assert.equal(probePulse(12), 1);
  near(probePulse(12.11), 0.5);
  assert.equal(probePulse(12.5), 0);
  const probe = updateProbe(createProbe(), 15);
  assert.equal(probe.pulse, probePulse(probe.properElapsed));
  const snapshot = structuredClone(probe);
  updateProbe(probe, 2, 0);
  assert.deepEqual(probe, snapshot);
});

test('pause and time scaling preserve every probe readout and trail', () => {
  const paused = updateProbe(createProbe(), 45);
  const snapshot = structuredClone(paused);
  updateProbe(paused, 10, 0);
  updateProbe(paused, 0, 4);
  assert.deepEqual(paused, snapshot);
  assert.deepEqual(updateProbe(createProbe(), 15, 3), updateProbe(createProbe(), 45));
});

test('all probe readouts, trail and cutoff are independent of frame subdivision', () => {
  for (const duration of [6, 20, 36, 60, 100]) {
    const oneStep = updateProbe(createProbe(), duration);
    const manySteps = createProbe();
    for (let i = 0; i < duration * 60; i++) updateProbe(manySteps, 1 / 60);
    assert.equal(oneStep.state, manySteps.state);
    for (const key of ['radius', 'signal', 'properElapsed', 'emissionTime', 'elapsed', 'observerElapsed', 'pulse', 'flashCount']) {
      near(oneStep[key], manySteps[key], 1e-10);
    }
    assert.deepEqual(oneStep.trail, manySteps.trail);
  }
});

test('probe release direction is normalized and independent of fall time', () => {
  const probe = createProbe({ direction: [3, 4, 0], observerRadius: 7 });
  assert.deepEqual(probe.direction, [0.6, 0.8, 0]);
  updateProbe(probe, 20);
  assert.deepEqual(probe.direction, [0.6, 0.8, 0]);
  assert.equal(probe.arrivalDelay, 0);
});

test('invalid probe inputs are rejected', () => {
  for (const dt of [-1, NaN, Infinity, '1']) assert.throws(() => updateProbe(createProbe(), dt), RangeError);
  for (const scale of [-1, NaN, Infinity, '1']) assert.throws(() => updateProbe(createProbe(), 1, scale), RangeError);
  assert.throws(() => updateProbe(createProbe(), 1e308, 1e308), RangeError);
  assert.throws(() => updateProbe({}, 1), RangeError);
  for (const direction of [[], [0, 0, 0], [1, 2, NaN], [1, Infinity, 2], [Number.MAX_VALUE, Number.MAX_VALUE, 0], 'bad']) {
    assert.throws(() => createProbe({ direction }), RangeError);
  }
  for (const observerRadius of [0, 1, 6, NaN, Infinity, '23']) {
    assert.throws(() => createProbe({ observerRadius }), RangeError);
  }
  for (const time of [-1, NaN, Infinity, '1']) {
    assert.throws(() => probeObservedEvent(time), RangeError);
    assert.throws(() => probeRadiusAtCoordinateTime(time), RangeError);
    assert.throws(() => probePulse(time), RangeError);
  }
  for (const eta of [-1, NaN, Infinity, Math.PI + 0.1]) assert.throws(() => probeCycloid(eta), RangeError);
  for (const r0 of [0, 1, NaN, Infinity]) assert.throws(() => probeCycloid(1, r0), RangeError);
  for (const radius of [-1, 8, NaN, Infinity]) assert.throws(() => probeProperTime(radius), RangeError);
  for (const radius of [0.9, 8, NaN, Infinity]) {
    assert.throws(() => probeCoordinateTime(radius), RangeError);
    assert.throws(() => probeSignal(radius), RangeError);
    assert.throws(() => probeArrivalTime(radius), RangeError);
    assert.throws(() => probeReceptionTime(radius), RangeError);
  }
  for (const radius of [0, 1, NaN, Infinity]) assert.throws(() => tortoiseRadius(radius), RangeError);
  assert.throws(() => probeSignal(3, 1), RangeError);
});
