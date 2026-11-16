import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pixels, afterRender } from '../pixels.mjs';

const radians = degrees => degrees * Math.PI / 180;
const degrees = radians => radians * 180 / Math.PI;
const halfFov = radians(21);
const alphaAt = radius => Math.asin(Math.sqrt(27) / (2 * radius) * Math.sqrt(1 - 1 / radius));

// Gnomonic projection of a local ray around the inward axis; gaze turns over up.
function project(image, psi, azimuth, pitch) {
  const x = Math.sin(psi) * Math.sin(azimuth);
  const y = Math.sin(psi) * Math.cos(azimuth);
  const z = Math.cos(psi);
  const forward = z * Math.cos(pitch) + y * Math.sin(pitch);
  if (forward <= 0) return null;
  const sx = x / forward / Math.tan(halfFov);
  const sy = (y * Math.cos(pitch) - z * Math.sin(pitch)) / forward / Math.tan(halfFov);
  return { x: image.width / 2 + sx * image.height / 2 - 0.5, y: image.height / 2 - sy * image.height / 2 - 0.5 };
}

async function prepare(page) {
  await page.locator('[data-quality="high"]').click();
  await page.waitForFunction(() => window.eventHorizon.getState().qualityMode === 'high' && window.eventHorizon.getState().renderScale === 1);
  await page.keyboard.press('KeyH');
  await page.waitForFunction(() => document.body.classList.contains('hud-hidden'));
  await afterRender(page, { paused: true, layers: { disk: false, sky: true, ring: false, probe: false } });
}

export const checks = [
  {
    name: 'observer debug mutation is absent without URL flag',
    async run({ page }) {
      assert.equal(await page.evaluate(() => 'debug' in window.eventHorizon), false);
    },
  },
  {
    name: 'observer shadow measured on pixels at eight azimuths',
    path: '/?debug=1',
    viewport: { width: 900, height: 900 },
    async run({ page, outDir }) {
      await prepare(page);
      for (const radius of [23, 8, 3]) {
        const pitch = radius === 3 ? radians(45) : 0;
        await afterRender(page, { camera: { radius, theta: 0, elevation: 0, yaw: 0, pitch } });
        const png = await page.screenshot({ path: join(outDir, `observer-r${radius}.png`), scale: 'css' });
        const image = pixels(png);
        const azimuths = radius === 3 ? Array.from({ length: 8 }, (_, i) => radians(-20 + i * 40 / 7))
          : Array.from({ length: 8 }, (_, i) => i * Math.PI / 4);
        for (const azimuth of azimuths) {
          let previous = null;
          let found = null;
          let bright = 0;
          // Search a broad angular range, independent of the predicted boundary.
          const [start, end] = radius === 3 ? [25, 65] : [1, 24];
          for (let angle = start; angle <= end; angle += 0.01) {
            const point = project(image, radians(angle), azimuth, pitch);
            const value = point ? image.luma(point.x, point.y) : null;
            if (value === null) { previous = null; bright = 0; continue; }
            if (value <= 5) { previous = { angle, point }; bright = 0; }
            else if (previous) {
              bright++;
              if (bright >= 5) { found = previous; break; }
            }
          }
          assert.ok(found, `r=${radius}, azimuth=${degrees(azimuth)}: no dark/bright boundary`);
          const error = Math.abs(radians(found.angle) / alphaAt(radius) - 1);
          console.log(`shadow r=${radius} az=${degrees(azimuth).toFixed(1)} pixel=(${found.point.x.toFixed(1)},${found.point.y.toFixed(1)}) angle=${found.angle.toFixed(3)} error=${(100 * error).toFixed(3)}%`);
          assert.ok(error <= 0.015, `r=${radius}, azimuth=${degrees(azimuth)}: ${100 * error}% > 1.5%`);
        }
      }
    },
  },
  {
    name: 'observer photon sphere boundary is a centre line',
    path: '/?debug=1',
    viewport: { width: 900, height: 900 },
    async run({ page, outDir }) {
      await prepare(page);
      await afterRender(page, { camera: { radius: 1.5, theta: 0, elevation: 0, yaw: 0, pitch: Math.PI / 2 } });
      const image = pixels(await page.screenshot({ path: join(outDir, 'observer-photon-sphere.png'), scale: 'css' }));
      for (let x = 100; x <= 800; x += 70) {
        const boundaries = [];
        for (let y = 410; y < 490; y++) {
          if (image.luma(x, y) > 5 && image.luma(x, y + 1) <= 5) boundaries.push(y + 0.5);
        }
        assert.ok(boundaries.length > 0, `no horizon boundary at x=${x}`);
        const closest = boundaries.sort((a, b) => Math.abs(a - 449.5) - Math.abs(b - 449.5))[0];
        assert.ok(Math.abs(closest - 449.5) <= 6, `x=${x}: horizon at y=${closest}`);
        assert.ok(image.luma(x, 400) > 5, 'sky above horizon');
        assert.ok(image.luma(x, 500) <= 5, 'shadow below horizon');
      }
    },
  },
];
