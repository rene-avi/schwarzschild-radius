import test from 'node:test';
import assert from 'node:assert/strict';
import { GEODESIC, impactParameter, localToFlatAngle, shadowAngularRadius, shiftFactor, traceRay } from '../src/geodesic.js';

const degrees = radians => radians * 180 / Math.PI;

test('static observer shadow angles match independent reference values', () => {
  for (const [r, angle] of [[23, 6.343], [8, 17.685], [3, 45], [2, 66.716], [1.5, 90], [1.2, 117.89], [1.03, 154.50]]) {
    const actual = degrees(shadowAngularRadius(r));
    console.log(`shadow r=${r}: ${actual.toFixed(6)} deg`);
    assert.ok(Math.abs(actual - angle) < 0.01, `r=${r}: ${actual} vs ${angle}`);
  }
});

test('local frame mapping conserves the Schwarzschild impact parameter', () => {
  for (const r of [1.03, 1.2, 1.5, 3, 23, 1000]) {
    for (const psi of [0.1, 0.8, 1.6, 2.9]) {
      const flat = localToFlatAngle(r, psi);
      assert.ok(Math.abs(Math.tan(flat) - Math.tan(psi) / Math.sqrt(1 - 1 / r)) < 1e-10);
      const h = r * Math.sin(flat);
      const inferred = h / Math.sqrt(1 - h * h / (r * r * r));
      assert.ok(Math.abs(inferred - impactParameter(r, psi)) < 1e-10);
      assert.equal(flat > Math.PI / 2, psi > Math.PI / 2);
    }
  }
});

test('integrated capture boundary agrees within half a degree at high quality', () => {
  for (const r of [23, 8, 3, 2, 1.2]) {
    let low = 0;
    let high = Math.PI;
    // Resolve to 0.001 degrees without demanding infinite critical-ray dwell time.
    while (degrees(high - low) > 0.001) {
      const mid = (low + high) / 2;
      const result = traceRay({ r, psi: mid, L: 1, quality: 'high' });
      assert.equal(result.exhausted, false, `r=${r}, psi=${degrees(mid)} exhausted`);
      if (result.captured) low = mid;
      else high = mid;
    }
    const error = degrees((low + high) / 2 - shadowAngularRadius(r));
    console.log(`capture boundary r=${r}: error ${error.toFixed(6)} deg`);
    assert.ok(Math.abs(error) < 0.5, `r=${r}: ${error} deg`);
  }
});

test('integrated weak deflection matches the second order expansion within two percent', () => {
  const r = 100000;
  for (const b of [20, 50]) {
    const psi = Math.asin(b / r * Math.sqrt(1 - 1 / r));
    const result = traceRay({ r, psi });
    const expected = 2 / b + 15 * Math.PI / 16 / (b * b);
    console.log(`weak b=${b}: ${result.deflection}, expected ${expected}`);
    assert.equal(result.escaped, true);
    assert.ok(Math.abs(result.deflection / expected - 1) < 0.02);
  }
});

test('frequency shift has equal-radius, infinity, flat and reciprocal limits', () => {
  assert.equal(shiftFactor(3, 3), 1);
  assert.equal(shiftFactor(Infinity, Infinity), 1);
  assert.ok(Math.abs(shiftFactor(2, Infinity) - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(shiftFactor(Infinity, 2) - Math.SQRT2) < 1e-12);
  assert.ok(Math.abs(shiftFactor(3, 2) * shiftFactor(2, 3) - 1) < 1e-12);
  assert.equal(shiftFactor(2, 3, 0), 1);
  assert.throws(() => shiftFactor(1, 2), RangeError);
});

test('lensing scales the photon sphere and flat rays leave a black ball', () => {
  for (const L of [0.85, 1, 2]) {
    assert.ok(Math.abs(shadowAngularRadius(1.5 * L, L) - Math.PI / 2) < 1e-7);
  }
  assert.equal(traceRay({ r: 23, psi: 0, L: 0 }).captured, true);
  const flat = traceRay({ r: 23, psi: 0.3, L: 0 });
  assert.equal(flat.escaped, true);
  assert.ok(Math.abs(flat.deflection) < 1e-5);
  assert.ok(Math.abs(shadowAngularRadius(1e6) * 1e6 - GEODESIC.criticalImpact) < 0.00001);
});
