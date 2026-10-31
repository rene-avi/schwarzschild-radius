import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, schwarzschildRadius } from '../src/physics.js';

test('all three requested presets are available with recognizable names', () => {
  assert.deepEqual(Object.keys(PRESETS), ['gargantua', 'sagittarius', 'quiet']);
  assert.equal(PRESETS.gargantua.name, 'Gargantua');
  assert.equal(PRESETS.sagittarius.name, 'Sagittarius A*');
  assert.equal(PRESETS.quiet.name, 'Quiet');
});

test('each preset contains a complete finite, physically bounded control state', () => {
  for (const preset of Object.values(PRESETS)) {
    for (const field of ['mass', 'spin', 'temperature', 'tilt', 'lensing', 'timeScale']) {
      assert.ok(Number.isFinite(preset[field]), `${preset.name}.${field}`);
    }
    assert.ok(preset.mass > 0);
    assert.ok(preset.spin >= 0 && preset.spin < 1);
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
  for (const field of ['temperature', 'spin', 'timeScale']) {
    assert.ok(PRESETS.quiet[field] < PRESETS.gargantua[field], field);
  }
});
