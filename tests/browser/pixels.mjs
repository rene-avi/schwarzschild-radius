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
  return { width, height, luma(x, y) {
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
