import test from 'node:test';
import assert from 'node:assert/strict';
import { circularOrbit, iscoOffset } from '../src/kerr.js';
import { PRESETS } from '../src/physics.js';
import { worlds } from '../src/worlds.js';
import { reset, advance, travel, formatDuration, formatFactor } from '../src/ledger.js';

const DAY = 86400;
const YEAR = 365.25 * DAY;
const relative = (actual, expected, message) => assert.ok(Math.abs(actual / expected - 1) <= 1e-12,
  `${message}: ${actual} vs ${expected}`);

test('ledger starts on the ship and uses its K1 home-to-crew clock ratio', () => {
  for (const delta of [1, ...Object.values(PRESETS).map(preset => preset.spinDelta)]) {
    const initial = reset();
    const ledger = advance(initial, 3600, delta);
    assert.equal(ledger.location, 'ship');
    assert.equal(ledger.crewSeconds, 3600);
    relative(ledger.homeSeconds / ledger.crewSeconds, circularOrbit(400, delta).dtdtau, 'ship factor');
    relative(ledger.bodySeconds.ship, ledger.crewSeconds, 'ship clock');
    assert.deepEqual(initial, reset(), 'advance leaves its input unchanged');
  }
});

test('one crew hour on near-extremal Brink advances Home by its K1 factor and at least seven years', () => {
  const delta = PRESETS.deep.spinDelta;
  const ledger = advance(travel(reset(), 'brink'), 3600, delta);
  const expected = circularOrbit({ offset: iscoOffset(delta) }, delta).dtdtau * 3600;
  assert.equal(ledger.homeSeconds, expected);
  assert.ok(ledger.homeSeconds >= 7 * YEAR);
  relative(ledger.bodySeconds.brink, 3600, 'Brink clock');
});

test('mixed visits keep all body clocks tied to Home at constant spin', () => {
  for (const delta of [1, ...Object.values(PRESETS).map(preset => preset.spinDelta)]) {
    let ledger = reset();
    for (const [location, seconds] of [['brink', 3600], ['ship', 7200], ['lantern', 42], ['farShore', 888]]) {
      const before = structuredClone(ledger);
      const moved = travel(ledger, location);
      assert.deepEqual(ledger, before, 'travel leaves its input unchanged');
      assert.equal(moved.homeSeconds, before.homeSeconds);
      assert.equal(moved.crewSeconds, before.crewSeconds);
      assert.deepEqual(moved.bodySeconds, before.bodySeconds);
      ledger = advance(moved, seconds, delta);
    }
    assert.equal(ledger.crewSeconds, 3600 + 7200 + 42 + 888);
    for (const body of worlds(delta)) relative(ledger.bodySeconds[body.id], ledger.homeSeconds / body.dtdtau, body.name);
  }
});

test('36000 frame-sized advances preserve body clock ratios after mixed visits', () => {
  for (const delta of [1, ...Object.values(PRESETS).map(preset => preset.spinDelta)]) {
    let ledger = reset();
    const locations = ['ship', 'brink', 'lantern', 'farShore'];
    for (let frame = 0; frame < 36000; frame++) {
      if (frame % 9000 === 0) ledger = travel(ledger, locations[frame / 9000]);
      ledger = advance(ledger, 1 / 60, delta);
    }
    relative(ledger.crewSeconds, 600, 'crew total');
    for (const body of worlds(delta)) relative(ledger.bodySeconds[body.id], ledger.homeSeconds / body.dtdtau, body.name);
  }
});

test('a spin change affects future increments without reinterpreting accumulated clocks', () => {
  const firstDelta = 1;
  const nextDelta = PRESETS.deep.spinDelta;
  const first = advance(travel(reset(), 'brink'), 30, firstDelta);
  const snapshot = structuredClone(first);
  const next = advance(first, 60, nextDelta);
  const increment = 60 * circularOrbit({ offset: iscoOffset(nextDelta) }, nextDelta).dtdtau;
  assert.deepEqual(first, snapshot);
  assert.equal(next.homeSeconds, first.homeSeconds + increment);
  assert.equal(next.crewSeconds, 90);
  for (const body of worlds(nextDelta)) {
    assert.equal(next.bodySeconds[body.id], first.bodySeconds[body.id] + increment / body.dtdtau);
  }
});

test('reset clears all clocks, returns the crew to the ship and has independent state', () => {
  const used = advance(travel(reset(), 'brink'), 3600, PRESETS.deep.spinDelta);
  const fresh = reset();
  assert.equal(fresh.location, 'ship');
  assert.equal(fresh.homeSeconds, 0);
  assert.equal(fresh.crewSeconds, 0);
  assert.deepEqual(fresh.bodySeconds, { ship: 0, brink: 0, lantern: 0, farShore: 0 });
  used.bodySeconds.ship = 999;
  assert.equal(fresh.bodySeconds.ship, 0);
  const moved = travel(fresh, 'lantern');
  moved.bodySeconds.ship = 1;
  assert.equal(fresh.bodySeconds.ship, 0);
  assert.deepEqual(advance(fresh, 0, 1), fresh);
});

test('duration formatting rounds before each unit boundary', () => {
  for (const [seconds, expected] of [
    [0, '0 s'], [42, '42 s'], [59.4, '59 s'], [59.6, '1 min 0 s'], [60, '1 min 0 s'],
    [14 * 60 + 5, '14 min 5 s'], [3599.4, '59 min 59 s'], [3599.6, '1 h 0 min 0 s'],
    [3600, '1 h 0 min 0 s'], [3614, '1 h 0 min 14 s'],
    [48 * 3600 - 0.6, '47 h 59 min 59 s'], [48 * 3600 - 0.4, '2.0 days'],
    [48 * 3600, '2.0 days'], [12.3 * DAY, '12.3 days'], [365.2 * DAY, '365.2 days'],
    [YEAR - 0.4, '1.00 years'], [YEAR, '1.00 years'], [7.06 * YEAR, '7.06 years'],
    [999.994 * YEAR, '999.99 years'], [999.996 * YEAR, '1.00 thousand years'],
    [1000 * YEAR, '1.00 thousand years'], [3200 * YEAR, '3.20 thousand years'],
    [999994 * YEAR, '999.99 thousand years'], [999996 * YEAR, '1.00 million years'],
    [1e6 * YEAR, '1.00 million years'], [1.25e6 * YEAR, '1.25 million years'],
  ]) assert.equal(formatDuration(seconds), expected, `seconds=${seconds}`);
});

test('factor formatting uses four decimals below ten and three grouped significant digits above', () => {
  for (const [factor, expected] of [
    [1, '1.0000'], [1.00376, '1.0038'], [9.9999, '9.9999'], [10, '10.0'],
    [10.123, '10.1'], [123.456, '123'], [61923, '61,900'], [1.23456e6, '1,230,000'],
  ]) assert.equal(formatFactor(factor), expected);
});

test('invalid durations, locations, spins and formatter inputs are rejected', () => {
  for (const value of [-1, NaN, Infinity, -Infinity, '1', null, undefined]) {
    assert.throws(() => advance(reset(), value, 1), RangeError);
    assert.throws(() => formatDuration(value), RangeError);
    assert.throws(() => formatFactor(value), RangeError);
  }
  for (const location of ['home', 'unknown', null, undefined]) assert.throws(() => travel(reset(), location), RangeError);
  for (const delta of [0, -1, 1.1, NaN]) assert.throws(() => advance(reset(), 1, delta), RangeError);
});
