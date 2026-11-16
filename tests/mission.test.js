import test from 'node:test';
import assert from 'node:assert/strict';
import { CREW_SECONDS_PER_REAL_SECOND, crewStep } from '../src/mission.js';

test('mission rate is one crew hour per four real seconds', () => {
  assert.equal(CREW_SECONDS_PER_REAL_SECOND, 900);
  assert.equal(Array.from({ length: 40 }, () => crewStep(0.1, 1, true, false))
    .reduce((total, seconds) => total + seconds, 0), 3600);
});

test('pause and stopped mission clocks never advance at any time scale', () => {
  for (const scale of [0, 1, 4]) {
    assert.equal(crewStep(0.1, scale, false, false), 0);
    assert.equal(crewStep(0.1, scale, true, true), 0);
    assert.equal(crewStep(0.1, scale, false, true), 0);
  }
});

test('time scale multiplies the caller-clamped delta exactly once', () => {
  assert.equal(crewStep(0.1, 0, true, false), 0);
  assert.equal(crewStep(0.1, 0.5, true, false), 45);
  assert.equal(crewStep(0.1, 4, true, false), 360);
  assert.equal(crewStep(0, 4, true, false), 0);
  assert.equal(crewStep(0.05, 2, true, false), 90);
});

test('crewStep leaves delta clamping to the caller', () => {
  assert.equal(crewStep(0.2, 1, true, false), 180);
});
