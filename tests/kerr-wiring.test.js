import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3, Vector4 } from 'three';
import { BlackHoleScene } from '../src/scene.js';
import { kerrFragmentShader as shader } from '../src/shaders/blackhole.js';
import { worldEvent, worldImage, traceWorld, movingSphere } from '../src/kerrworlds.js';
import { pictureSpin } from '../src/kerrray.js';
import { photonOrbit } from '../src/kerrworlds.js';
import { historyAt, integrateProbe, unpackKerrProbe } from '../src/kerrprobe.js';
import { PROBE_LOST_SIGNAL } from '../src/physics.js';
import { evaluate, assignment, functionBody, lastReturn } from './glsl-subset.mjs';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);
const vectorClose = (a, b) => a.forEach((v, i) => close(v, b[i]));
const jsFunction = (name, dependencies) => new Function(...Object.keys(dependencies), `return function(${name === 'action' ? 'type' : '{ id, drawn, center, radius, phase, radiusM }'}) {${functionBody(main, name)}}`)(...Object.values(dependencies));
const loop = functionBody(shader, 'main');
const worldBlock = loop.slice(loop.indexOf('vec2 worldFraction'), loop.indexOf('float probeFraction'));
const surfaceBlock = loop.slice(loop.lastIndexOf('int world = kind - 1;'));

function shaderCenter(radius, phase, time, a) {
  const env = { radius, phase, time, a, PI: Math.PI }, body = functionBody(shader, 'kerrWorldCenter');
  for (const name of ['omega', 'phi', 'rho']) env[name] = evaluate(assignment(body, name), env);
  return evaluate(lastReturn(body), env);
}

test('main-loop world chord endpoints and time mix reproduce traceWorld hits', () => {
  for (const [radius, phase] of [[6, -.9], [60, .15]]) {
    const ray = { position: [0, 5, 100], spin: .998, radius, phase, stepScale: .1 };
    const image = worldImage(ray);
    let start;
    const traced = traceWorld({ ...ray, direction: image.direction, bodyRadius: radius === 6 ? .18 : .6, onStep(s) { start = s; } });
    assert.equal(traced.fate, 'hit');
    const end = traced.state, hit = traced.hit;
    const env = { previous: start.x, x: end.x, previousP: start.p, p: end.p,
      previousTime: start.t, rayTime: end.t, nearest: hit.fraction, a: .499,
      uKerrWorldOrbit: [radius, radius], uKerrWorldPhase: [phase, phase], j: 0, world: 0 };
    for (const block of [worldBlock, surfaceBlock]) {
      const c0 = evaluate(assignment(block, 'c0'), env, { kerrWorldCenter: shaderCenter });
      const c1 = evaluate(assignment(block, 'c1'), env, { kerrWorldCenter: shaderCenter });
      vectorClose(c0, worldEvent(radius, phase, start.t, .998).x);
      vectorClose(c1, worldEvent(radius, phase, end.t, .998).x);
      const expected = movingSphere(start.x, end.x, c0, c1, ray.radius === 6 ? .18 : .6);
      close(expected.fraction, hit.fraction);
      if (block === surfaceBlock) vectorClose(evaluate(assignment(block, 'center'), { ...env, c0, c1 }), hit.center);
    }
    vectorClose(evaluate(assignment(loop, 'crossing'), env), hit.x);
    vectorClose(evaluate(assignment(loop, 'crossingP'), env), hit.p);
    close(evaluate(assignment(loop, 'time'), env), hit.t);
  }
});

test('main-loop probe hit queries the chord-interpolated retarded event time', () => {
  const h = integrateProbe({ spin: .998, direction: [.4, .23, .9] });
  const now = 43;
  const args = /if\s*\(kerrProbeAt\(([^,]+),\s*center,\s*u,\s*tau\)\)/.exec(loop);
  assert.ok(args, 'probe surface history lookup');
  for (const nearest of [.1, .37, .85]) {
    const env = { previousTime: -12, rayTime: -14, nearest };
    env.time = evaluate(assignment(loop, 'time'), env);
    const actualTime = evaluate(args[1], env);
    const expected = historyAt(h, now - 12 - 2 * nearest), actual = historyAt(h, now + actualTime);
    close(actual.t, expected.t); vectorClose(actual.x, expected.x); close(actual.tau, expected.tau);
  }
});

