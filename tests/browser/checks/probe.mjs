import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { pixels, afterRender } from '../pixels.mjs';

const state = page => page.evaluate(() => window.eventHorizon.getState());

async function advanceTo(page, time) {
  const frame = await page.evaluate(time => {
    const before = window.eventHorizon.getState();
    window.eventHorizon.debug.advanceProbe(time - before.probe.elapsed);
    return before.renderedFrames;
  }, time);
  await page.waitForFunction(frame => window.eventHorizon.getState().renderedFrames > frame + 1, frame);
  await page.waitForFunction(() => {
    const p = window.eventHorizon.getState().probe;
    return document.querySelector('[data-readout="probeRadius"]').textContent === p.radius.toFixed(3)
      && document.querySelector('[data-readout="probeSignal"]').textContent === p.signal.toFixed(3)
      && document.querySelector('[data-readout="probeClock"]').textContent === p.properElapsed.toFixed(3)
      && document.querySelector('[data-readout="probeObserverClock"]').textContent === p.observerElapsed.toFixed(3)
      && document.querySelector('[data-readout="probeFlashes"]').textContent === `FLASH ${p.flashCount} of ${p.flashTotal}`
      && Math.abs(Number(document.querySelector('#hud').style.getPropertyValue('--probe-pulse')) - p.pulse) < 1e-6;
  });
}

function cluster(on, off) {
  assert.equal(on.width, off.width);
  assert.equal(on.height, off.height);
  const marked = new Set();
  let brightness = 0;
  for (let y = 0; y < on.height; y++) {
    for (let x = 0; x < on.width; x++) {
      const a = on.rgb(x, y), b = off.rgb(x, y);
      if (Math.max(...a.map((v, i) => Math.abs(v - b[i]))) >= 12) {
        marked.add(y * on.width + x);
        brightness += 0.2126 * Math.max(0, a[0] - b[0])
          + 0.7152 * Math.max(0, a[1] - b[1]) + 0.0722 * Math.max(0, a[2] - b[2]);
      }
    }
  }
  const count = marked.size;
  let largest = [];
  while (marked.size) {
    const queue = [marked.values().next().value];
    marked.delete(queue[0]);
    for (let i = 0; i < queue.length; i++) {
      const x = queue[i] % on.width, y = Math.floor(queue[i] / on.width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= on.width || ny < 0 || ny >= on.height) continue;
        const index = ny * on.width + nx;
        if (marked.delete(index)) queue.push(index);
      }
    }
    if (queue.length > largest.length) largest = queue;
  }
  let red = 0, blue = 0;
  let minX = on.width, maxX = -1, minY = on.height, maxY = -1;
  for (const index of largest) {
    const x = index % on.width, y = Math.floor(index / on.width);
    const a = on.rgb(x, y), b = off.rgb(x, y);
    red += Math.max(0, a[0] - b[0]);
    blue += Math.max(0, a[2] - b[2]);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { count, brightness, size: largest.length, redBlue: red / Math.max(1, blue),
    width: largest.length ? maxX - minX + 1 : 0,
    height: largest.length ? maxY - minY + 1 : 0 };
}

function pulsePeaks(samples) {
  return samples.filter((sample, i) => {
    if (i === 0 || i === samples.length - 1) return false;
    if (sample.brightness <= samples[i - 1].brightness || sample.brightness < samples[i + 1].brightness) return false;
    const before = Math.min(...samples.slice(Math.max(0, i - 4), i).map(s => s.brightness));
    const after = Math.min(...samples.slice(i + 1, i + 5).map(s => s.brightness));
    return sample.brightness > 1.3 * Math.max(before, after);
  });
}

const meanInterval = peaks => (peaks.at(-1).time - peaks[0].time) / (peaks.length - 1);

async function difference(page, outDir, name) {
  await afterRender(page, { layers: { probe: false } });
  const off = pixels(await page.screenshot({ scale: 'css' }));
  await afterRender(page, { layers: { probe: true } });
  const on = pixels(await page.screenshot({ path: join(outDir, name), scale: 'css' }));
  return cluster(on, off);
}

