import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../src/physics.js';
import { horizonOffset, photonOffset, iscoOffset } from '../src/kerr.js';
import { worlds } from '../src/worlds.js';
import { formatFactor } from '../src/ledger.js';
import { heightAboveHorizon, radialScale, mapHeight, unmapRadius, mapModel } from '../src/orbitmap.js';

const deltas = [...Array.from({ length: 1401 }, (_, step) => 10 ** (-step / 100)),
  ...Object.values(PRESETS).map(preset => preset.spinDelta)];
const near = (actual, expected, tolerance = 1e-12) =>
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} vs ${expected}`);

test('log height mapping has exact disc/ship endpoints and one photon decade at every spin', () => {
  for (const delta of deltas) for (const width of [210, 188]) {
    const scale = radialScale(delta, width);
    const photonHeight = photonOffset(delta) - horizonOffset(delta);
    near(scale.hMin, photonHeight / 10);
    assert.equal(mapHeight(0, scale), scale.rho0);
    assert.equal(mapHeight(-1, scale), scale.rho0);
    assert.equal(mapHeight(scale.hMin / 2, scale), scale.rho0);
    assert.equal(mapHeight(scale.hMin, scale), scale.rho0);
    assert.equal(mapHeight(photonHeight, scale), scale.rho0 + scale.k);
    near(mapHeight(scale.hMax, scale), scale.rhoMax);
    assert.equal(unmapRadius(scale.rho0, scale), scale.hMin);
    assert.equal(unmapRadius(0, scale), scale.hMin);
    let previous = scale.rho0;
    for (let step = 1; step <= 40; step++) {
      const h = scale.hMin * (scale.hMax / scale.hMin) ** (step / 40);
      const rho = mapHeight(h, scale);
      assert.ok(rho > previous, `monotonicity at delta=${delta}, width=${width}`);
      near(unmapRadius(rho, scale), h);
      previous = rho;
    }
  }
});

test('ship ring reaches the outer radius and no ring exceeds it at every spin and width', () => {
  for (const delta of deltas) for (const width of [210, 188]) {
    const model = mapModel(delta, width);
    const ship = model.rings.find(ring => ring.id === 'ship');
    const context = `delta=${delta}, width=${width}`;
    assert.ok(Math.abs(ship.rho - model.scale.rhoMax) <= 1e-9, context);
    for (const ring of model.rings) {
      assert.ok(ring.rho <= model.scale.rhoMax + 1e-9, `${ring.id}: ${context}`);
    }
  }
});

test('map radii and factors use exact Kerr/world offsets, including Deep Brink and zero spin', () => {
  for (const delta of deltas) {
    const model = mapModel(delta, 210);
    assert.deepEqual(model.rings.map(ring => ring.id), ['horizon', 'photon', 'isco', 'ship', 'farShore', 'lantern', 'brink']);
    const isco = model.rings.find(ring => ring.id === 'isco');
    for (const body of worlds(delta)) {
      const mapped = model.bodies.find(item => item.id === body.id);
      assert.equal(mapped.h, heightAboveHorizon(body.radius, delta));
      assert.equal(mapped.factor, formatFactor(body.dtdtau));
      assert.equal(mapped.label, `${body.name} ${formatFactor(body.dtdtau)}${body.id === 'brink' ? ' · ISCO' : ''}`);
      if (body.id === 'brink') {
        assert.equal(mapped.h, iscoOffset(delta) - horizonOffset(delta));
        assert.equal(mapped.h, isco.h);
        assert.equal(mapped.rho, isco.rho);
      }
    }
  }
  const brink = mapModel(PRESETS.deep.spinDelta, 210).bodies.find(body => body.id === 'brink');
  near(brink.h, 3.7165e-5, 5e-10);
  assert.notEqual(brink.h, (1 + iscoOffset(PRESETS.deep.spinDelta)) - (1 + horizonOffset(PRESETS.deep.spinDelta)));
  const zero = mapModel(1, 210);
  near(zero.rings.find(ring => ring.id === 'photon').h, 1);
  near(zero.rings.find(ring => ring.id === 'isco').h, 4);
  near(zero.bodies.find(body => body.id === 'brink').h, 4);
});

test('label boxes reserve 5.6 px per character and 11 px height at every spin and width', () => {
  for (const delta of deltas) for (const width of [210, 188]) {
    for (const label of mapModel(delta, width).labels) {
      const context = `${label.id}: delta=${delta}, width=${width}`;
      assert.equal(label.box.width, label.label.length * 5.6, context);
      assert.equal(label.box.height, 11, context);
    }
  }
});

test('fixed dot angles and label boxes fit without collisions at every slider position and width', () => {
  const reference = mapModel(PRESETS.deep.spinDelta, 210);
  for (const delta of deltas) for (const width of [210, 188]) {
    const model = mapModel(delta, width);
    assert.equal(model.labels.length, 6);
    assert.equal(new Set(model.bodies.map(body => body.angle)).size, 4);
    for (const [index, label] of model.labels.entries()) {
      assert.equal(label.angle, reference.labels[index].angle);
      const box = label.box;
      const context = `${label.id}: delta=${delta}, width=${width}`;
      assert.ok(box.x >= 3 && box.x + box.width <= width - 3, context);
      assert.ok(box.y >= 3 && box.y + box.height <= model.height - 3, context);
      near(Math.hypot(label.point.x - model.center.x, label.point.y - model.center.y), label.rho);
      for (const other of model.labels.slice(index + 1)) {
        const b = other.box;
        assert.ok(box.x + box.width + 4 <= b.x || b.x + b.width + 4 <= box.x
          || box.y + box.height + 4 <= b.y || b.y + b.height + 4 <= box.y,
        `${context} overlaps ${other.id}`);
      }
    }
  }
});