test('scene render uniforms include the first reception delay in their time origin', () => {
  const knots = [{ x: [1, 2, 3], t: 5, u: [2, 0, 0, 0], tau: 4 }, { x: [2, 3, 4], t: 10, u: [2, 0, 0, 0], tau: 6 }];
  const probe = unpackKerrProbe({ probe: { state: 'falling', elapsed: 3, arrivalDelay: 17 }, data: { knots } });
  const uniforms = new Proxy({}, { get(target, key) { return target[key] ??= { value: new Vector4() }; } });
  uniforms.uKerrProbeEvent = { value: knots.map(() => new Vector4()) };
  uniforms.uKerrProbeU = { value: knots.map(() => new Vector4()) };
  uniforms.uKerrProbeTau = { value: [] };
  const scene = { metric: 'kerr', uniforms, film: { uniforms: { uTime: { value: 0 } } }, composer: { render() {} } };
  const camera = { position: new Vector3(0, 0, 23), forward: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0) };
  BlackHoleScene.prototype.render.call(scene, camera, { spinDelta: .002, temperature: 6500 }, 20, probe, .01);
  assert.equal(uniforms.uKerrProbeCount.value, 2);
  knots.forEach((event, i) => {
    vectorClose(uniforms.uKerrProbeEvent.value[i].toArray(), [...event.x, event.t - 20]);
    vectorClose(uniforms.uKerrProbeU.value[i].toArray(), event.u);
    assert.equal(uniforms.uKerrProbeTau.value[i], event.tau);
  });
});

test('world radiance uses full g cubed and probe surface cutoff equals the loss signal', () => {
  const body = functionBody(shader, 'kerrWorldLight');
  for (const g of [.15, .5, 1, 1.7]) {
    const env = { albedo: [.4, .6, .8], g, uTemperature: 6500, falloff: .3, lambert: .4, limb: .05 };
    const actual = evaluate(assignment(body, 'light'), env, { blackbody: () => [1, .8, .5] });
    const expected = env.albedo.map((v, i) => v * (.012 + [1, .8, .5][i] * .3 * (1.25 * .4 + .045 * .05)) * g ** 3);
    vectorClose(actual, expected);
  }
  const guard = /if\s*\((g\s*>=\s*[^)]+)\)\s*\{\s*light\s*\+=\s*kerrProbeLight/.exec(loop);
  assert.ok(guard, 'probe cutoff is attached to surface emission');
  for (const g of [.019, .02, .03, .1, .249, .251]) assert.equal(evaluate(guard[1], { g }), g >= PROBE_LOST_SIGNAL);
});

test('moving-body quadratic retains its exit root when the ray starts inside', () => {
  const body = functionBody(shader, 'kerrMovingHit');
  const env = { start: [0, 0, 0], end: [3, 0, 0], c0: [0, 0, 0], c1: [.1, 0, 0], axes: [1, 1, 1] };
  for (const name of ['relative', 'delta', 'A', 'B', 'C', 'D', 'near', 'far', 'fraction']) env[name] = evaluate(assignment(body, name), env);
  close(evaluate(lastReturn(body), env), movingSphere(env.start, env.end, env.c0, env.c1, 1).fraction);
  assert.ok(env.near < 0 && env.far > 0);
});

test('main world drawing gate requires Mission, layer and the Kerr photon radius', () => {
  const expression = /drawn:\s*([^\n]+),/.exec(main)[1];
  const gate = new Function('metric', 'body', 'settings', 'ui', 'worldsLayer', 'photonOrbit', 'pictureSpin', `return ${expression}`);
  for (const spin of [0, .9, .998]) for (const missionOpen of [false, true]) for (const worldsLayer of [false, true]) {
    for (const radius of [1.2 * photonOrbit(spin) - 1e-8, 6, 60]) {
      const drawn = gate('kerr', { radiusM: radius * 2, drawn: false }, { spinDelta: 1 - spin }, { missionOpen }, worldsLayer, photonOrbit, pictureSpin);
      assert.equal(drawn, missionOpen && worldsLayer && radius >= 1.2 * photonOrbit(spin));
    }
  }
});