async function prepare(page) {
  await page.locator('[data-quality="high"]').click();
  await page.waitForFunction(() => window.eventHorizon.getState().qualityMode === 'high');
  await afterRender(page, { paused: true });
  await page.waitForFunction(() => window.eventHorizon.getState().probe === null
    && document.querySelector('[data-readout="probeState"]').textContent === 'PROBE STANDBY'
    && document.querySelector('.probe-values').hidden);
  assert.equal(await page.locator('.probe-values').isVisible(), false, 'standby has only a status line');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.eventHorizon.getState().probe?.state === 'falling'
    && document.querySelector('[data-readout="probeState"]').textContent === 'PROBE · FALLING'
    && !document.querySelector('.probe-values').hidden);
  await page.waitForFunction(() => document.querySelector('.notice').textContent
    === 'Watch the beacon: one flash per second of its own time.');
}

export const checks = [
  {
    name: 'probe retarded clock signal colour visibility and loss',
    path: '/?debug=1',
    viewport: { width: 900, height: 900 },
    async run({ page, outDir, audit }) {
      await prepare(page);
      const panel = page.getByRole('region', { name: 'Probe signal' });
      for (const text of ['SEEN AT', 'SIGNAL', 'PROBE CLOCK', 'YOUR CLOCK']) {
        assert.equal(await panel.getByText(text, { exact: true }).isVisible(), true, text);
      }
      await page.keyboard.press('KeyH');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#hud')).opacity === '0');
      await advanceTo(page, 6);
      const initial = await difference(page, outDir, 'probe-6s.png');
      assert.ok(initial.size >= 12 && initial.width >= 3 && initial.height >= 3,
        `default-view probe must form a visible pixel cluster: ${JSON.stringify(initial)}`);
      assert.ok(initial.count < 900 * 900 * 0.03, 'probe stays a small craft');
      await advanceTo(page, 20);
      await page.screenshot({ path: join(outDir, 'probe-20s.png'), scale: 'css' });
      await advanceTo(page, 36);
      await page.screenshot({ path: join(outDir, 'probe-36s.png'), scale: 'css' });
      // Isolate emission from the disk/sky for a colour comparison of the actual probe pixels.
      await afterRender(page, { layers: { disk: false, sky: false, ring: false } });
      const middle = await difference(page, outDir, 'probe-36s-isolated.png');
      await page.keyboard.press('KeyP');
      await page.waitForFunction(() => window.eventHorizon.getState().probe.elapsed === 0);
      await advanceTo(page, 6);
      const early = await difference(page, outDir, 'probe-6s-isolated.png');
      await advanceTo(page, 44);
      await page.waitForFunction(() => window.eventHorizon.getState().probe.state === 'fading'
        && document.querySelector('[data-readout="probeState"]').textContent === 'SIGNAL FADING');
      const late = await difference(page, outDir, 'probe-44s-isolated.png');
      for (const sample of [early, middle, late]) assert.ok(sample.size >= 12, JSON.stringify(sample));
      assert.ok(middle.redBlue > early.redBlue * 1.05, `red/blue at 6/36 s: ${early.redBlue}/${middle.redBlue}`);
      assert.ok(late.redBlue > middle.redBlue * 1.05, `red/blue at 36/44 s: ${middle.redBlue}/${late.redBlue}`);
      await advanceTo(page, 48);
      await page.waitForFunction(() => window.eventHorizon.getState().probe.state === 'lost'
        && document.querySelector('[data-readout="probeState"]').textContent === 'SIGNAL LOST');
      assert.equal(await page.locator('.probe-values').evaluate(el => el.hidden), false, 'lost signal retains its four values');
      const lost = await difference(page, outDir, 'probe-lost.png');
      assert.equal(lost.count, 0, 'lost probe and trail draw nothing');
      const snapshot = (await state(page)).probe;
      await advanceTo(page, 100);
      assert.deepEqual((await state(page)).probe, snapshot, 'all lost readouts remain at cutoff');
      const copy = await page.evaluate(() => {
        const p = window.eventHorizon.getState().probe;
        p.direction[0] = 999;
        return window.eventHorizon.getState().probe.direction[0];
      });
      assert.notEqual(copy, 999, 'telemetry does not expose mutable release direction');
      await page.keyboard.press('KeyR');
      await page.waitForFunction(() => window.eventHorizon.getState().probe === null
        && document.querySelector('[data-readout="probeState"]').textContent === 'PROBE STANDBY'
        && document.querySelector('.probe-values').hidden);
      assert.deepEqual(audit.consoleErrors, []);
    },
  },
  {
    name: 'probe pixel pulses stretch with the received onboard clock',
    path: '/?debug=1',
    viewport: { width: 900, height: 900 },
    async run({ page, outDir }) {
      await prepare(page);
      await advanceTo(page, 0);
      const release = (await state(page)).probe;
      assert.equal(release.properElapsed, 0);
      await advanceTo(page, 0.1);
      const running = (await state(page)).probe;
      assert.ok(running.properElapsed > 0 && running.observerElapsed > 0, 'both clocks run immediately');
      // Inspect the real computed HUD opacity before hiding it for pixel subtraction.
      const light = await page.locator('.probe-light').evaluate(el => Number(getComputedStyle(el).opacity));
      assert.ok(Math.abs(light - (0.25 + 0.75 * running.pulse)) < 0.001, 'HUD light shares the received pulse');
      await page.keyboard.press('KeyH');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#hud')).opacity === '0');
      await page.keyboard.press('KeyP');
      await advanceTo(page, 0);
      await afterRender(page, { layers: { probe: false } });
      // Paused scene, grain and camera stay fixed; reuse this probe-off frame at every sample.
      const off = pixels(await page.screenshot({ scale: 'css' }));
      await afterRender(page, { layers: { probe: true } });
      async function sampleRange(start, end, step) {
        const samples = [];
        const count = Math.round((end - start) / step);
        for (let i = 0; i <= count; i++) {
          const time = start + i * step;
          await advanceTo(page, time);
          const frame = pixels(await page.screenshot({ scale: 'css' }));
          const sample = cluster(frame, off);
          const p = (await state(page)).probe;
          samples.push({ time, brightness: sample.brightness, properElapsed: p.properElapsed, pulse: p.pulse });
        }
        return samples;
      }
      const early = await sampleRange(0, 15, 0.1);
      const later = await sampleRange(30, 45, 0.2);
      const earlyPeaks = pulsePeaks(early), laterPeaks = pulsePeaks(later);
      await writeFile(join(outDir, 'probe-pulse-brightness.json'), JSON.stringify({ early, later, earlyPeaks, laterPeaks }, null, 2));
      assert.ok(earlyPeaks.length >= 6, `first 15 s must show >=6 distinct pixel pulses; found ${earlyPeaks.length}`);
      assert.ok(laterPeaks.length >= 3, `later fall must show >=3 distinct pixel pulses; found ${laterPeaks.length}`);
      const firstInterval = meanInterval(earlyPeaks.slice(0, 4));
      const laterInterval = meanInterval(laterPeaks);
      assert.ok(laterInterval > firstInterval * 1.5, `pixel pulse intervals grow: ${firstInterval} -> ${laterInterval}`);
      for (const peak of [...earlyPeaks, ...laterPeaks]) {
        assert.ok(peak.pulse > 0.1, `pixel peak at ${peak.time} must coincide with a received flash`);
      }
      const paused = (await state(page)).probe;
      await afterRender(page, { paused: true });
      assert.deepEqual((await state(page)).probe, paused, 'paused flashes and trail stay fixed');
    },
  },
  {
    name: 'probe hull stays bounded from hover and up close',
    path: '/?debug=1',
    viewport: { width: 900, height: 900 },
    async run({ page, outDir }) {
      await prepare(page);
      await page.keyboard.press('KeyH');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#hud')).opacity === '0');
      await afterRender(page, { layers: { disk: false, sky: false, ring: false } });
      const probe = (await state(page)).probe;
      const [x, y, z] = probe.direction;
      const theta = Math.atan2(x, z), elevation = Math.asin(y);
      for (const [radius, pitch, name] of [[7.001, 0, 'close'], [1.03, Math.PI, 'hover']]) {
        await afterRender(page, { camera: { radius, theta, elevation, yaw: 0, pitch } });
        const sample = await difference(page, outDir, `probe-${name}.png`);
        assert.ok(sample.size >= 12, `probe remains visible at ${name}: ${JSON.stringify(sample)}`);
        assert.ok(sample.count < 900 * 900 * 0.03, `bounded apparent size at ${name}: ${JSON.stringify(sample)}`);
        assert.ok(sample.width < 140 && sample.height < 140, `bounded cluster extent at ${name}: ${JSON.stringify(sample)}`);
      }
      await afterRender(page, { camera: { radius: 7, theta, elevation, yaw: 0, pitch: 0 } });
      const coincident = await difference(page, outDir, 'probe-coincident.png');
      assert.ok(coincident.count < 900 * 900 * 0.03, 'passing through the craft cannot fill the screen');
    },
  },
];
