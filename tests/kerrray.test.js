import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { KERR_RAY, traceRay, horizon, blRadius, observerFrame, invariants, criticalCurve, curveRadius,
  emitterShift, diskInnerRadius, pictureSpin, kerrFlowGLSL } from '../src/kerrray.js';
import { traceRay as schwarzschild, GEODESIC } from '../src/geodesic.js';
import { iscoRadius } from '../src/kerr.js';
import { fragmentShader, kerrFragmentShader } from '../src/shaders/blackhole.js';
import { createRayMaterial } from '../src/scene.js';

const metrics = {};
const close = (a, b, tolerance, label) => assert.ok(Math.abs(a - b) < tolerance, `${label}: ${a} versus ${b}`);
const angularError = (a, b) => 2 * Math.asin(Math.min(1, Math.hypot(...a.map((v, i) => v - b[i])) / 2));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const at = inclination => [0, 23 * Math.cos(inclination * Math.PI / 180), 23 * Math.sin(inclination * Math.PI / 180)];

test('Kerr switch preserves the exact evaluated default shader and an empty material defines map', () => {
  assert.equal(fragmentShader.length, 34856);
  assert.equal(createHash('sha256').update(fragmentShader).digest('hex'), '807d3babe5295a8d78f9f5b628b3f07ac866077d69b8d153bd0bd4eb8d0a9af8');
  const material = createRayMaterial({});
  assert.equal(material.fragmentShader, fragmentShader);
  assert.deepEqual(material.defines, {});
  const kerr = createRayMaterial({}, 'kerr');
  assert.equal(kerr.fragmentShader, kerrFragmentShader);
  assert.deepEqual(kerr.defines, {});
  assert.ok(kerrFragmentShader.includes(kerrFlowGLSL));
  assert.doesNotMatch(kerrFragmentShader, /weakShortcut|photonRing|worldRadiance|probeEmission/);
  material.dispose(); kerr.dispose();
});

test('zero-spin Kerr rays reproduce Schwarzschild strong-field deflection at b=2.7 through 20', () => {
  let maximum = 0;
  for (const b of [2.7, 2.8, 3, 3.5, 4, 5, 6, 8, 10, 12, 15, 20]) {
    const psi = Math.asin(b * Math.sqrt(1 - 1 / 23) / 23);
    const reference = schwarzschild({ r: 23, psi, stepScale: 0.1 });
    const ray = traceRay({ position: [0, 0, 23], direction: [-Math.cos(psi), 0, Math.sin(psi)], spin: 0 });
    assert.equal(ray.fate, 'escaped');
    const error = angularError(ray.direction, [reference.direction[1], 0, reference.direction[0]]);
    maximum = Math.max(maximum, error);
    assert.ok(error < 1e-4, `b=${b}: ${error}`);
  }
  metrics.schwarzschildMaximumRadians = maximum;
});

test('finite-distance ZAMO critical curves bracket capture in sixteen screen directions', () => {
  for (const spin of [0.5, 0.9, 0.998]) for (const inclination of [17, 60, 90]) {
    const position = at(inclination), curve = criticalCurve(position, spin, 20000);
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8, rho = curveRadius(curve, angle);
      // Tighten the three leftmost directions around the near-extremal flattened edge.
      const margin = spin === 0.998 && inclination >= 60 && i >= 7 && i <= 9 ? 0.01 : 0.02;
      for (const factor of [1 - margin, 1 + margin]) {
        const ray = traceRay({ position, direction: [-1, -factor * rho * Math.sin(angle), factor * rho * Math.cos(angle)], spin });
        assert.equal(ray.fate, factor < 1 ? 'captured' : 'escaped', `a=${spin}, i=${inclination}, screen=${i}, factor=${factor}`);
      }
    }
  }
  const curve = criticalCurve([0, 0, 23], 0.9, 100000), scale = 450 / Math.tan(GEODESIC.halfFov);
  const left = curveRadius(curve, Math.PI) * scale, right = curveRadius(curve, 0) * scale;
  close(left, 71, 0.2, 'flattened left edge'); close(right, 172, 0.2, 'right edge');
  metrics.edgePixels = { left, right, ratio: left / right };
});

function drift(float32) {
  const worst = { H: 0, Lz: 0, Q: 0 };
  for (let i = 0; i < 20; i++) {
    const spin = [0.5, 0.9, 0.998][i % 3];
    let initial;
    traceRay({ position: [0, 10, 20], direction: [-1, 0.02 + i * 0.0002, (i - 10) * 0.014], spin,
      float32, stepScale: float32 ? 1 : 0.05, onStep(state) {
        const current = invariants(state, spin);
        initial ??= current;
        assert.equal(current.E, initial.E, 'E is exact by construction: p_t is never stepped');
        for (const key of ['H', 'Lz', 'Q']) {
          const error = Math.abs(current[key] - (key === 'H' ? 0 : initial[key])) / initial.E ** 2;
          assert.ok(Number.isFinite(error));
          worst[key] = Math.max(worst[key], error);
        }
      } });
  }
  return worst;
}

