import test from 'node:test';
import assert from 'node:assert/strict';
import { fragmentShader } from '../src/shaders/blackhole.js';
import { evaluate, functionBody, assignment } from './glsl-subset.mjs';

const disk = functionBody(fragmentShader, 'diskEmission');
const main = functionBody(fragmentShader, 'main');
const pattern = functionBody(fragmentShader, 'gasPattern');
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-12,
  `${label}: ${actual} versus ${expected}`);

function diskState(uTilt, uSpin, radius, phi, uTime) {
  const env = { uTilt, uSpin, uTime, PI: Math.PI, pixelFootprint: 0.01, ray: [0.2, 0.3, 0.4] };
  for (const name of ['tilt', 'normal']) env[name] = evaluate(assignment(main, name), env);
  env.position = [radius * Math.cos(phi), -radius * Math.sin(env.tilt) * Math.sin(phi),
    -radius * Math.cos(env.tilt) * Math.sin(phi)];
  for (const name of ['r', 'axisY', 'p', 'rayPlane', 'incidence', 'angle', 'rate', 'age', 'blend', 'tangent', 'direction', 'beta']) {
    env[name] = evaluate(assignment(disk, name), env);
  }
  close(env.angle, Math.atan2(Math.sin(phi), Math.cos(phi)), 'GLSL disk angle');
  return env;
}

function phases(env) {
  const samples = [];
  evaluate(assignment(disk, 'gas'), env, { gasPattern(r, angle, orbit) {
    samples.push(evaluate(assignment(pattern, 'flow'), { angle, orbit }));
    return [0, 0];
  } });
  assert.equal(samples.length, 2, 'both blended gas samples evaluated');
  return samples;
}

test('actual GLSL default gas drifts along the positive-angle Doppler tangent', () => {
  for (const tilt of [8, 40]) for (const spin of [0, 0.5, 0.99]) for (const radius of [3.2, 4.5, 8]) {
    for (const phi of [-2.4, 0.73, 3.13]) {
      // Both phase ages are continuous between their zero-weight renewal boundaries.
      for (const time of [0.2, 2, 7.7, 8.2, 15.7, 16.2, 23.7, 24.2, 31.7, 32.2]) {
        const env = diskState(tilt, spin, radius, phi, time);
        const projected = [env.tangent[0], evaluate('dot(tangent, axisY)', env)];
        close(projected[0], -Math.sin(env.angle), 'Doppler tangent x follows +angle');
        close(projected[1], Math.cos(env.angle), 'Doppler tangent y follows +angle');
        assert.equal(env.direction, 1, 'UI spin gives positive-angle Doppler velocity');
        const dopplers = [1, -1].map(sign => {
          const values = { ...env, ray: env.tangent.map(v => -sign * v) };
          values.toward = evaluate(assignment(disk, 'toward'), values);
          close(values.toward, sign, 'Doppler toward follows the tangent');
          return evaluate(assignment(disk, 'doppler'), values);
        });
        assert.ok(dopplers[0] > dopplers[1], 'positive-angle motion approaches and is Doppler brighter');
        const before = phases(env), dt = 0.2;
        const moved = diskState(tilt, spin, radius, phi + env.rate * dt, time + dt);
        phases(moved).forEach((phase, sample) => phase.forEach((value, component) => {
          close(value, before[sample][component],
            `GLSL gas phase follows +angle: tilt=${tilt}, spin=${spin}, r=${radius}, phi=${phi}, t=${time}, sample=${sample}, component=${component}`);
        }));
      }
    }
  }
});