test('getState world images are lazy, cached by phase/camera/spin, and keep their shape', () => {
  let solves = 0, position = [0, 5, 23];
  const settings = { spinDelta: .002 }, cache = new Map();
  const state = jsFunction('pictureWorldState', { metric: 'kerr', settings, camera: { position: { toArray: () => position } },
    kerrWorldImages: cache, pictureSpin, worldImage: () => { solves++; return { x: [1, 2, 3], sceneDirection: [.1, .2, .3], delay: 21 }; } });
  const world = { id: 'lantern', drawn: false, center: [0, 0, 0], radius: .18, phase: -.9, radiusM: 12 };
  assert.equal(state(world).center, null); assert.equal(solves, 0);
  world.phase = -.8; state(world); position = [0, 5, 24]; state(world); assert.equal(solves, 0);
  world.drawn = true;
  const first = state(world); assert.equal(solves, 1);
  state(world); assert.equal(solves, 1);
  assert.deepEqual(Object.keys(first), ['id', 'drawn', 'radius', 'phase', 'orbitRadius', 'center', 'direction', 'delay']);
  first.center[0] = 100; vectorClose(state(world).center, [2, 3, 1]);
  world.phase += .1; state(world); assert.equal(solves, 2);
  position = [0, 5, 25]; state(world); assert.equal(solves, 3);
  settings.spinDelta = .1; state(world); assert.equal(solves, 4);
  world.drawn = false; world.phase += .1; state(world); assert.equal(solves, 4);
});

test('probe action catches synchronous failures and starts Kerr work off the main thread', () => {
  const notices = [], sent = [];
  let worker, cancelled = 0;
  const dependencies = { metric: 'kerr', settings: { spinDelta: .002 }, pictureSpin,
    camera: { position: new Vector3(0, 5, 23), right: new Vector3(1, 0, 0) },
    ui: { setNotice: message => notices.push(message) }, probeWorker: null,
    cancelProbeDrop: () => cancelled++, unpackKerrProbe,
    probeDropRefusal: () => { throw new RangeError('Synthetic reception failure.'); },
    KerrProbeWorker: class { constructor() { worker = this; } postMessage(drop) { sent.push(drop); } },
  };
  assert.doesNotThrow(() => jsFunction('action', dependencies)('probe'));
  assert.match(notices.at(-1), /Probe not released: Synthetic reception failure/);
  assert.equal(sent.length, 0);
  dependencies.probeDropRefusal = () => null;
  jsFunction('action', dependencies)('probe');
  assert.equal(sent.length, 1); assert.equal(sent[0].spin, .998);
  assert.match(notices.at(-1), /Computing/);
  assert.doesNotThrow(() => worker.onmessage({ data: { notice: 'Probe not released: test failure.' } }));
  assert.match(notices.at(-1), /test failure/);
  let prevented = false;
  worker.onerror({ message: 'worker failure', preventDefault() { prevented = true; } });
  assert.ok(prevented); assert.ok(cancelled > 0); assert.match(notices.at(-1), /worker failure/);
});

test('Kerr world footprint and soft limb span one projected pixel', () => {
  const env = { uKerrPosition: [0, 0, 23], center: [0, 0, 6], pixelAngle: .001, uKerrLapse: .9, uWorldRadius: [.18, .6], world: 0 };
  close(evaluate(assignment(surfaceBlock, 'footprint'), env), 17 * .001 / (.9 * .18));
  const body = functionBody(shader, 'kerrWorldHit');
  for (const perpendicular of [.94, .98, 1, 1.02, 1.06]) {
    const e = { perpendicular, radius: 1, pixel: .1 };
    const formula = [...body.matchAll(/coverage\s*=\s*([^;]+);/g)].at(-1)[1];
    const coverage = evaluate(formula, e);
    if (perpendicular < .95) close(coverage, 1);
    else if (perpendicular > 1.05) close(coverage, 0);
    else if (perpendicular === 1) close(coverage, .5);
    else assert.ok(coverage > 0 && coverage < 1);
  }
  assert.match(worldBlock, /kerrWorldHit\(/);
  assert.match(surfaceBlock, /transmittance\s*\*=\s*1\.0\s*-\s*worldCoverage\[world\]/);
});