test('twenty refined rays conserve H/E², Lz/E² and Carter Q/E² below 1e-8', () => {
  metrics.doubleDrift = drift(false);
  for (const [key, value] of Object.entries(metrics.doubleDrift)) assert.ok(value < 1e-8, `${key}: ${value}`);
});

test('float32 scalar operations in the shared shader step keep invariant drift below 1e-3', () => {
  metrics.float32Drift = drift(true);
  for (const [key, value] of Object.entries(metrics.float32Drift)) assert.ok(value < 1e-3, `${key}: ${value}`);
});

test('axis and off-axis disk frequency shifts agree with independent circular-emitter formulas', () => {
  for (const spin of [0, 0.5, 0.9, 0.998]) {
    const a = spin / 2, ro = 23;
    const ray = traceRay({ position: [0, ro, 0], direction: [-1, 0.2, 0], spin, stepScale: 0.05 });
    assert.ok(ray.diskHits.length > 0);
    for (const hit of ray.diskHits) {
      const r = hit.r;
      const obs = 1 / Math.sqrt(1 - ro / (ro * ro + a * a));
      const em = (r ** 1.5 + a * Math.sqrt(0.5)) / (r ** 0.75 * Math.sqrt(r ** 1.5 - 1.5 * Math.sqrt(r) + 2 * a * Math.sqrt(0.5)));
      close(hit.g, obs / em, 1e-6, 'axis shift');
    }
    // A meridional ray starts above the equator and crosses it on the outgoing limb.
    const position = at(85);
    const edge = traceRay({ position, direction: [-1, 0.04, -0.2], spin, stepScale: 0.05 });
    assert.ok(edge.diskHits.length > 0);
    const frame = observerFrame(position, spin), E = -edge.state.pt;
    for (const hit of edge.diskHits) {
      const r = hit.r, omega = Math.sqrt(0.5) / (r ** 1.5 + a * Math.sqrt(0.5));
      const em = (r ** 1.5 + a * Math.sqrt(0.5)) / (r ** 0.75 * Math.sqrt(r ** 1.5 - 1.5 * Math.sqrt(r) + 2 * a * Math.sqrt(0.5)));
      const obsOverE = frame.ut * (1 - frame.omega * hit.xi);
      close(hit.g, obsOverE / (em * (1 - omega * hit.xi)), 1e-6, 'ZAMO edge shift');
      close(-E * obsOverE, 1, 1e-6, 'initial local energy');
    }
  }
});

test('exactly edge-on ZAMO frequency shift includes the observer frame-dragging factor', () => {
  for (const spin of [0.5, 0.9, 0.998]) {
    const frame = observerFrame([0, 0, 23], spin), a = spin / 2;
    let event;
    traceRay({ position: [0, 0, 23], direction: [-1, 0, -0.15], spin, stepScale: 0.1, onStep(state) {
      const r = blRadius(state.x, spin);
      if (!event && r < 5) event = { r, ...invariants(state, spin), pt: state.pt };
    } });
    assert.ok(event);
    const { r, E, Lz, pt } = event, xi = Lz / E;
    const omega = Math.sqrt(0.5) / (r ** 1.5 + a * Math.sqrt(0.5));
    const em = (r ** 1.5 + a * Math.sqrt(0.5)) / (r ** 0.75 * Math.sqrt(r ** 1.5 - 1.5 * Math.sqrt(r) + 2 * a * Math.sqrt(0.5)));
    const expected = frame.ut * (1 - frame.omega * xi) / (em * (1 - omega * xi));
    close(emitterShift(r, spin, pt, Lz), expected, 1e-6, 'edge-on ZAMO g');
  }
});

test('observer tetrad is orthonormal, zero-angular-momentum and static on both poles', () => {
  for (const spin of [0, 0.5, 0.998]) for (const position of [[0, 0, 23], [3, 7, 17], [0, 23, 0], [0, -23, 0], [0, 0, 1.1]]) {
    const frame = observerFrame(position, spin), vectors = [frame.u, frame.er, frame.et, frame.ep];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      close(dot(vectors[i], frame.covectors[j]), i === j ? (i === 0 ? -1 : 1) : 0, 1e-12, 'tetrad product');
    }
    const [X, Y] = frame.position, p = frame.covectors[0];
    close(X * p[2] - Y * p[1], 0, 1e-12, 'ZAMO angular momentum');
    if (position[0] === 0 && position[2] === 0) assert.deepEqual(frame.u.slice(1), [-0, 0, 0]);
  }
});

test('Kerr disk radius is BL radius and the inner edge is the picture-spin ISCO', () => {
  for (const delta of [1, 0.5, 0.1, 0.002, 1.3e-14]) {
    const spin = pictureSpin(delta), inner = diskInnerRadius(spin);
    close(inner, iscoRadius(Math.max(delta, 0.002)) / 2, 1e-14, 'ISCO');
    const ks = [Math.sqrt(inner * inner + spin * spin / 4), 0, 0];
    close(blRadius(ks, spin), inner, 1e-14, 'BL radius');
  }
  assert.equal(pictureSpin(1.3e-14), 0.998);
});

