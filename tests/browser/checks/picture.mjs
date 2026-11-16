import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { pixels, afterRender, settledExposure, brightBlobs, quantile, clippedFraction, litMetrics } from '../pixels.mjs';

const crop = { x: 270, y: 180, width: 850, height: 520 };

async function prepare(page) {
  await page.locator('[data-quality="high"]').click();
  await page.waitForFunction(() => window.eventHorizon.getState().qualityMode === 'high'
    && window.eventHorizon.getState().renderScale === 1);
  await afterRender(page, { paused: true, layers: { probe: false } });
  await page.keyboard.press('KeyH');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#hud')).opacity === '0');
}

async function capture(page, outDir, name) {
  await settledExposure(page);
  return pixels(await page.screenshot({ path: join(outDir, `${name}.png`), scale: 'css' }));
}

function shadowAnnulus(image, radius = 23, lensing = 1) {
  const alpha = Math.asin(Math.sqrt(27) / 2 * lensing * Math.sqrt(1 - lensing / radius) / radius);
  const shadow = Math.tan(alpha) / Math.tan(21 * Math.PI / 180) * image.height / 2;
  return { cx: image.width * (0.5 - 0.065) - 0.5, cy: image.height / 2 - 0.5, inner: shadow * 1.3, outer: shadow * 2.5 };
}

