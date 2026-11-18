import test from 'node:test';
import assert from 'node:assert/strict';
import { createKerrProbe, probeDropRefusal, updateKerrProbe } from '../src/kerrprobe.js';
import { KERR_RAY } from '../src/kerrray.js';

function drop(radius, elevation, spin, theta = 0) {
  const c = Math.cos(25 * Math.PI / 180), s = Math.sin(25 * Math.PI / 180);
  const radial = [Math.sin(theta) * Math.cos(elevation), Math.sin(elevation), Math.cos(theta) * Math.cos(elevation)];
  const right = [Math.cos(theta), 0, -Math.sin(theta)];
  const direction = radial.map((v, i) => v * c + right[i] * s);
  direction[1] = Math.max(.18, direction[1]);
  return { position: radial.map(v => radius * v), direction, spin };
}

test('orbit-limit and near-release cameras support either elevation sign and rotated azimuth', () => {
  for (const spin of [0, .9, .998]) for (const elevation of [-1.35, 1.35]) for (const radius of [KERR_RAY.minimumCamera, 3, 7, 7.000001, 65]) {
    const probe = createKerrProbe(drop(radius, elevation, spin, .7));
    assert.equal(probe.state, 'falling');
    updateKerrProbe(probe, probe.lostTime);
    assert.equal(probe.state, 'lost');
  }
  assert.equal(probeDropRefusal(drop(7.000001, .23, .998).position, .998), null);
});
