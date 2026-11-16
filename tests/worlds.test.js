import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../src/physics.js';
import { iscoOffset, circularOrbit, orbitPeriod, secondsPerUnit, mToRs } from '../src/kerr.js';
import { worlds, periodsInSeconds } from '../src/worlds.js';

test('world radii, clocks and both periods equal K1 at every preset and zero spin', () => {
  for (const delta of [1, ...Object.values(PRESETS).map(preset => preset.spinDelta)]) {
    const bodies = worlds(delta);
    assert.deepEqual(bodies.map(body => [body.id, body.name]), [
      ['brink', 'Brink'], ['lantern', 'Lantern'], ['farShore', 'Far Shore'], ['ship', 'Ship'],
    ]);
    const radii = [{ offset: iscoOffset(delta) }, 12, 120, 400];
    for (const [index, body] of bodies.entries()) {
      const radius = radii[index];
      assert.deepEqual(body.radius, radius);
      assert.equal(body.radiusM, typeof radius === 'number' ? radius : 1 + radius.offset);
      assert.equal(body.dtdtau, circularOrbit(radius, delta).dtdtau);
      assert.equal(body.stable, circularOrbit(radius, delta).stable);
      assert.deepEqual(body.periods, orbitPeriod(radius, delta));
      assert.equal(body.periods.home / body.periods.local, body.dtdtau);
    }
  }
});

test('every slider position has stable outer orbits and Brink on the exact ISCO', () => {
  for (let step = 0; step <= 1400; step++) {
    const delta = 10 ** (-step / 100);
    for (const body of worlds(delta)) {
      assert.equal(body.stable, true, `${body.name}, delta=${delta}`);
      if (body.id === 'brink') {
        assert.equal(body.radius.offset, iscoOffset(delta));
        assert.ok(body.dtdtau >= 1 / Math.sqrt(1 / 2) - 1e-12);
      }
    }
  }
});

test('near-extremal Brink uses its offset for clocks rather than the display radius', () => {
  const delta = PRESETS.deep.spinDelta;
  const [brink] = worlds(delta);
  assert.equal(brink.dtdtau, circularOrbit({ offset: iscoOffset(delta) }, delta).dtdtau);
  assert.notEqual(brink.dtdtau, circularOrbit(brink.radiusM, delta).dtdtau);
  assert.ok(Math.abs(mToRs(brink.radius) - 0.50002) < 1e-5);
  brink.radius.offset = 999;
  assert.equal(worlds(delta)[0].radius.offset, iscoOffset(delta));
});

test('period conversion uses K1 solar-mass seconds without changing world clocks', () => {
  for (const body of worlds(PRESETS.deep.spinDelta)) {
    for (const mass of [0, 10, 4.3e6, 1e8]) {
      assert.deepEqual(periodsInSeconds(body.periods, mass), {
        home: body.periods.home * secondsPerUnit(mass),
        local: body.periods.local * secondsPerUnit(mass),
      });
    }
    assert.ok(Math.abs(periodsInSeconds(body.periods, 1e8).home
      / periodsInSeconds(body.periods, 10).home / 1e7 - 1) < 1e-15);
  }
  for (const delta of [0, -1, 1.01, NaN, Infinity]) assert.throws(() => worlds(delta), RangeError);
  for (const mass of [-1, NaN, Infinity]) assert.throws(() => periodsInSeconds({ home: 1, local: 1 }, mass), RangeError);
});
