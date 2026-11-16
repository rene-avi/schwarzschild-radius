import test from 'node:test';
import assert from 'node:assert/strict';
import { GEODESIC, impactParameter, shadowAngularRadius, traceRay } from '../src/geodesic.js';

// A fixed, fine angular grid independently checks phase accuracy after adaptive stepping.
function fineEscape(r, psi) {
  const b = impactParameter(r, psi);
  let u = 1 / r;
  let v = Math.cos(psi) / b;
  let phi = 0;
  const h = 0.001;
  const acceleration = u => 1.5 * u * u - u;
  for (let i = 0; i < 50000; i++) {
    assert.ok(u < 1 / GEODESIC.captureRadius, 'reference ray must escape');
    const a1 = acceleration(u);
    const v2 = v + a1 * h / 2;
    const a2 = acceleration(u + v * h / 2);
    const v3 = v + a2 * h / 2;
    const a3 = acceleration(u + v2 * h / 2);
    const v4 = v + a3 * h;
    const a4 = acceleration(u + v3 * h);
    const nextU = u + h / 6 * (v + 2 * v2 + 2 * v3 + v4);
    v += h / 6 * (a1 + 2 * a2 + 2 * a3 + a4);
    if (nextU <= 0) return phi + h * u / (u - nextU);
    u = nextU;
    phi += h;
  }
  assert.fail('fine reference exhausted');
}

test('adaptive HIGH escape directions agree with fine integration near the shadow and across the sky', () => {
  let maximum = 0;
  for (const r of [23, 8, 3, 1.5, 1.03]) {
    const alpha = shadowAngularRadius(r);
    for (const fraction of [1e-4, 1e-3, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.99]) {
      const psi = alpha + (Math.PI - alpha) * fraction;
      const reference = fineEscape(r, psi);
      const ray = traceRay({ r, psi });
      assert.equal(ray.escaped, true);
      const phi = Math.atan2(ray.direction[1], ray.direction[0]);
      const error = Math.abs(Math.atan2(Math.sin(phi - reference), Math.cos(phi - reference)));
      maximum = Math.max(maximum, error);
      assert.ok(error < 0.001, `r=${r}, fraction=${fraction}, error=${error} rad`);
    }
  }
  console.log(`HIGH outgoing direction: maximum fine-reference error ${(maximum * 180 / Math.PI).toFixed(6)} deg`);
});
