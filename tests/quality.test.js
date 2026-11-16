import test from 'node:test';
import assert from 'node:assert/strict';
import { QualityController } from '../src/quality.js';

function simulate(fps, seconds = 120, controller = new QualityController()) {
  const decisions = [];
  let time = 0;
  while (time < seconds) {
    const previous = controller.scale;
    const dt = 1 / fps(controller.scale, time);
    const decision = controller.feed(dt);
    time += dt;
    if (decision) decisions.push({ time, direction: Math.sign(decision.scale - previous), ...decision });
  }
  return { controller, decisions, ...controller.getState() };
}

for (const cap of [30, 48]) test(`a: idle GPU capped at ${cap} fps returns to HIGH at 100%`, () => {
  const result = simulate(() => cap);
  assert.equal(result.scale, 1);
  assert.equal(result.mode, 'HIGH');
  assert.ok(Math.abs(result.frameCap - cap) < 1);
});

for (const rate of [60, 120]) test(`b: smooth ${rate} fps makes no quality decisions`, () => {
  const result = simulate(() => rate);
  assert.equal(result.scale, 1);
  assert.equal(result.decisions.length, 0);
});

test('c: weak GPU settles above 50 fps or at floor without repeated oscillation', () => {
  const device = scale => Math.min(60, 26 / scale ** 2);
  const result = simulate(device);
  assert.ok(device(result.scale) >= 50 || result.scale === 0.4, `scale=${result.scale}`);
  const recent = result.decisions.filter(d => d.time >= 60);
  const turns = recent.filter((d, i) => i > 0 && d.direction !== recent[i - 1].direction).length;
  assert.ok(turns <= 2, `${turns} direction changes in last 60 seconds`);
});

test('d: weak GPU under a cap reaches at least 85% of the cap', () => {
  const device = scale => Math.min(30, 14 / scale ** 2);
  const result = simulate(device);
  assert.ok(result.decisions.some(d => d.direction < 0));
  assert.ok(device(result.scale) >= 30 * 0.85, `scale=${result.scale}`);
});

test('e: one second at 10 fps inside a smooth run causes no change', () => {
  const result = simulate((scale, time) => time >= 30 && time < 31 ? 10 : 60);
  assert.equal(result.decisions.length, 0);
  assert.equal(result.scale, 1);
});

test('f: a lifted cap is forgotten and full quality returns', () => {
  const capped = simulate(() => 30, 60);
  assert.ok(Math.abs(capped.frameCap - 30) < 1);
  const result = simulate(() => 120, 60, capped.controller);
  assert.equal(result.scale, 1);
  assert.equal(result.frameCap, null);
});

for (const [mode, scale, qualityIndex] of [['high', 1, 2], ['balanced', 0.76, 1], ['performance', 0.52, 0]]) {
  test(`fixed ${mode} ignores slow and fast devices and uses its step budget`, () => {
    const controller = new QualityController();
    controller.setMode(mode);
    const slow = simulate(() => 10, 120, controller);
    const fast = simulate(() => 120, 120, controller);
    assert.equal(slow.scale, scale);
    assert.equal(fast.scale, scale);
    assert.equal(fast.qualityIndex, qualityIndex);
    assert.equal(fast.qualityMode, mode);
    assert.equal(fast.frameCap, null);
    assert.equal(slow.decisions.length + fast.decisions.length, 0);
    controller.setMode('auto');
    assert.equal(controller.scale, 1);
    assert.ok(simulate(s => Math.min(60, 26 / s ** 2), 120, controller).scale < 1);
  });
}

test('g: twenty seconds without frames does not change quality', () => {
  const { controller } = simulate(() => 60);
  const before = controller.getState();
  assert.equal(controller.feed(20), null);
  assert.equal(controller.scale, before.scale);
  const result = simulate(() => 60, 120, controller);
  assert.equal(result.decisions.length, 0);
  assert.equal(result.scale, before.scale);
});

test('h: a vsync-quantised 40 fps GPU reaches 60 fps without remembering a cap', () => {
  const device = scale => 60 / Math.ceil(60 / (40 / scale ** 2));
  const result = simulate(device);
  assert.equal(device(result.scale), 60, `scale=${result.scale}, cap=${result.frameCap}`);
  assert.ok(result.scale < 1);
  assert.equal(result.frameCap, null);
});

test('i: a vsync-quantised 22 fps GPU reaches the best floor rate without repeated oscillation', () => {
  const device = scale => 60 / Math.ceil(60 / (22 / scale ** 2));
  const result = simulate(device);
  assert.equal(device(result.scale), device(0.4), `scale=${result.scale}, cap=${result.frameCap}`);
  const recent = result.decisions.filter(d => d.time >= 60);
  const turns = recent.filter((d, i) => i > 0 && d.direction !== recent[i - 1].direction).length;
  assert.ok(turns <= 2, `${turns} direction changes in last 60 seconds`);
});
