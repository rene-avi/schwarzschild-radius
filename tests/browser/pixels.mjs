import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

// Decode lossless Chromium screenshots without introducing an image dependency.
export function pixels(png) {
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  let width, height, channels;
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + size);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'eight-bit screenshot');
      assert.ok(data[9] === 2 || data[9] === 6, 'RGB/RGBA screenshot');
      assert.equal(data[12], 0, 'non-interlaced screenshot');
      channels = data[9] === 6 ? 4 : 3;
    }
    if (type === 'IDAT') chunks.push(data);
    offset += size + 12;
  }
  const encoded = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const decoded = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = encoded[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? decoded[y * stride + x - channels] : 0;
      const above = y > 0 ? decoded[(y - 1) * stride + x] : 0;
      const upperLeft = y > 0 && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0;
      const p = left + above - upperLeft;
      const pa = Math.abs(p - left), pb = Math.abs(p - above), pc = Math.abs(p - upperLeft);
      const predictor = [0, left, above, Math.floor((left + above) / 2), pa <= pb && pa <= pc ? left : pb <= pc ? above : upperLeft][filter];
      decoded[y * stride + x] = (encoded[y * (stride + 1) + x + 1] + predictor) & 255;
    }
  }
  return { width, height, rgb(x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const i = y * stride + x * channels;
    return [decoded[i], decoded[i + 1], decoded[i + 2]];
  }, luma(x, y) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return null;
    const i = y * stride + x * channels;
    return 0.2126 * decoded[i] + 0.7152 * decoded[i + 1] + 0.0722 * decoded[i + 2];
  } };
}

export async function afterRender(page, change) {
  const frame = await page.evaluate(change => {
    const before = window.eventHorizon.getState().renderedFrames;
    if (change.camera) window.eventHorizon.debug.setCamera(change.camera);
    if (change.layers) window.eventHorizon.debug.setLayers(change.layers);
    if (typeof change.paused === 'boolean') window.eventHorizon.debug.setPaused(change.paused);
    return before;
  }, change);
  await page.waitForFunction(frame => window.eventHorizon.getState().renderedFrames > frame + 1, frame);
}

export async function settledExposure(page) {
  await page.evaluate(() => {
    window.pictureExposureHistory = [];
    window.pictureExposureStart = performance.now();
  });
  await page.waitForFunction(() => {
    const state = window.eventHorizon.getState();
    const now = performance.now();
    if (now - window.pictureExposureStart < 1200 || !(state.exposure > 0)) return false;
    const history = window.pictureExposureHistory;
    const last = history.at(-1);
    if (!last || (now - last.time >= 200 && state.renderedFrames > last.frame)) {
      history.push({ time: now, frame: state.renderedFrames, value: state.exposure });
      if (history.length > 6) history.shift();
    }
    return history.length === 6 && history.at(-1).time - history[0].time >= 1000
      && Number.isFinite(state.exposure)
      && Math.log(Math.max(...history.map(s => s.value)) / Math.min(...history.map(s => s.value))) < 0.003;
  }, null, { timeout: 45000 });
}

export function quantile(values, fraction) {
  assert.ok(values.length > 0, 'nonempty quantile');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

export function clippedFraction(image, threshold = 245) {
  let count = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.rgb(x, y).every(channel => channel >= threshold)) count++;
  }
  return count / (image.width * image.height);
}

export function litMetrics(image, { x = 0, y = 0, width = image.width, height = image.height } = {}) {
  let count = 0, luma = 0, saturation = 0, totalLuma = 0;
  for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) {
    const rgb = image.rgb(px, py);
    const light = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    totalLuma += light;
    if (light <= 40) continue;
    count++;
    luma += light;
    saturation += (Math.max(...rgb) - Math.min(...rgb)) / Math.max(...rgb);
  }
  return { count, meanLuma: count ? luma / count : 0, meanSaturation: count ? saturation / count : 0,
    cropMeanLuma: totalLuma / (width * height) };
}

// A local background removes the broad galaxy band, leaving connected point cores.
export function brightBlobs(image, { cx, cy, inner = 0, outer = Infinity, contrast = 12 } = {}) {
  cx ??= (image.width - 1) / 2;
  cy ??= (image.height - 1) / 2;
  const weights = new Float32Array(image.width * image.height);
  const marked = new Set();
  for (let y = 7; y < image.height - 7; y++) for (let x = 7; x < image.width - 7; x++) {
    const radius = Math.hypot(x - cx, y - cy);
    if (radius < inner || radius > outer) continue;
    const background = quantile([[6,0],[-6,0],[0,6],[0,-6],[4,4],[-4,4],[4,-4],[-4,-4]]
      .map(([dx, dy]) => image.luma(x + dx, y + dy)), 0.5);
    const value = image.luma(x, y) - background;
    if (value >= contrast) {
      const index = y * image.width + x;
      marked.add(index);
      weights[index] = value;
    }
  }
  const blobs = [];
  while (marked.size) {
    const indices = [marked.values().next().value];
    marked.delete(indices[0]);
    for (let i = 0; i < indices.length; i++) {
      const x = indices[i] % image.width, y = Math.floor(indices[i] / image.width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= image.width || ny < 0 || ny >= image.height) continue;
        const next = ny * image.width + nx;
        if (marked.delete(next)) indices.push(next);
      }
    }
    // Tiny samples have unstable moments; broad dust patches are not point cores.
    if (indices.length < 5 || indices.length > 80) continue;
    let sum = 0, sx = 0, sy = 0, peak = 0;
    for (const index of indices) {
      const x = index % image.width, y = Math.floor(index / image.width), w = weights[index];
      sum += w; sx += w * x; sy += w * y;
      peak = Math.max(peak, image.luma(x, y));
    }
    const x = sx / sum, y = sy / sum;
    let xx = 0, xy = 0, yy = 0;
    for (const index of indices) {
      const dx = index % image.width - x, dy = Math.floor(index / image.width) - y, w = weights[index];
      xx += w * dx * dx; xy += w * dx * dy; yy += w * dy * dy;
    }
    // Include the second moment of each unit-square pixel, not point samples.
    xx = xx / sum + 1 / 12; yy = yy / sum + 1 / 12; xy /= sum;
    const discriminant = Math.hypot(xx - yy, 2 * xy);
    const elongation = Math.sqrt((xx + yy + discriminant) / Math.max(1e-9, xx + yy - discriminant));
    blobs.push({ x, y, peak, elongation, indices });
  }
  return blobs;
}
