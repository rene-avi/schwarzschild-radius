import test from 'node:test';
import assert from 'node:assert/strict';
import { exposureTarget, smoothExposure } from '../src/shaders/post.js';
import { brightBlobs, clippedFraction, quantile, litMetrics } from './browser/pixels.mjs';

test('exposure protects excessive light while standard and dark views retain unit gain', () => {
  assert.equal(exposureTarget(0, 0), 1);
  assert.equal(exposureTarget(10.5, 0.1), 1);
  assert.ok(exposureTarget(30, 1) < exposureTarget(6, 0.1));
  assert.ok(exposureTarget(6, 3) < exposureTarget(6, 0.1));
  assert.equal(exposureTarget(1e9, 1e9), 0.035);
  assert.equal(exposureTarget(NaN, 0), 1);
  assert.equal(exposureTarget(3, Infinity), 1);
});

test('half-second logarithmic adaptation is monotone and independent of frame subdivision', () => {
  for (const [start, target] of [[1, 0.12], [0.12, 1]]) {
    const halfSecond = smoothExposure(start, target, 0.5);
    const remaining = Math.log(halfSecond / target) / Math.log(start / target);
    assert.ok(Math.abs(remaining - Math.exp(-1)) < 1e-12);
    let exposure = start;
    for (let i = 0; i < 60; i++) {
      const next = smoothExposure(exposure, target, 1 / 60);
      assert.ok(next >= Math.min(start, target) && next <= Math.max(start, target));
      assert.ok(Math.abs(Math.log(next / target)) < Math.abs(Math.log(exposure / target)));
      exposure = next;
    }
    assert.ok(Math.abs(exposure - smoothExposure(start, target, 1)) < 1e-12);
    assert.equal(smoothExposure(start, target, 0), start);
    assert.equal(smoothExposure(start, target, Infinity), start);
  }
});

function synthetic(sources) {
  return { width: 100, height: 80, luma(x, y) {
    // A sloping band tests local-background removal as well as point morphology.
    let value = 15 + y * 0.1;
    for (const { cx, cy, sx = 1.15, sy = 1.15, rotation = 0 } of sources) {
      const dx = x - cx, dy = y - cy;
      const a = dx * Math.cos(rotation) + dy * Math.sin(rotation);
      const b = dy * Math.cos(rotation) - dx * Math.sin(rotation);
      value += 160 * Math.exp(-0.5 * ((a / sx) ** 2 + (b / sy) ** 2));
    }
    return value;
  } };
}

test('connected-blob moments distinguish round subpixel stars from rotated dashes', () => {
  const round = brightBlobs(synthetic([
    { cx: 20, cy: 20 }, { cx: 40.25, cy: 20.75 }, { cx: 65.5, cy: 50.5 },
  ]));
  assert.equal(round.length, 3);
  assert.ok(quantile(round.map(blob => blob.elongation), 0.9) < 1.3);
  for (const rotation of [0, Math.PI / 4, Math.PI / 2]) {
    const elongated = brightBlobs(synthetic([{ cx: 50.25, cy: 40.25, sx: 3.5, sy: 0.9, rotation }]));
    assert.equal(elongated.length, 1);
    assert.ok(elongated[0].elongation > 2.5, `must reject a dash at rotation ${rotation}`);
  }
  const annulus = brightBlobs(synthetic([{ cx: 50, cy: 40 }, { cx: 75, cy: 40 }]),
    { cx: 50, cy: 40, inner: 15, outer: 35 });
  assert.equal(annulus.length, 1);
  assert.ok(Math.abs(annulus[0].x - 75) < 0.1);
});

test('star measurements exclude tiny cores and broad dust patches', () => {
  for (const size of [1, 2, 3, 4, 5, 80, 81, 120]) {
    const width = Math.min(size, 10), height = Math.ceil(size / width);
    const image = { width: 50, height: 50, luma(x, y) {
      const index = (y - 20) * width + x - 20;
      return x >= 20 && x < 20 + width && y >= 20 && y < 20 + height && index < size ? 160 : 0;
    } };
    const blobs = brightBlobs(image);
    assert.equal(blobs.length, size >= 5 && size <= 80 ? 1 : 0, `${size}-pixel source`);
    if (size === 5) assert.ok(Math.abs(blobs[0].elongation - 5) < 1e-12, 'moments include unit-pixel variance');
  }
});

test('white clipping counts only pixels with all three channels at the contract threshold', () => {
  const values = [[245,245,245], [255,244,255], [244,244,244], [255,255,255]];
  assert.equal(clippedFraction({ width: 4, height: 1, rgb: x => values[x] }), 0.5);
  assert.equal(clippedFraction({ width: 4, height: 1, rgb: x => values[x] }, 250), 0.25);
  assert.equal(quantile([4, 1, 2, 3], 0.5), 2);
  assert.equal(quantile([4, 1, 2, 3], 0.9), 4);
});

test('lit metrics use display luma, HSV saturation and the requested crop', () => {
  const values = [[40,40,40], [200,100,0], [245,245,245], [0,0,0]];
  const image = { width: 4, height: 1, rgb: x => values[x] };
  const lit = litMetrics(image);
  assert.equal(lit.count, 2);
  assert.equal(lit.meanLuma, (200 * 0.2126 + 100 * 0.7152 + 245) / 2);
  assert.equal(lit.meanSaturation, 0.5);
  assert.ok(Math.abs(lit.cropMeanLuma - (40 + 200 * 0.2126 + 100 * 0.7152 + 245) / 4) < 1e-12);
  const darkCrop = litMetrics(image, { x: 0, y: 0, width: 1, height: 1 });
  assert.equal(darkCrop.count, 0);
  assert.equal(darkCrop.meanLuma, 0);
  assert.equal(darkCrop.meanSaturation, 0);
  assert.ok(Math.abs(darkCrop.cropMeanLuma - 40) < 1e-12);
  assert.equal(litMetrics(image, { x: 1, y: 0, width: 2, height: 1 }).cropMeanLuma, lit.meanLuma);
});
