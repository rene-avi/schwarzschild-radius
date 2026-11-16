import test from 'node:test';
import assert from 'node:assert/strict';
import { fragmentShader } from '../src/shaders/blackhole.js';
import { traceDiskPixel, tipScans } from './disk-rays.mjs';

test('default disk-tip crossings agree with twenty-times-smaller steps without scalloped errors', () => {
  for (const [start, end] of tipScans) {
    let maximum = 0, jump = 0, previous;
    for (let x = start; x <= end; x++) {
      const coarse = traceDiskPixel(x, 455);
      const fine = traceDiskPixel(x, 455, { stepScale: 1 / 20 });
      assert.equal(coarse.exhausted, false, `coarse x=${x}`);
      assert.equal(fine.exhausted, false, `fine x=${x}`);
      assert.equal(coarse.crossings.length, 1, `direct crossing x=${x}`);
      assert.equal(fine.crossings.length, coarse.crossings.length, `crossing count x=${x}`);
      const a = coarse.crossings[0], b = fine.crossings[0];
      const error = a.radius - b.radius;
      maximum = Math.max(maximum, Math.abs(error));
      if (previous !== undefined) jump = Math.max(jump, Math.abs(error - previous));
      previous = error;
      assert.ok(Math.abs(error) < 0.01, `x=${x}: crossing error ${error} r_s`);
      assert.ok(Math.abs(Math.atan2(Math.sin(a.azimuth - b.azimuth), Math.cos(a.azimuth - b.azimuth))) < 1e-6,
        `x=${x}: azimuth must stay in the orbital plane`);
      assert.ok(Math.abs(a.position[1] * Math.cos(8 * Math.PI / 180) - a.position[2] * Math.sin(8 * Math.PI / 180)) < 1e-12,
        `x=${x}: crossing lies in the disk plane`);
    }
    console.log(`disk crossings x=${start}..${end}, y=455: max error=${maximum}, max neighbour jump=${jump} r_s`);
    assert.ok(jump < 0.03, `x=${start}..${end}: scalloped crossing error ${jump} r_s`);
  }
});

test('fine disk-crossing reference converges when its steps are halved again', () => {
  for (const [start, end] of tipScans) for (let x = start; x <= end; x += 5) {
    const a = traceDiskPixel(x, 455, { stepScale: 1 / 20 });
    const b = traceDiskPixel(x, 455, { stepScale: 1 / 40 });
    assert.equal(b.exhausted, false, `x=${x}`);
    assert.equal(a.crossings.length, b.crossings.length, `x=${x}`);
    assert.ok(Math.abs(a.crossings[0].radius - b.crossings[0].radius) < 0.00001, `x=${x}: fine reference convergence`);
  }
});

test('disk turbulence does not repeatedly wrap its noise lattice on a radial scan', () => {
  const expression = fragmentShader.match(/float woundAngle = ([^;]+);/);
  assert.ok(expression, 'the material map exposes its continuous polar angle');
  const materialAngle = new Function('r', 'inner', 'angle', 'orbit', 'clump', 'eddy', 'log', `return ${expression[1]};`);
  for (const spin of [0, 0.85, 0.99]) for (const age of [0, 8, 16]) {
    const inner = 2.95 - 0.35 * spin;
    let travel = 0, previous;
    for (let i = 0; i <= 1000; i++) {
      const r = inner + (8.6 - inner) * i / 1000;
      const orbit = age * (0.22 + spin * 0.08) / (r / 3) ** 1.5;
      const angle = materialAngle(r, inner, 0, orbit, 0.5 + 0.25 * Math.sin(2 * r), 0.5 + 0.25 * Math.cos(3 * r), Math.log);
      assert.ok(Number.isFinite(angle));
      if (previous !== undefined) travel += Math.abs(angle - previous);
      previous = angle;
    }
    assert.ok(travel < 2 * Math.PI, `spin=${spin}, age=${age}: radial lattice turns ${travel / (2 * Math.PI)}`);
  }
});
