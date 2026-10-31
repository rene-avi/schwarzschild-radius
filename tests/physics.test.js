import test from 'node:test';
import assert from 'node:assert/strict';
import {
  G, C, SOLAR_MASS, schwarzschildRadius, timeDilation, dopplerFactor,
  createProbe, updateProbe,
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

test('a stationary emitter has no Doppler shift in every direction', () => {
  for (const direction of [-1, 0, 1]) assert.equal(dopplerFactor(0, direction), 1);
});

test('approaching light blueshifts, receding light redshifts, and transverse light dilates', () => {
  near(dopplerFactor(0.6, 1), 2);
  near(dopplerFactor(0.6, -1), 0.5);
  near(dopplerFactor(0.6, 0), 0.8);
  near(dopplerFactor(0.6, 1) * dopplerFactor(0.6, -1), 1);
  near(dopplerFactor(-0.6, -1), 2);
});

test('unphysical Doppler inputs are rejected', () => {
  for (const beta of [1, -1, 2, NaN, Infinity]) {
    assert.throws(() => dopplerFactor(beta, 1), RangeError);
  }
  for (const direction of [-1.1, 1.1, NaN]) {
    assert.throws(() => dopplerFactor(0.5, direction), RangeError);
  }
});

test('a released probe falls, slows its clock, and never crosses the visible horizon', () => {
  const probe = createProbe();
  const initialDilation = probe.dilation;
  for (let frame = 0; frame < 60 * 40; frame++) updateProbe(probe, 1 / 60);
  assert.equal(probe.state, 'frozen');
  assert.ok(probe.radius > 1 && probe.radius < 1.02);
  assert.ok(probe.dilation < initialDilation);
  assert.ok(probe.properElapsed > 0 && probe.properElapsed < probe.elapsed);
  const frozen = { ...probe };
  updateProbe(probe, 1);
  assert.deepEqual(probe, frozen);
});

test('pausing time freezes a probe and time scaling controls its trajectory', () => {
  const paused = createProbe();
  updateProbe(paused, 10, 0);
  assert.deepEqual(paused, createProbe());
  const fast = updateProbe(createProbe(), 1, 2);
  const ordinary = updateProbe(createProbe(), 2, 1);
  assert.equal(fast.radius, ordinary.radius);
  assert.equal(fast.elapsed, ordinary.elapsed);
});

test('probe radial motion is independent of frame subdivision', () => {
  const oneStep = updateProbe(createProbe(), 1);
  const manySteps = createProbe();
  for (let i = 0; i < 60; i++) updateProbe(manySteps, 1 / 60);
  near(oneStep.radius, manySteps.radius);
  near(oneStep.dilation, manySteps.dilation);
});

test('invalid probe time increments are rejected', () => {
  assert.throws(() => updateProbe(createProbe(), -1), RangeError);
  assert.throws(() => updateProbe(createProbe(), 1, -1), RangeError);
  assert.throws(() => updateProbe(createProbe(), Infinity), RangeError);
});
