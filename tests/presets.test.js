import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, schwarzschildRadius } from '../src/physics.js';
import { spinFromDelta } from '../src/kerr.js';

test('all four requested presets are available in order with recognizable names', () => {
  assert.deepEqual(Object.keys(PRESETS), ['gargantua', 'sagittarius', 'quiet', 'deep']);
  assert.equal(PRESETS.gargantua.name, 'Gargantua');
  assert.equal(PRESETS.sagittarius.name, 'Sagittarius A*');
  assert.equal(PRESETS.quiet.name, 'Quiet');
  assert.equal(PRESETS.deep.name, 'Deep orbit');
});

test('each preset contains a complete finite, physically bounded control state', () => {
  for (const preset of Object.values(PRESETS)) {
    assert.deepEqual(Object.keys(preset), ['name', 'mass', 'spinDelta', 'temperature', 'tilt', 'lensing', 'timeScale']);
    for (const field of ['mass', 'spinDelta', 'temperature', 'tilt', 'lensing', 'timeScale']) {
      assert.ok(Number.isFinite(preset[field]), `${preset.name}.${field}`);
    }
    assert.ok(preset.mass > 0);
    assert.ok(preset.spinDelta >= 1e-14 && preset.spinDelta <= 1);
    assert.ok(preset.temperature >= 1000 && preset.temperature <= 30_000);
    assert.ok(Math.abs(preset.tilt) <= 90);
    assert.ok(preset.lensing > 0 && preset.lensing <= 2);
    assert.ok(preset.timeScale >= 0 && preset.timeScale <= 4);
    assert.ok(schwarzschildRadius(preset.mass) > 0);
  }
});

test('presets are immutable, including individual records', () => {
  assert.ok(Object.isFrozen(PRESETS));
  for (const preset of Object.values(PRESETS)) assert.ok(Object.isFrozen(preset));
  const copy = { ...PRESETS.gargantua };
  copy.mass = 1;
  assert.equal(PRESETS.gargantua.mass, 100_000_000);
});

test('Sagittarius A* mass matches the observed galactic-center scale', () => {
  assert.equal(PRESETS.sagittarius.mass, 4_300_000);
});

test('Quiet reduces the disk temperature, rotation, and simulation rate', () => {
  for (const field of ['temperature', 'timeScale']) {
    assert.ok(PRESETS.quiet[field] < PRESETS.gargantua[field], field);
  }
  assert.ok(spinFromDelta(PRESETS.quiet.spinDelta) < spinFromDelta(PRESETS.gargantua.spinDelta));
});

test('preset deltas retain the original visual spins and specify the near-extremal orbit', () => {
  for (const [id, delta, spin] of [['gargantua', 0.15, 0.85], ['sagittarius', 0.45, 0.55], ['quiet', 0.92, 0.08]]) {
    assert.equal(PRESETS[id].spinDelta, delta);
    assert.ok(Math.abs(spinFromDelta(delta) - spin) < 1e-15);
  }
  assert.deepEqual(PRESETS.deep, {
    name: 'Deep orbit', mass: 1e8, spinDelta: 1.3e-14, temperature: 6500,
    tilt: 6, lensing: 1, timeScale: 1,
  });
});
