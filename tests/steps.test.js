import test from 'node:test';
import assert from 'node:assert/strict';
import { GEODESIC, impactParameter, minimumRadius, shadowAngularRadius, traceRay } from '../src/geodesic.js';

test('default-view integration averages at most forty steps per pixel', () => {
  const width = 180;
  const height = 112;
  let defaultMean;
  for (const r of [23, 8]) {
    let total = 0;
    let maximum = 0;
    let exhausted = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // Zero gaze points inward at every orbital pose; include the desktop framing offset.
        const sx = ((x + 0.5) / width * 2 - 1 + 0.13) * width / height;
        const sy = (y + 0.5) / height * 2 - 1;
        const psi = Math.atan(Math.tan(GEODESIC.halfFov) * Math.hypot(sx, sy));
        // The shader bypasses integration above the shared weak-field cutoff.
        const ray = impactParameter(r, psi) >= GEODESIC.weakEnd ? { steps: 0 }
          : traceRay({ r, psi, quality: 'high' });
        total += ray.steps;
        maximum = Math.max(maximum, ray.steps);
        exhausted += Number(Boolean(ray.exhausted));
      }
    }
    const mean = total / (width * height);
    console.log(`steps ${width}x${height} r=${r} HIGH: mean=${mean.toFixed(3)} max=${maximum} exhausted=${exhausted}`);
    assert.equal(exhausted, 0, `r=${r} must finish every sampled ray`);
    if (r === 23) defaultMean = mean;
  }
  assert.ok(defaultMean <= 40, `default-view mean ${defaultMean} exceeds forty steps`);
});

test('reduced budgets finish resolved rays in every quality mode', () => {
  for (const quality of ['high', 'balanced', 'performance']) {
    let maximum = 0;
    for (const L of [0, 0.5, 0.85, 1, 2]) {
      for (const radius of [1.03, 1.2, 1.5, 2, 3, 8, 23, 65, 1e5]) {
        const r = Math.max(radius, minimumRadius(L));
        const alpha = shadowAngularRadius(r, L);
        const angles = Array.from({ length: 361 }, (_, i) => i * Math.PI / 360);
        angles.push(alpha - 1e-5, alpha + 1e-5);
        for (const psi of angles) {
          // An exactly critical orbit has infinite dwell time and is masked analytically in GLSL.
          if (psi <= 0 || psi >= Math.PI || Math.abs(psi - alpha) < 1e-8) continue;
          const ray = traceRay({ r, psi, L, quality });
          assert.equal(ray.exhausted, false, `${quality}, r=${r}, L=${L}, psi=${psi}`);
          maximum = Math.max(maximum, ray.steps);
        }
      }
    }
    console.log(`resolved-ray maximum ${quality}: ${maximum}/${GEODESIC[`${quality}Steps`]}`);
  }
});