async function visibleType(page, minimum, secondary) {
  const violations = await page.evaluate(({ minimum, secondary }) => {
    const bad = [];
    const walker = document.createTreeWalker(document.querySelector('#hud'), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, el = node.parentElement;
      if (!node.textContent.trim() || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      const required = secondary && el.closest('.parameter-output, .metric-value small, .probe-values dd, .performance, .object-coordinates, .simulation-time .eyebrow span') ? 11 : minimum;
      if (size < required) bad.push({ text: node.textContent.trim(), size, required });
    }
    return bad;
  }, { minimum, secondary });
  assert.deepEqual(violations, [], 'visible HUD text sizes');
}

export const checks = [
  {
    name: 'picture round stars and retained default star brightness',
    path: '/?debug=1',
    async run({ page, outDir }) {
      await prepare(page);
      const full = await capture(page, outDir, 'picture-default');
      await afterRender(page, { layers: { disk: false, ring: false } });
      const sky = await capture(page, outDir, 'picture-stars');
      const annulus = shadowAnnulus(sky);
      const blobs = brightBlobs(sky, annulus);
      assert.ok(blobs.length >= 40, `annulus contains ${blobs.length} measurable star blobs, expected at least 40`);
      const median = quantile(blobs.map(blob => blob.elongation), 0.5);
      const p90 = quantile(blobs.map(blob => blob.elongation), 0.9);
      console.log(`star shapes: n=${blobs.length}, median=${median.toFixed(3)}, p90=${p90.toFixed(3)}`);
      assert.ok(median <= 1.3, `star median elongation ${median} > 1.3`);
      assert.ok(p90 <= 1.8, `star p90 elongation ${p90} > 1.8`);
      // Match actual full-frame star cores to the isolated background catalogue.
      const fullStars = brightBlobs(full, annulus).filter(blob => blobs.some(star => Math.hypot(star.x - blob.x, star.y - blob.y) < 2));
      const brightest = fullStars.map(blob => blob.peak).sort((a, b) => b - a).slice(0, 40);
      assert.equal(brightest.length, 40, 'forty identifiable stars remain in the full disk view');
      const starPeak = quantile(brightest, 0.5);
      assert.ok(starPeak >= 60, `median peak of forty brightest default stars ${starPeak} < 60`);
      await writeFile(join(outDir, 'picture-stars.json'), JSON.stringify({ count: blobs.length, median, p90, starPeak }, null, 2));
    },
  },
  {
    name: 'picture compressed hover sky retains dense compact stars',
    path: '/?debug=1',
    async run({ page, outDir }) {
      await prepare(page);
      await afterRender(page, { camera: { radius: 1.03, theta: 0.05, elevation: 16 * Math.PI / 180, yaw: 0, pitch: Math.PI } });
      await page.waitForFunction(() => window.eventHorizon.getState().camera.radius === 1.03
        && window.eventHorizon.getState().camera.gazePitch === Math.PI);
      await capture(page, outDir, 'picture-hover');
      await afterRender(page, { layers: { disk: false, ring: false } });
      const sky = await capture(page, outDir, 'picture-hover-sky');
      const angularRadius = Math.asin(Math.sqrt(27) / 2 * Math.sqrt(1 - 1 / 1.03) / 1.03);
      const disc = { cx: sky.width * (0.5 - 0.065) - 0.5, cy: sky.height / 2 - 0.5,
        outer: Math.tan(angularRadius) / Math.tan(21 * Math.PI / 180) * sky.height / 2 - 7 };
      const blobs = brightBlobs(sky, disc);
      const compact = blobs.filter(blob => blob.elongation <= 1.8);
      const result = { count: blobs.length, compact: compact.length,
        median: blobs.length ? quantile(blobs.map(blob => blob.elongation), 0.5) : null,
        p90: blobs.length ? quantile(blobs.map(blob => blob.elongation), 0.9) : null };
      await writeFile(join(outDir, 'picture-hover-stars.json'), JSON.stringify(result, null, 2));
      console.log(`hover stars: ${JSON.stringify(result)}`);
      assert.ok(compact.length >= 250, `hover sky contains ${compact.length} compact star blobs, expected at least 250`);
    },
  },
  {
    name: 'picture luminous structured highlights in every preset and hot disk',
    path: '/?debug=1',
    async run({ page, outDir }) {
      await prepare(page);
      const results = [];
      for (const preset of ['gargantua', 'sagittarius', 'quiet']) {
        await page.evaluate(id => document.querySelector(`[data-preset="${id}"]`).click(), preset);
        await page.waitForFunction(id => document.querySelector(`[data-preset="${id}"]`).getAttribute('aria-pressed') === 'true'
          && window.eventHorizon.getState().camera.mode === 'orbit', preset);
        await afterRender(page, { camera: { radius: 23, theta: 0.05, elevation: 0.23, yaw: 0, pitch: 0 } });
        for (const hot of [false, true]) {
          if (hot) {
            await page.evaluate(() => {
              const slider = document.querySelector('#param-temperature');
              slider.value = '20000';
              slider.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await page.waitForFunction(() => window.eventHorizon.getState().settings.temperature === 20000
              && document.querySelector('[data-control-output="temperature"]').textContent === '20,000');
          }
          const name = `picture-${preset}${hot ? '-20000K' : ''}`;
          const image = await capture(page, outDir, name);
          const fraction = clippedFraction(image);
          const lit = litMetrics(image, crop);
          const exposure = await page.evaluate(() => window.eventHorizon.getState().exposure);
          results.push({ name, fraction, exposure, ...lit });
          await writeFile(join(outDir, 'picture-exposure.json'), JSON.stringify(results, null, 2));
          console.log(`${name}: white=${(fraction * 100).toFixed(4)}%, exposure=${exposure.toFixed(4)}, crop luma=${lit.cropMeanLuma.toFixed(2)}`);
          const minimum = preset === 'gargantua' && !hot ? 0.0008 : 0.0003;
          assert.ok(fraction >= minimum && fraction < 0.006,
            `${name}: ${(fraction * 100).toFixed(4)}% near-white outside [${minimum * 100}%, 0.6%)`);
          if (preset === 'gargantua' && !hot) assert.ok(lit.cropMeanLuma >= 50 && lit.cropMeanLuma <= 80,
            `default crop mean luma ${lit.cropMeanLuma} outside [50, 80]`);
        }
      }
      await writeFile(join(outDir, 'picture-exposure.json'), JSON.stringify(results, null, 2));
    },
  },
  {
    name: 'picture top view and resolved Einstein source references',
    path: '/?debug=1',
    async run({ page, outDir }) {
      await prepare(page);
      await afterRender(page, { camera: { radius: 23, theta: 0.05, elevation: 1.2, yaw: 0, pitch: 0 } });
      const top = await capture(page, outDir, 'picture-top');
      const colour = litMetrics(top);
      await writeFile(join(outDir, 'picture-top.json'), JSON.stringify({ ...colour, crop: litMetrics(top, crop) }, null, 2));
      assert.ok(colour.meanSaturation >= 0.40, `top lit mean saturation ${colour.meanSaturation} < 0.40`);
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => Math.abs(window.eventHorizon.getState().camera.elevation - Math.atan2(5.8, 21)) < 1e-9);
      await afterRender(page, {});
      await capture(page, outDir, 'picture-einstein');
      await afterRender(page, { layers: { disk: false, ring: false } });
      await capture(page, outDir, 'picture-einstein-sky');
    },
  },
  ...[{ width: 1440, height: 900 }, { width: 375, height: 812 }].map(viewport => ({
    name: `picture readable HUD at ${viewport.width} pixels`,
    viewport,
    async run({ page, outDir }) {
      const narrow = viewport.width <= 760;
      if (narrow) {
        await page.locator('.panel-toggle').click();
        await page.waitForFunction(() => !document.querySelector('.control-panel').inert
          && getComputedStyle(document.querySelector('.control-panel')).opacity === '1');
      }
      await visibleType(page, narrow ? 8.5 : 9, !narrow);
      await page.screenshot({ path: join(outDir, `picture-type-${viewport.width}.png`), scale: 'css' });
      await page.keyboard.press('Slash');
      await page.waitForFunction(() => document.querySelector('dialog').open);
      await visibleType(page, narrow ? 8.5 : 9, !narrow);
    },
  })),
];