test('Kerr prograde disk has brighter approaching emission and gas advects with orbital velocity', () => {
  const position = [0, 23 * Math.sin(0.25), 23 * Math.cos(0.25)], spin = 0.9;
  const hits = [-0.2, 0.2].map(azimuth => traceRay({ position, direction: [-1, 0.1, azimuth], spin, stepScale: 0.1 }).diskHits[0]);
  assert.ok(hits.every(Boolean));
  assert.ok(hits[0].g > hits[1].g, `left approaches: ${JSON.stringify(hits)}`);
  const r = 4, omega = Math.sqrt(0.5) / (r ** 1.5 + spin / 2 * Math.sqrt(0.5));
  const phi = 1.2, t = 0.1;
  const sample = (angle, time) => [Math.cos(angle - omega * time), Math.sin(angle - omega * time)];
  close(dot(sample(phi, 0), sample(phi + omega * t, t)), 1, 1e-14, 'gas follows positive phi');
  assert.match(kerrFragmentShader, /gasPattern\(r, angle, -age \* omega/);
  assert.match(fragmentShader, /cos\(angle \+ orbit\)/);
  assert.match(fragmentShader, /cross\(normal, position\)/);
});

test('far-field tail is measured against integration to 10000 M', () => {
  let maximum = 0;
  for (const spin of [0, 0.5, 0.9, 0.998]) for (const direction of [[-1, 0.03, -0.14], [-1, 0.05, 0.18], [-1, 0.03, 0.3], [1, 0.2, 0.1]]) {
    const args = { position: [0, 8, Math.sqrt(23 ** 2 - 8 ** 2)], direction, spin, stepScale: 0.2 };
    const tail = traceRay(args);
    if (tail.fate === 'captured') continue;
    const far = traceRay({ ...args, outerRadius: 5000 });
    const error = angularError(tail.direction, far.direction);
    maximum = Math.max(maximum, error);
    assert.ok(error < 1e-5, `${spin}: ${error}`);
  }
  metrics.tailMaximumRadians = maximum;
});

test('invalid spin, positions, directions and horizon cameras explicitly raise RangeError', () => {
  const args = { position: [0, 0, 23], direction: [-1, 0, 0], spin: 0.9 };
  for (const spin of [NaN, Infinity, -Infinity, -0.1, 0.998001]) {
    for (const fn of [horizon, diskInnerRadius]) assert.throws(() => fn(spin), RangeError);
    assert.throws(() => traceRay({ ...args, spin }), RangeError);
    assert.throws(() => observerFrame(args.position, spin), RangeError);
    assert.throws(() => blRadius(args.position, spin), RangeError);
  }
  for (const bad of [NaN, Infinity, -Infinity]) for (let i = 0; i < 3; i++) {
    const v = [0, 0, 23]; v[i] = bad;
    assert.throws(() => traceRay({ ...args, position: v }), RangeError);
    assert.throws(() => traceRay({ ...args, direction: v }), RangeError);
    assert.throws(() => observerFrame(v, 0.9), RangeError);
    assert.throws(() => blRadius(v, 0.9), RangeError);
  }
  assert.throws(() => traceRay({ ...args, direction: [0, 0, 0] }), RangeError);
  for (const spin of [0, 0.5, 0.998]) for (const radius of [0, horizon(spin), horizon(spin) + KERR_RAY.epsilon]) {
    assert.throws(() => traceRay({ ...args, spin, position: [0, 0, radius] }), RangeError);
  }
});

test('write Kerr numerical evidence and measure the unchanged default weak-field shortcut', () => {
  metrics.weakShortcut = [];
  for (const b of [10, 12, 15, 20]) {
    const r = 23, lapse = Math.sqrt(1 - 1 / r), psi = Math.asin(b * lapse / r);
    const local = [-Math.cos(psi), Math.sin(psi) / lapse], len = Math.hypot(...local);
    const dir = local.map(v => v / len), rd = dir[0], impact = [1 - dir[0] * rd, -dir[1] * rd];
    const ilen = Math.hypot(...impact), deflect = (1 - rd) / b + 15 * Math.PI / 32 * (1 - rd) / (b * b);
    const weak = dir.map((v, i) => v * Math.cos(deflect) - impact[i] / ilen * Math.sin(deflect));
    const reference = schwarzschild({ r, psi, stepScale: 0.1 });
    metrics.weakShortcut.push({ b, errorRadians: angularError(weak, reference.direction) });
  }
  mkdirSync(new URL('../tmp/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../tmp/kerr-numbers.json', import.meta.url), JSON.stringify(metrics, null, 2));
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /get\('metric'\) === 'kerr'/);
  assert.match(main, /getState: \(\) => \(\{ metric,/);
});
