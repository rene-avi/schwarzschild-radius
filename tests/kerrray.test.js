import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { KERR_RAY, traceRay, horizon, blRadius, observerFrame, invariants, criticalCurve, curveRadius,
  emitterShift, diskInnerRadius, pictureSpin, zamoClockRate, kerrFlowGLSL } from '../src/kerrray.js';
import { traceRay as schwarzschild, GEODESIC, escapeAngle } from '../src/geodesic.js';
import { iscoRadius } from '../src/kerr.js';
import { fragmentShader, kerrFragmentShader } from '../src/shaders/blackhole.js';
import { createRayMaterial } from '../src/scene.js';
import { evaluate, functionBody, assignment, lastReturn } from './glsl-subset.mjs';

const metrics = {};
const close = (a, b, tolerance, label) => assert.ok(Math.abs(a - b) < tolerance, `${label}: ${a} versus ${b}`);
const angularError = (a, b) => 2 * Math.asin(Math.min(1, Math.hypot(...a.map((v, i) => v - b[i])) / 2));
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const at = inclination => [0, 23 * Math.cos(inclination * Math.PI / 180), 23 * Math.sin(inclination * Math.PI / 180)];

test('fresh default imports never call Function and Kerr kernels compile lazily', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./kerr-import.mjs', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

function diskCrossings(args) {
  const crossings = [];
  let previous;
  const ray = traceRay({ ...args, onStep(state) {
    if (previous && previous.x[2] * state.x[2] < 0) {
      const t = previous.x[2] / (previous.x[2] - state.x[2]);
      const x = previous.x.map((v, i) => v + t * (state.x[i] - v));
      // On the equator the quartic reduces to r² = X² + Y² - a².
      const r = Math.sqrt(x[0] ** 2 + x[1] ** 2 - (args.spin / 2) ** 2);
      const p = previous.p.map((v, i) => v + t * (state.p[i] - v));
      if (r >= diskInnerRadius(args.spin) && r <= 8.6 && crossings.length < 3) crossings.push({ x, r, p, pt: state.pt });
    }
    previous = state;
  } });
  assert.equal(ray.diskHits.length, crossings.length, 'all eligible crossings are recorded');
  ray.diskHits.forEach((hit, i) => {
    close(hit.r, blRadius(crossings[i].x, args.spin), 1e-12, 'hit radius at interpolated crossing');
    close(hit.r, crossings[i].r, 1e-12, 'independent equatorial radius');
  });
  return { ray, crossings };
}

test('Kerr switch preserves the exact evaluated default shader and an empty material defines map', () => {
  assert.equal(fragmentShader.length, 34858);
  assert.equal(createHash('sha256').update(fragmentShader).digest('hex'), '7b0e1dbdc800c27ca1d8aeb998824242cf28ed2ba65b167f4b8d03e019981c72');
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

test('Kerr capture epsilon is at most 0.001 r_s', () => {
  assert.ok(KERR_RAY.epsilon > 0 && KERR_RAY.epsilon <= 0.001);
});

function progradeEdge() {
  const spin = 0.998, a = spin / 2, ro = 23;
  const r = 1 + Math.cos(2 / 3 * Math.acos(-spin));
  const xi = (r * r * (r - 1.5) + a * a * (r + 0.5)) / (a * (0.5 - r));
  const frame = observerFrame([0, 0, ro], spin);
  const pp = -xi / Math.sqrt(ro * ro + a * a + a * a / ro);
  const energy = frame.ut * (1 - frame.omega * xi);
  return pp / Math.sqrt(energy * energy - pp * pp);
}

test('near-extremal equatorial prograde edge escapes outside and captures inside', () => {
  const edge = progradeEdge();
  for (const [factor, fate] of [[0.995, 'captured'], [1.001, 'escaped']]) {
    const ray = traceRay({ position: [0, 0, 23], direction: [-1, 0, edge * factor], spin: 0.998 });
    assert.equal(ray.fate, fate, `prograde edge factor ${factor}`);
  }
});

test('valid rays return budget with no infinity direction when integration runs out', () => {
  const args = { position: [0, 0, 23], direction: [-1, 0, progradeEdge() * 1.0001], spin: 0.998 };
  const ray = traceRay({ ...args, maxSteps: 2 });
  assert.equal(ray.fate, 'budget');
  assert.equal(ray.steps, 2);
  assert.equal(ray.direction, null);
  assert.deepEqual(ray.diskHits, []);
  assert.ok(ray.state.x.every(Number.isFinite));
  assert.equal(traceRay(args).fate, 'budget', 'High near-edge exhaustion is also a valid result');
  for (const maxSteps of [0, -1, 1.2, Infinity, NaN, null]) {
    assert.throws(() => traceRay({ ...args, maxSteps }), RangeError);
  }
});

test('ZAMO camera clock matches closed-form lapse at two radii and full selected spin', () => {
  for (const r of [1.1, 23]) for (const delta of [1, 0.1, 0.002, 1e-14]) for (const inclination of [0, 60, 90]) {
    const theta = inclination * Math.PI / 180, a = (1 - delta) / 2;
    const position = [0, r * Math.cos(theta), r * Math.sin(theta)];
    const Delta = r * r - r + a * a, Sigma = r * r + a * a * Math.cos(theta) ** 2;
    const A = (r * r + a * a) ** 2 - a * a * Delta * Math.sin(theta) ** 2;
    const alpha = zamoClockRate(position, delta);
    close(alpha, Math.sqrt(Delta * Sigma / A), 1e-14, 'exact ZAMO lapse');
    if (delta >= 0.002) close(alpha, 1 / observerFrame(position, 1 - delta).ut, 1e-14, 'tetrad lapse');
  }
  assert.notEqual(zamoClockRate([0, 0, 1.1], 1e-14), zamoClockRate([0, 0, 1.1], 0.002), 'clock spin is uncapped');
  for (const delta of [0, -1, 1.1, NaN, Infinity]) assert.throws(() => zamoClockRate([0, 0, 23], delta), RangeError);
  assert.throws(() => zamoClockRate([0, 0, 0.5], 0.1), RangeError);
  assert.throws(() => zamoClockRate([0, NaN, 23], 0.1), RangeError);
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
    const { ray, crossings } = diskCrossings({ position: [0, ro, 0], direction: [-1, 0.2, 0], spin, stepScale: 0.05 });
    assert.ok(ray.diskHits.length > 0);
    for (const hit of ray.diskHits) {
      const r = crossings[hit.order].r;
      const obs = 1 / Math.sqrt(1 - ro / (ro * ro + a * a));
      const em = (r ** 1.5 + a * Math.sqrt(0.5)) / (r ** 0.75 * Math.sqrt(r ** 1.5 - 1.5 * Math.sqrt(r) + 2 * a * Math.sqrt(0.5)));
      close(hit.g, obs / em, 1e-6, 'axis shift');
    }
    // A meridional ray starts above the equator and crosses it on the outgoing limb.
    const position = at(85);
    const { ray: edge, crossings: edgeCrossings } = diskCrossings({ position, direction: [-1, 0.04, -0.2], spin, stepScale: 0.05 });
    assert.ok(edge.diskHits.length > 0);
    const frame = observerFrame(position, spin), E = -edge.state.pt;
    for (const hit of edge.diskHits) {
      const r = edgeCrossings[hit.order].r, omega = Math.sqrt(0.5) / (r ** 1.5 + a * Math.sqrt(0.5));
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

test('Kerr prograde disk has brighter approaching emission', () => {
  const position = [0, 23 * Math.sin(0.25), 23 * Math.cos(0.25)], spin = 0.9;
  const hits = [-0.2, 0.2].map(azimuth => traceRay({ position, direction: [-1, 0.1, azimuth], spin, stepScale: 0.1 }).diskHits[0]);
  assert.ok(hits.every(Boolean));
  assert.ok(hits[0].g > hits[1].g, `left approaches: ${JSON.stringify(hits)}`);
  assert.match(fragmentShader, /cos\(angle \+ orbit\)/);
  assert.match(fragmentShader, /cross\(normal, position\)/);
});

test('actual GLSL disk expressions match traced g, phi and prograde gas drift', () => {
  const disk = functionBody(kerrFragmentShader, 'kerrDisk');
  for (const spin of [0.5, 0.9, 0.998]) {
    const { ray, crossings } = diskCrossings({ position: at(70), direction: [-1, 0.1, -0.2], spin, stepScale: 0.1 });
    assert.ok(crossings.length);
    for (const [i, crossing] of crossings.entries()) {
      const env = { ...crossing, a: spin / 2, PI: Math.PI, uTime: 2, ray: [0.2, 0.3, 0.4], incidence: 0.4, pixel: 0.01 };
      for (const name of ['omega', 'ut', 'lz', 'g', 'angle', 'age', 'blend']) env[name] = evaluate(assignment(disk, name), env);
      close(env.g, ray.diskHits[i].g, 1e-12, 'GLSL emitter g');
      close(env.angle, ray.diskHits[i].phi, 1e-12, 'GLSL KS azimuth');
      const samples = values => {
        const phases = [];
        evaluate(assignment(disk, 'gas'), values, { gasPattern(r, angle, orbit) {
          phases.push([Math.cos(angle + orbit), Math.sin(angle + orbit)]);
          return [0, 0];
        } });
        assert.equal(phases.length, 2, 'both blended gas samples evaluated');
        return phases;
      };
      const before = samples(env), dt = 0.2, phi = ray.diskHits[i].phi + env.omega * dt;
      const rho = Math.hypot(crossing.x[0], crossing.x[1]);
      const moved = { ...env, x: [rho * Math.cos(phi), rho * Math.sin(phi), 0], uTime: env.uTime + dt };
      for (const name of ['angle', 'age', 'blend']) moved[name] = evaluate(assignment(disk, name), moved);
      samples(moved).forEach((phase, j) => phase.forEach((v, k) => close(v, before[j][k], 1e-12, 'GLSL gas follows traced positive phi')));
    }
  }
});

test('actual GLSL disk return applies full g cubed to brightness and g to temperature', () => {
  const result = lastReturn(functionBody(kerrFragmentShader, 'kerrDisk'));
  for (const r of [2, 5]) {
    const g = emitterShift(r, 0.9, 1, 0);
    let temperature;
    const light = evaluate(result, { r, g, uKerrInner: r, uTemperature: 6500,
      radial: 1, density: 1, hotEdge: 0, edge: 1, grazing: 1, uDiskIntensity: 1 }, {
      blackbody(value) { temperature = value; return 1; },
    });
    close(temperature, 6500 * g, 1e-9, 'GLSL colour temperature');
    close(light, 1.75 * g ** 3, 1e-12, 'GLSL radiance factor');
  }
});

test('actual GLSL far tail and cyclic escape axes agree with JS infinity directions', () => {
  const tail = functionBody(kerrFragmentShader, 'kerrTail');
  const flow = functionBody(kerrFragmentShader, 'kerrFlow');
  const main = functionBody(kerrFragmentShader, 'main');
  const outgoing = assignment(main.slice(main.indexOf('if (r >')), 'outgoing');
  for (const spin of [0, 0.9, 0.998]) {
    const ray = traceRay({ position: at(60), direction: [-1, 0.13, 0.25], spin });
    assert.equal(ray.fate, 'escaped');
    const env = { ...ray.state, a: spin / 2 };
    const direction = evaluate(outgoing, env, { kerrTail(x, p, pt, a) {
      const v = { x, p, pt, a };
      for (const row of flow.matchAll(/float (\w+) = ([^;]+);/g)) v[row[1]] = evaluate(row[2], v);
      v.velocity = evaluate(assignment(flow, 'dx'), v);
      for (const name of ['rho', 'radial', 'b', 'tangent', 'angle']) {
        v[name] = evaluate(assignment(tail, name), v, { escapeAngle: (u, b) => escapeAngle(u, b, 1) });
      }
      return evaluate(lastReturn(tail), v);
    } });
    direction.forEach((v, i) => close(v, ray.direction[i], 1e-12, 'GLSL tail scene direction'));
  }
});

test('actual GLSL capture condition matches JS last and penultimate states', () => {
  const main = functionBody(kerrFragmentShader, 'main');
  const condition = main.slice(main.indexOf('float r = kerrRadius')).match(/if\s*\(([^)]+)\)\s*break;/)?.[1];
  assert.ok(condition, 'capture condition found');
  for (const spin of [0, 0.9, 0.998]) {
    const states = [];
    const ray = traceRay({ position: at(60), direction: [-1, 0, 0], spin, onStep: state => states.push(state) });
    assert.equal(ray.fate, 'captured');
    for (const [state, captured] of [[states.at(-2), false], [ray.state, true]]) {
      assert.equal(evaluate(condition, { r: blRadius(state.x, spin), rp: horizon(spin) }), captured, `GLSL capture a=${spin}`);
    }
  }
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
    const emitter = [6, 0.9, 1, 0, 1]; emitter[i === 1 ? 2 : i === 2 ? 3 : 0] = bad;
    assert.throws(() => emitterShift(...emitter), RangeError);
    assert.throws(() => emitterShift(6, 0.9, 1, 0, bad), RangeError);
    assert.throws(() => criticalCurve(args.position, 0.9, bad), RangeError);
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

test('past KS time has the inward and outward Schwarzschild closed forms', () => {
  for (const [sign, target] of [[-1, 1.0006], [1, 80]]) {
    const cam = 23;
    let previous;
    const ray = traceRay({ position: [0, 0, cam], direction: [sign, 0, 0], spin: 0, stepScale: 0.1,
      onStep(state) {
        assert.ok(state.t <= 0);
        if (previous) assert.ok(state.t < previous.t);
        previous = state;
      }, onChord(a, b) {
        const r0 = blRadius(a.x, 0), r1 = blRadius(b.x, 0);
        if ((r0 - target) * (r1 - target) > 0) return null;
        const f = (target - r0) / (r1 - r0);
        return { delay: -b.t, radius: r1 };
      } });
    assert.equal(ray.fate, 'hit');
    const r = ray.hit.radius;
    const expected = sign < 0 ? cam - r : r - cam + 2 * Math.log((r - 1) / (cam - 1));
    close(ray.hit.delay, expected, 1e-8, 'KS radial delay');
  }
  const far = traceRay({ position: [0, 0, 100000], direction: [1, 0, 0], spin: 0, outerRadius: 200000,
    onChord(a, b) { if (b.x[0] >= 100100) return { delay: -b.t, dr: b.x[0] - 100000 }; } });
  close(far.hit.delay / far.hit.dr, 1, 2.1e-5, 'far-field dt/dr');
});

test('actual GLSL KS time and its RK4 accumulation agree with JS ray states', () => {
  const body = functionBody(kerrFragmentShader, 'kerrTime');
  const step = functionBody(kerrFragmentShader, 'kerrStep');
  const main = functionBody(kerrFragmentShader, 'main');
  assert.match(main, /kerrStep\(x, p, rayTime, pt, a, h\)/);
  const accumulation = step.match(/time \+= ([^;]+);/);
  assert.ok(accumulation, 'time accumulates with the RK4 step');
  for (const spin of [0, 0.9, 0.998]) {
    const states = [];
    traceRay({ position: at(60), direction: [-1, .1, .2], spin, maxSteps: 2, onStep: s => states.push(s) });
    const flow = functionBody(kerrFragmentShader, 'kerrFlow');
    const derivative = state => {
      const env = { ...state, a: spin / 2 };
      for (const name of ['q', 'r', 'l', 'f']) env[name] = evaluate(assignment(body, name), env);
      const dt = evaluate(lastReturn(body), env);
      for (const row of flow.matchAll(/float (\w+) = ([^;]+);/g)) env[row[1]] = evaluate(row[2], env);
      return { dt, dx: evaluate(assignment(flow, 'dx'), env), dp: evaluate(assignment(flow, 'dp'), env) };
    };
    const s = states[0], h = Math.min(KERR_RAY.highC * (blRadius(s.x, spin) - horizon(spin)), 8);
    const advance = (d, h) => ({ x: s.x.map((v, i) => v + d.dx[i] * h), p: s.p.map((v, i) => v + d.dp[i] * h), pt: s.pt });
    const d1 = derivative(s), d2 = derivative(advance(d1, h / 2)), d3 = derivative(advance(d2, h / 2)), d4 = derivative(advance(d3, h));
    const dt = evaluate(accumulation[1], { h, t1: d1.dt, t2: d2.dt, t3: d3.dt, t4: d4.dt });
    close(states[1].t - s.t, dt, 1e-12, 'shader RK4 coordinate time');
    assert.ok(dt < 0);
  }
});
