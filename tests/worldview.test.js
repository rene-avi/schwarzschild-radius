import test from 'node:test';
import assert from 'node:assert/strict';
import { circularOrbit } from '../src/kerr.js';
import { GEODESIC } from '../src/geodesic.js';
import { ObservatoryCamera } from '../src/camera.js';
import { PRESETS } from '../src/physics.js';
import { START_PHASES, drawnWorlds, advancePhases, worldPosition, retardedPosition, directImage, screenPoint } from '../src/worldview.js';

const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const norm = a => Math.hypot(...a);
const unit = a => a.map(v => v / norm(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const near = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('both picture worlds pass every spin position only at reference lensing', () => {
  const maxima = { lantern: [0, 0], farShore: [0, 0] };
  for (let step = 0; step <= 1400; step++) {
    const delta = 10 ** (-step / 100);
    for (const body of drawnWorlds(delta, 1)) {
      assert.equal(body.drawn, true);
      assert.ok(body.radiusM / 2 >= 3);
      maxima[body.id][0] = Math.max(maxima[body.id][0], body.omegaDeviation);
      maxima[body.id][1] = Math.max(maxima[body.id][1], body.clockDeviation);
    }
    for (const lensing of [0.85, 1.15, 1 + 2e-9]) assert.ok(drawnWorlds(delta, lensing).every(b => !b.drawn));
  }
  for (const [id, expected] of [['lantern', [2.349, 0.729]], ['farShore', [0.076, 0.002]]]) {
    maxima[id].forEach((value, i) => near(value * 100, expected[i], 0.0006));
  }
  assert.deepEqual(drawnWorlds(1, 1).map(b => b.id), ['lantern', 'farShore']);
  assert.ok(drawnWorlds(1, 1 + 0.5e-9).every(b => b.drawn));
  const first = drawnWorlds(1, 1);
  first[0].tint[0] = 99;
  assert.ok(drawnWorlds(1, 1).every(b => Math.max(...b.tint) <= 1));
  console.log(`world deviation maxima: ${JSON.stringify(maxima)}`);
});

test('world centres have the disk plane, radius, and Doppler orbital sense', () => {
  for (const tilt of [-30, 0, 6, 8, 60]) for (const phase of [-2, 0, 1.3, 3]) {
    const a = tilt * Math.PI / 180, normal = [0, Math.cos(a), -Math.sin(a)];
    for (const body of drawnWorlds(1e-14, 1)) {
      const position = worldPosition(body.radiusM, phase, tilt);
      near(norm(position), body.radiusM / 2);
      near(dot(position, normal), 0);
      const next = worldPosition(body.radiusM, phase + 1e-6, tilt);
      assert.ok(dot(next.map((v, i) => v - position[i]), cross(normal, position)) > 0);
    }
  }
  assert.deepEqual(drawnWorlds(1, 1).map(b => b.radius), [0.18, 0.6]);
});

test('accumulated phases preserve position at a spin change and use the picture clock', () => {
  for (const delta of [1, 1e-14]) {
    let phases = { ...START_PHASES };
    for (let i = 0; i < 1000; i++) phases = advancePhases(phases, 0.1, delta);
    for (const body of drawnWorlds(delta, 1)) {
      near(phases[body.id], START_PHASES[body.id] + 200 * body.omega, 1e-11);
      const periodM = 2 * Math.PI / circularOrbit(body.radiusM, delta).omega;
      const periodSim = periodM / 2;
      assert.ok(body.id === 'lantern' ? periodSim > 130.5 && periodSim < 133.8 : periodSim > 4129 && periodSim < 4134);
      near(advancePhases(START_PHASES, periodSim, delta)[body.id], START_PHASES[body.id] + 2 * Math.PI);
    }
    assert.deepEqual(advancePhases(phases, 0, 0.1), phases);
    const changed = advancePhases(phases, 0.3, 0.1);
    for (const body of drawnWorlds(0.1, 1)) near(changed[body.id] - phases[body.id], 0.6 * body.omega);
  }
  assert.deepEqual(START_PHASES, { lantern: -0.9, farShore: 1.82 });
});

test('retarded centres satisfy the straight light-time equation to a nanoradian', () => {
  for (const delta of [1, 0.15, 1e-14]) for (const camera of [[1.03, 0, 0], [1, 5, 22], [0, 60, 0]]) {
    for (const phase of [-20, -2, 0, 1, 12]) for (const body of drawnWorlds(delta, 1)) {
      const seen = retardedPosition(body, phase, camera, 8);
      const distance = norm(seen.center.map((v, i) => v - camera[i]));
      near(seen.phase, phase - 2 * body.omega * distance, 1e-9);
      assert.deepEqual(seen.center, worldPosition(body.radiusM, seen.phase, 8));
    }
  }
});

// Forward propagation uses finer steps and the conserved impact inferred from the local ray.
function forwardAtWorld(camera, world, direction) {
  const r = norm(camera), radial = unit(camera), mu = -dot(direction, radial);
  const transverse = direction.map((v, i) => v + mu * radial[i]);
  const tangent = unit(transverse), impact = r * norm(transverse) / Math.sqrt(1 - 1 / r);
  const targetAngle = Math.atan2(norm(cross(radial, unit(world))), dot(radial, unit(world)));
  const count = Math.ceil(targetAngle / 0.0001), h = targetAngle / count;
  let state = [1 / r, mu / impact];
  const f = ([u, v]) => [v, 1.5 * u * u - u];
  const step = (s, k, scale) => s.map((v, i) => v + scale * k[i]);
  for (let i = 0; i < count; i++) {
    const a = f(state), b = f(step(state, a, h / 2)), c = f(step(state, b, h / 2)), d = f(step(state, c, h));
    state = state.map((v, axis) => v + h / 6 * (a[axis] + 2 * b[axis] + 2 * c[axis] + d[axis]));
  }
  return radial.map((v, i) => (v * Math.cos(targetAngle) + tangent[i] * Math.sin(targetAngle)) / state[0]);
}

test('direct-image null rays reach near, far, inward and outward source positions', () => {
  for (const camera of [[1.1, 5.2, 22.4], [0, 0, 1.03], [0, 0, 1.2], [0, 0, 3]]) {
    for (const radiusM of [12, 120]) for (const phase of [-2.8, -1.5, -0.5, 0.4, 1.2, 2.2]) {
      const world = worldPosition(radiusM, phase, 6), direction = directImage(camera, world);
      assert.ok(direction);
      near(norm(direction), 1);
      const reached = forwardAtWorld(camera, world, direction);
      assert.ok(norm(reached.map((v, i) => v - world[i])) < 1e-6, JSON.stringify({ camera, world, reached }));
    }
  }
  assert.equal(directImage([0, 0, 23], [0, 0, -60]), null);
  assert.deepEqual(directImage([0, 0, 23], [0, 0, 60]), [0, 0, 1]);
  near(norm(directImage([0, 0, 23], [0, 0, 6]).map((v, i) => v - [0, 0, -1][i])), 0);
});

test('far-field direct image agrees with a straight ray within one microradian', () => {
  for (const world of [[6e8, 2e8, -4e8], [1e8, 2e8, 9e8]]) {
    const camera = [0, 0, 1e9], expected = unit(world.map((v, i) => v - camera[i]));
    assert.ok(norm(directImage(camera, world).map((v, i) => v - expected[i])) < 1e-6);
  }
});

test('screen mapping inverts shader projection including wide-screen offset', () => {
  const basis = { forward: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0] };
  for (const width of [375, 1000, 1440]) for (const x of [10, width / 2, width - 10]) {
    const height = 900, y = 320;
    const sx = ((x + 0.5) / width * 2 - 1 + (width > 1000 ? 0.13 : 0)) * width / height;
    const sy = 1 - (y + 0.5) / height * 2;
    const point = screenPoint(unit([Math.tan(GEODESIC.halfFov) * sx, Math.tan(GEODESIC.halfFov) * sy, -1]), basis, width, height);
    near(point.x, x); near(point.y, y);
  }
  assert.equal(screenPoint([0, 0, 1], basis, 1440, 900), null);
});

test('both starting direct images occupy open default-camera picture space at both widths', () => {
  const previous = globalThis.window;
  globalThis.window = new EventTarget();
  const camera = new ObservatoryCamera(new EventTarget());
  try {
    const position = camera.position.toArray(), basis = Object.fromEntries(['forward', 'right', 'up'].map(k => [k, camera[k].toArray()]));
    const results = [];
    for (const preset of [PRESETS.deep, PRESETS.gargantua]) {
      for (const body of drawnWorlds(preset.spinDelta, 1)) {
        const seen = retardedPosition(body, START_PHASES[body.id], position, preset.tilt);
        if (body.id === 'lantern') assert.ok(dot(seen.center, position) > 0);
        for (const [width, height] of [[1440, 900], [1000, 800]]) {
          const point = screenPoint(directImage(position, seen.center), basis, width, height);
          assert.ok(point, `direct image for ${body.id}`);
          // These open corridors leave room for the full silhouette; DOM boxes are checked in-browser.
          const corridor = body.id === 'lantern'
            ? width === 1440 ? [520, 580, 475, 525] : [400, 460, 420, 470]
            : width === 1440 ? [300, 850, 60, 350] : [250, 455, 50, 310];
          assert.ok(point.x > corridor[0] && point.x < corridor[1] && point.y > corridor[2] && point.y < corridor[3],
            JSON.stringify({ preset: preset.name, id: body.id, width, height, point, corridor }));
          results.push({ preset: preset.name, id: body.id, width, height, point });
        }
      }
    }
    console.log(`starting direct images: ${JSON.stringify(results)}`);
  } finally { camera.destroy(); globalThis.window = previous; }
});
