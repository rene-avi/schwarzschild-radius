import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pixels, afterRender, settledExposure, quantile } from '../pixels.mjs';
import { criticalCurve, curveRadius, traceRay } from '../../../src/kerrray.js';
import { GEODESIC } from '../../../src/geodesic.js';
import { worldImage, traceWorld, directEventImage } from '../../../src/kerrworlds.js';
import { integrateProbe, historyAt, probeImage } from '../../../src/kerrprobe.js';
import { screenPoint } from '../../../src/worldview.js';
import { geometry, pixelRay, inPolygon, edgeDistance, classifyWorldChanges, traceWorldPixel } from '../../kerr-world-silhouettes.mjs';

const viewport = { width: 900, height: 900 };
const layers = { disk: false, sky: true, ring: false, probe: false, worlds: false };
const camera = { radius: 23, theta: 0, elevation: 0, yaw: 0, pitch: 0 };
const scale = 450 / Math.tan(GEODESIC.halfFov), centre = 449.5;
const json = (outDir, name, data) => writeFile(join(outDir, `kerr-${name}.json`), JSON.stringify(data, null, 2));

async function spin(page, value) {
  await page.locator('#param-spinDelta').evaluate((input, value) => {
    input.value = -Math.log10(1 - value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  const expected = 1 - 10 ** (-Math.round(-Math.log10(1 - value) * 100) / 100);
  await page.waitForFunction(expected => Math.abs(1 - window.eventHorizon.getState().settings.spinDelta - expected) < 1e-10, expected);
}

async function prepare(page, a = 0.9, elevation = 0, disk = false) {
  await page.locator('[data-quality="high"]').click();
  await page.waitForFunction(() => {
    const s = window.eventHorizon.getState();
    return s.qualityMode === 'high' && s.renderScale === 1;
  });
  await spin(page, a);
  if (!await page.evaluate(() => document.body.classList.contains('hud-hidden'))) await page.keyboard.press('KeyH');
  await page.waitForFunction(() => document.body.classList.contains('hud-hidden'));
  await afterRender(page, { camera: { ...camera, elevation }, paused: true, layers: { ...layers, disk, sky: !disk } });
  await settledExposure(page);
}

async function frame(page, outDir, name) {
  return pixels(await page.screenshot({ path: join(outDir, `kerr-${name}.png`), scale: 'css' }));
}

function boundary(image, angle) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let lastDark = null, consecutive = 0;
  // Scan independently of the prediction, then require a sustained sky signal.
  for (let radius = 15; radius < 260; radius += 0.2) {
    const light = image.luma(centre + radius * dx, centre - radius * dy);
    if (light <= 5) { lastDark = radius; consecutive = 0; }
    else if (lastDark !== null && ++consecutive >= 5) return lastDark;
  }
  throw new Error(`No Kerr shadow boundary along ${angle}`);
}

const localDirection = (u, v) => [-1, u, v];
export function diskPoint(r, phi, elevation, a = 0.9) {
  const position = [0, 23 * Math.sin(elevation), 23 * Math.cos(elevation)];
  const target = [Math.sqrt(r * r + a * a / 4) * Math.cos(phi), Math.sqrt(r * r + a * a / 4) * Math.sin(phi)];
  const d = [target[1], -position[1], target[0] - position[2]];
  const radial = d[1] * Math.sin(elevation) + d[2] * Math.cos(elevation);
  let u = (-d[1] * Math.cos(elevation) + d[2] * Math.sin(elevation)) / -radial;
  let v = d[0] / -radial;
  const hit = (u, v) => {
    const result = traceRay({ position, direction: localDirection(u, v), spin: a, stepScale: 0.5 });
    const h = result.diskHits[0];
    assert.ok(h, `No direct disk hit for r=${r}, phi=${phi}`);
    const rho = Math.sqrt(h.r * h.r + a * a / 4);
    return [rho * Math.cos(h.phi), rho * Math.sin(h.phi)];
  };
  let residual = Infinity;
  for (let i = 0; i < 8; i++) {
    const p = hit(u, v), eu = hit(u + 1e-4, v), ev = hit(u, v + 1e-4);
    const x = p[0] - target[0], y = p[1] - target[1];
    residual = Math.hypot(x, y);
    if (residual < 3e-5) break;
    const j00 = (eu[0] - p[0]) / 1e-4, j10 = (eu[1] - p[1]) / 1e-4;
    const j01 = (ev[0] - p[0]) / 1e-4, j11 = (ev[1] - p[1]) / 1e-4;
    const det = j00 * j11 - j01 * j10;
    assert.ok(Math.abs(det) > 1e-8, 'Disk projection is regular');
    u -= (j11 * x - j01 * y) / det;
    v -= (-j10 * x + j00 * y) / det;
  }
  assert.ok(residual < 0.002, `Disk shoot residual ${residual}`);
  return { x: centre + scale * v, y: centre + scale * u };
}

function sample(image, p) {
  let sum = 0;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const light = image.luma(p.x + dx, p.y + dy);
    assert.notEqual(light, null, 'Projected disk sample lies in frame');
    sum += light;
  }
  return sum / 9;
}
function highpass(values) {
  return values.map((v, i) => v - [-8, -4, 0, 4, 8].reduce((s, j) => s + values[(i + j + values.length) % values.length], 0) / 5);
}
function correlation(a, b) {
  const aa = highpass(a), bb = highpass(b);
  const dot = aa.reduce((s, v, i) => s + v * bb[i], 0);
  return dot / Math.sqrt(aa.reduce((s, v) => s + v * v, 0) * bb.reduce((s, v) => s + v * v, 0));
}
async function time(page, seconds) {
  const before = await page.evaluate(seconds => {
    const before = window.eventHorizon.getState().renderedFrames;
    window.eventHorizon.debug.setSimulationTime(seconds);
    return before;
  }, seconds);
  await page.waitForFunction(({ before, seconds }) => {
    const s = window.eventHorizon.getState();
    return s.simulationTime === seconds && s.renderedFrames > before + 1;
  }, { before, seconds });
  await settledExposure(page);
}

function differencePixels(on, off, bounds) {
  const result = [];
  for (let y = Math.max(0, Math.floor(bounds.minY)); y <= Math.min(899, Math.ceil(bounds.maxY)); y++) {
    for (let x = Math.max(0, Math.floor(bounds.minX)); x <= Math.min(899, Math.ceil(bounds.maxX)); x++) {
      if (Math.max(...on.rgb(x, y).map((v, i) => Math.abs(v - off.rgb(x, y)[i]))) > 2) result.push({ x, y });
    }
  }
  return result;
}
async function deep(page) {
  await page.locator('[data-preset="deep"]').click();
  await page.waitForFunction(() => window.eventHorizon.getState().settings.spinDelta === 1.3e-14);
  await page.locator('[data-quality="high"]').click();
  await page.waitForFunction(() => window.eventHorizon.getState().qualityMode === 'high' && window.eventHorizon.getState().renderScale === 1);
  await afterRender(page, { paused: true, camera: { ...camera, elevation: .23 }, layers: { ...layers, disk: true, sky: true } });
}
async function hide(page) {
  if (!await page.evaluate(() => document.body.classList.contains('hud-hidden'))) await page.keyboard.press('KeyH');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#hud')).opacity === '0');
}
async function advanceProbe(page, dt) {
  const before = await page.evaluate(dt => {
    const before = window.eventHorizon.getState().renderedFrames;
    window.eventHorizon.debug.advanceProbe(dt);
    return before;
  }, dt);
  await page.waitForFunction(before => window.eventHorizon.getState().renderedFrames > before + 1, before);
}

export const checks = [
  {
    name: 'kerr software-compatible startup smoke', path: '/?metric=kerr', viewport: { width: 320, height: 240 },
    async run({ page, outDir, audit }) {
      await page.waitForFunction(() => {
        const s = window.eventHorizon?.getState();
        return s?.metric === 'kerr' && s.renderedFrames >= 1 && Number.isFinite(s.exposure);
      }, null, { timeout: 120000 });
      assert.deepEqual(audit.consoleErrors, []);
      await json(outDir, 'smoke', await page.evaluate(() => window.eventHorizon.getState()));
    },
  },
  {
    name: 'kerr absent flag preserves default labels and metric', gpu: true, viewport,
    async run({ page, outDir }) {
      assert.equal(await page.evaluate(() => window.eventHorizon.getState().metric), 'schwarzschild');
      assert.equal(await page.locator('.top-center').textContent().then(t => t.includes('SCHWARZSCHILD METRIC')), true);
      assert.equal(await page.locator('.top-center').textContent().then(t => t.includes('KERR METRIC')), false);
      assert.equal(await page.locator('.object-coordinates').textContent().then(t => t.includes('KERR GEOMETRY')), false);
      assert.equal(await page.locator('.kerr-mode').count(), 0);
      await json(outDir, 'default', { metric: 'schwarzschild' });
    },
  },
  {
    name: 'kerr finite ZAMO shadow and mirrored spin guard', gpu: true, path: '/?metric=kerr&debug=1', viewport,
    async run({ page, outDir }) {
      await prepare(page);
      const state = await page.evaluate(() => window.eventHorizon.getState());
      assert.equal(state.settings.spinDelta, 0.1);
      const image = await frame(page, outDir, 'shadow-a09'), curve = criticalCurve([0, 0, 23], 0.9, 100000), rows = [];
      for (let i = 0; i < 16; i++) {
        const angle = i * Math.PI / 8, expected = curveRadius(curve, angle) * scale, measured = boundary(image, angle);
        rows.push({ angle, expected, measured, error: measured - expected });
      }
      const left = rows[8].measured, right = rows[0].measured;
      await json(outDir, 'shadow-a09', { rows, left, right, ratio: left / right, ratioTolerance: [0.37, 0.46] });
      for (const row of rows) assert.ok(Math.abs(row.error) <= 2 + 0.015 * row.expected, JSON.stringify(row));
      assert.ok(left < right && left / right > 0.37 && left / right < 0.46, `flattened approaching edge: ${left}/${right}`);
      assert.ok(Math.abs(left - 71.01) <= 4 && Math.abs(right - 172.06) <= 5, 'edge distances within pixel + 1.5% allowance');
    },
  },
  {
    name: 'kerr zero spin strong sky matches default pixels', gpu: true, path: '/?metric=kerr&debug=1', viewport,
    async run({ page, url, outDir }) {
      await prepare(page, 0);
      const kerr = await frame(page, outDir, 'zero-sky');
      await page.goto(`${url}/?debug=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.eventHorizon?.getState().clock > 0);
      await prepare(page, 0);
      const standard = await frame(page, outDir, 'zero-default-sky');
      const errors = [], edge = Math.tan(Math.asin(GEODESIC.criticalImpact / 23 * Math.sqrt(1 - 1 / 23))) * scale;
      for (let y = 0; y < 900; y++) for (let x = 0; x < 900; x++) {
        const radius = Math.hypot(x - centre, y - centre), screen = radius / scale;
        const b = 23 * screen / Math.sqrt(1 + screen * screen) / Math.sqrt(1 - 1 / 23);
        if (b >= GEODESIC.weakStart || Math.abs(radius - edge) <= 3) continue;
        errors.push(Math.max(...kerr.rgb(x, y).map((v, i) => Math.abs(v - standard.rgb(x, y)[i]))));
      }
      const matched = errors.filter(v => v <= 2).length / errors.length;
      await json(outDir, 'zero-sky-comparison', { pixels: errors.length, matched, p99: quantile(errors, 0.99), edge,
        exclusion: 'b >= 10 r_s or within 3 px of the default shadow edge', maxLevels: 2 });
      assert.ok(matched >= 0.99, `${matched * 100}% within two levels`);
    },
  },
  {
    name: 'kerr approaching disk is brighter and gas drifts prograde', gpu: true, path: '/?metric=kerr&debug=1', viewport,
    async run({ page, outDir }) {
      await prepare(page, 0.9, 0.35, true);
      await time(page, 3);
      const inclined = await frame(page, outDir, 'disk-brightness');
      const left = [], right = [];
      for (const r of [2.5, 3.5, 4.5]) for (const offset of [-0.3, 0, 0.3]) {
        left.push(sample(inclined, diskPoint(r, -Math.PI / 2 + offset, 0.35)));
        right.push(sample(inclined, diskPoint(r, Math.PI / 2 + offset, 0.35)));
      }
      const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
      await json(outDir, 'disk-brightness', { left, right, approachingMean: mean(left), recedingMean: mean(right) });
      assert.ok(mean(left) > mean(right) * 1.1, `approaching/receding ${mean(left)}/${mean(right)}`);
      await afterRender(page, { camera: { ...camera, elevation: 1.3 } });
      await time(page, 3);
      const before = await frame(page, outDir, 'gas-t3');
      await time(page, 3.8);
      const after = await frame(page, outDir, 'gas-t38');
      const motion = [];
      for (const r of [2.5, 3.5, 4.5]) {
        const omega = Math.sqrt(0.5) / (r ** 1.5 + 0.45 * Math.sqrt(0.5)), delta = omega * 0.8;
        const first = [], forward = [], backward = [];
        for (let i = 0; i < 96; i++) {
          const phi = i * 2 * Math.PI / 96;
          first.push(sample(before, diskPoint(r, phi, 1.3)));
          forward.push(sample(after, diskPoint(r, phi + delta, 1.3)));
          backward.push(sample(after, diskPoint(r, phi - delta, 1.3)));
        }
        motion.push({ r, delta, forward: correlation(first, forward), backward: correlation(first, backward) });
      }
      await json(outDir, 'disk-motion', { approachingMean: mean(left), recedingMean: mean(right), motion,
        convention: 'positive KS phi; correlate t=3 samples with phi +/- Omega*0.8 at t=3.8' });
      assert.ok(mean(motion.map(v => v.forward - v.backward)) > 0.015, JSON.stringify(motion));
    },
  },
  {
    name: 'kerr scoped controls finite exposure and all quality frames', gpu: true, path: '/?metric=kerr&debug=1', viewport,
    async run({ page, outDir, audit }) {
      await page.waitForFunction(() => document.querySelector('.top-center').textContent.includes('KERR METRIC'));
      for (const action of ['fly', 'cinematic']) {
        assert.equal(await page.locator(`[data-action="${action}"]`).isDisabled(), true);
        assert.match(await page.locator(`[data-action="${action}"]`).getAttribute('title'), /Schwarzschild/);
      }
      for (const parameter of ['tilt', 'lensing']) {
        assert.equal(await page.locator(`#param-${parameter}`).isDisabled(), true);
        assert.match(await page.locator(`#param-${parameter}`).getAttribute('title'), /Stored value retained/);
      }
      await page.locator('[data-preset="sagittarius"]').click();
      await page.waitForFunction(() => window.eventHorizon.getState().settings.lensing === 1.15);
      await afterRender(page, { camera: { ...camera, radius: 1.1 }, paused: false });
      const clockStart = await page.evaluate(() => window.eventHorizon.getState());
      const r = 1.1, a = (1 - clockStart.settings.spinDelta) / 2;
      const Delta = r * r - r + a * a;
      const alpha = Math.sqrt(Delta * r * r / ((r * r + a * a) ** 2 - a * a * Delta));
      assert.ok(Math.abs(clockStart.camera.dilation - alpha) < 1e-12, 'Sagittarius camera uses ZAMO lapse');
      await page.waitForFunction(({ clock, label }) => {
        const s = window.eventHorizon.getState();
        return s.clock > clock && document.querySelector('[data-readout="dilation"]').textContent === label;
      }, { clock: clockStart.clock, label: `τ / t ${alpha.toFixed(3)}` });
      await page.locator('[data-preset="deep"]').click();
      await page.waitForFunction(() => document.querySelector('[data-control-output="spinDelta"]').value === 'picture 0.998');
      await page.locator('[data-action="mission"]').click();
      await page.waitForFunction(() => {
        const s = window.eventHorizon.getState();
        return s.mission.open && s.worlds.length === 2 && s.worlds.every(v => v.drawn);
      });
      await page.keyboard.press('KeyF'); await page.keyboard.press('KeyC');
      assert.equal(await page.locator('[data-action="probe"]').isDisabled(), false);
      await afterRender(page, { camera: { radius: 0.6 } });
      assert.equal(await page.evaluate(() => window.eventHorizon.getState().camera.radius), 1.1);
      assert.equal(await page.evaluate(() => window.eventHorizon.getState().camera.mode), 'orbit');
      assert.equal(await page.evaluate(() => window.eventHorizon.getState().probe), null);
      await afterRender(page, { camera });
      await page.locator('[data-action="mission"]').click();
      const rows = [];
      await page.evaluate(() => window.eventHorizon.debug.setQualityPinned(true));
      try {
        for (const [qualityMode, renderScale] of [['auto', 1], ['high', 1], ['balanced', 0.76], ['performance', 0.52]]) {
          const before = await page.evaluate(() => window.eventHorizon.getState().renderedFrames);
          await page.locator(`[data-quality="${qualityMode}"]`).click();
          await page.waitForFunction(({ qualityMode, renderScale, before }) => {
            const s = window.eventHorizon.getState();
            return s.qualityMode === qualityMode && s.renderScale === renderScale && s.renderedFrames > before + 1 && Number.isFinite(s.exposure);
          }, { qualityMode, renderScale, before });
          await settledExposure(page);
          await frame(page, outDir, `quality-${qualityMode}`);
          const state = await page.evaluate(() => window.eventHorizon.getState());
          assert.equal(state.qualityMode, qualityMode);
          assert.equal(state.renderScale, renderScale);
          rows.push(state);
        }
      } finally {
        await page.evaluate(() => window.eventHorizon.debug.setQualityPinned(false));
      }
      assert.deepEqual(audit.consoleErrors, []);
      await json(outDir, 'quality', rows);
    },
  },
  {
    name: 'kerr Deep mission worlds match moving-ray silhouettes and preserve exposure', gpu: true, path: '/?metric=kerr&debug=1', viewport,
    async run({ page, outDir, audit }) {
      await deep(page);
      await page.keyboard.press('KeyM');
      await page.waitForFunction(() => window.eventHorizon.getState().mission.open);
      const phases = { lantern: -.22507512341471048, farShore: 1.84 };
      const before = await page.evaluate(phases => {
        const before = window.eventHorizon.getState().renderedFrames;
        window.eventHorizon.debug.setWorldPhases(phases);
        return before;
      }, phases);
      await page.waitForFunction(before => {
        const s = window.eventHorizon.getState();
        return s.renderedFrames > before + 1 && s.worlds.every(w => w.phase === (w.id === 'lantern' ? -.22507512341471048 : 1.84));
      }, before);
      await hide(page);
      await afterRender(page, { layers: { worlds: false } }); await settledExposure(page);
      const off = await frame(page, outDir, 'worlds-off'), offExposure = await page.evaluate(() => window.eventHorizon.getState().exposure);
      await afterRender(page, { layers: { worlds: true } }); await settledExposure(page);
      const on = await frame(page, outDir, 'worlds-on'), state = await page.evaluate(() => window.eventHorizon.getState());
      assert.deepEqual(state.worlds.map(w => w.id).sort(), ['farShore', 'lantern']);
      assert.ok(state.worlds.every(w => w.drawn));
      assert.ok(Math.abs(state.exposure / offExposure - 1) <= .01);
      const basis = geometry(), rows = [];
      for (const world of state.worlds) {
        const options = { position: basis.position, spin: .998, radius: world.orbitRadius, phase: world.phase, stepScale: .1 };
        const image = worldImage(options), point = screenPoint(image.sceneDirection, basis, 900, 900), polygon = [];
        assert.ok(point && point.x > 20 && point.x < 880 && point.y > 20 && point.y < 880);
        for (let j = 0; j < 32; j++) {
          const angle = j * Math.PI / 16, dx = Math.cos(angle), dy = Math.sin(angle);
          let lo = 0, hi = 24;
          for (let k = 0; k < 15; k++) {
            const r = (lo + hi) / 2;
            const hit = traceWorld({ ...options, bodyRadius: world.radius,
              direction: pixelRay(point.x + r * dx, point.y + r * dy, basis) }).fate === 'hit';
            if (hit) lo = r; else hi = r;
          }
          polygon.push({ x: point.x + (lo + hi) / 2 * dx, y: point.y + (lo + hi) / 2 * dy });
        }
        const bounds = { minX: Math.min(...polygon.map(p => p.x)) - 4, maxX: Math.max(...polygon.map(p => p.x)) + 4,
          minY: Math.min(...polygon.map(p => p.y)) - 4, maxY: Math.max(...polygon.map(p => p.y)) + 4 };
        const changed = differencePixels(on, off, bounds), marked = new Set(changed.map(p => p.y * 900 + p.x));
        assert.ok(changed.length > 5, `${world.id} has a silhouette`);
        const edge = changed.filter(p => [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => !marked.has((p.y+dy)*900+p.x+dx)));
        const errors = edge.map(p => edgeDistance(p.x,p.y,polygon));
        assert.ok(errors.every(e => e <= 3), `${world.id} limb error ${Math.max(...errors)} px`);
        for (const p of polygon) assert.ok(edge.some(q => Math.hypot(q.x-p.x,q.y-p.y)<=3), `${world.id} missing limb`);
        const interior = changed.filter(p => inPolygon(p.x,p.y,polygon));
        assert.ok(interior.length > 3);
        rows.push({ id: world.id, point, polygon, changed: changed.length, maximumLimbError: Math.max(...errors) });
      }
      const allChanged = differencePixels(on, off, { minX: 0, maxX: 899, minY: 0, maxY: 899 });
      const classification = classifyWorldChanges(allChanged, rows,
        p => traceWorldPixel(p, { basis, spin: .998, worlds: state.worlds }));
      // Save even failed classifications so the host can inspect unexplained pixels.
      await json(outDir, 'world-silhouettes', { rows, classification, offExposure, onExposure: state.exposure });
      assert.equal(classification.unexplained.length, 0,
        `No unexplained silhouette outside the drawn worlds: ${JSON.stringify(classification.unexplained)}`);
      assert.deepEqual(audit.consoleErrors, []);
    },
  },
  {
    name: 'kerr probe follows retarded geodesic reddens stretches pulses and is lost', gpu: true, path: '/?metric=kerr&debug=1', viewport,
    async run({ page, outDir, audit }) {
      await deep(page);
      await afterRender(page, { layers: { disk: false, sky: false, probe: true, worlds: false } });
      await page.locator('[data-action="probe"]').click();
      await page.waitForFunction(() => window.eventHorizon.getState().probe?.metric === 'kerr', null, { timeout: 120000 });
      await hide(page);
      const basis = geometry(), c = Math.cos(25*Math.PI/180), s = Math.sin(25*Math.PI/180);
      const direction = basis.radial.map((v,i) => v*c+basis.right[i]*s);
      const history = integrateProbe({ direction, spin: .998 }), rows = [];
      let elapsed = 0;
      for (const target of [0, 20, 36]) {
        await advanceProbe(page, target-elapsed); elapsed = target;
        await settledExposure(page);
        const state = await page.evaluate(() => window.eventHorizon.getState()), now = state.probe.arrivalDelay + state.probe.elapsed;
        const image = directEventImage({ position: basis.position, spin: .998,
          eventAt: t => historyAt(history, Math.max(0, Math.min(history.at(-1).t, now+t))) });
        const point = screenPoint(image.sceneDirection,basis,900,900);
        assert.ok(point);
        const on = await frame(page,outDir,`probe-t${target}`);
        await afterRender(page,{layers:{probe:false}}); const off = await frame(page,outDir,`probe-off-t${target}`);
        await afterRender(page,{layers:{probe:true}});
        const bounds = {minX:point.x-15,maxX:point.x+15,minY:point.y-15,maxY:point.y+15};
        const changed = differencePixels(on,off,bounds); assert.ok(changed.length>0,`probe hull visible at ${target}`);
        const centreX=(Math.min(...changed.map(p=>p.x))+Math.max(...changed.map(p=>p.x)))/2;
        const centreY=(Math.min(...changed.map(p=>p.y))+Math.max(...changed.map(p=>p.y)))/2;
        assert.ok(Math.hypot(centreX-point.x,centreY-point.y)<=3,`probe image at ${target}: ${centreX},${centreY} vs ${JSON.stringify(point)}`);
        const rgb=changed.reduce((sum,p)=>sum.map((v,i)=>v+on.rgb(p.x,p.y)[i]),[0,0,0]).map(v=>v/changed.length);
        rows.push({ target,point,centreX,centreY,rgb,signal:state.probe.signal });
      }
      assert.ok(rows[2].rgb[2]/rows[2].rgb[0] < rows[0].rgb[2]/rows[0].rgb[0]);
      const state=await page.evaluate(()=>window.eventHorizon.getState()), flashes=state.probe.flashEvents;
      const gaps=flashes.slice(1).map((e,i)=>e.receptionTime-flashes[i].receptionTime);
      assert.ok(gaps.at(-1)>2*gaps[0]);
      // Trace the onboard emission events independently of the browser reception table.
      const release = probeImage(basis.position,.998,history[0]);
      let seed = release.direction;
      const independentFlashes = [];
      for (const tau of [27,28]) {
        let low=0, high=history.length-1;
        while(high-low>1){const mid=(low+high)>>1;if(history[mid].tau<=tau)low=mid;else high=mid;}
        const a=history[low],b=history[high],t=a.t+(tau-a.tau)/(b.tau-a.tau)*(b.t-a.t);
        const event=historyAt(history,t),image=probeImage(basis.position,.998,event,seed);
        seed=image.direction;
        const target=t+image.delay-release.delay;
        independentFlashes.push({tau,receptionTime:target});
        assert.ok(Math.abs(target-flashes[tau-1].receptionTime)<1e-6);
        await advanceProbe(page,target-elapsed+1e-4);elapsed=target+1e-4;
        await page.waitForFunction(n=>window.eventHorizon.getState().probe.flashCount===n,tau);
        const p=await page.evaluate(()=>window.eventHorizon.getState().probe);
        assert.ok(p.pulse>.95,`onboard flash at received time ${target}`);
        await frame(page,outDir,`probe-flash-${tau}`);
      }
      let fading = await page.evaluate(() => window.eventHorizon.getState().probe);
      while (fading.state === 'falling' && elapsed < fading.lostTime) {
        const step = Math.min(.25, fading.lostTime - elapsed);
        await advanceProbe(page, step); elapsed += step;
        fading = await page.evaluate(() => window.eventHorizon.getState().probe);
      }
      await page.waitForFunction(() => window.eventHorizon.getState().probe.state === 'fading'
        && document.querySelector('[data-readout="probeState"]').textContent === 'SIGNAL FADING');
      assert.equal(fading.state, 'fading');
      assert.ok(fading.elapsed < fading.lostTime, 'fading precedes loss');
      await frame(page, outDir, 'probe-fading');
      await advanceProbe(page,state.probe.lostTime-elapsed+1);
      await page.waitForFunction(()=>window.eventHorizon.getState().probe.state==='lost'
        && document.querySelector('[data-readout="probeState"]').textContent==='SIGNAL LOST');
      const lostProbe = await page.evaluate(() => window.eventHorizon.getState().probe);
      const lost=await frame(page,outDir,'probe-lost');
      await afterRender(page,{layers:{probe:false}});const off=await frame(page,outDir,'probe-lost-off');
      assert.equal(differencePixels(lost,off,{minX:0,maxX:899,minY:0,maxY:899}).length,0);
      await afterRender(page, { camera: { ...camera, radius: 3, elevation: .23 } });
      await page.keyboard.press('KeyH');
      await page.waitForFunction(() => !document.body.classList.contains('hud-hidden'));
      await page.keyboard.press('KeyP');
      await page.waitForFunction(() => {
        const probe = window.eventHorizon.getState().probe;
        return probe?.state === 'falling' && probe.elapsed === 0 && probe.signal > 1
          && Number(document.querySelector('[data-readout="probeSignal"]').textContent) > 1;
      }, null, { timeout: 120000 });
      const closeProbe = await page.evaluate(() => window.eventHorizon.getState().probe);
      assert.ok(closeProbe.signal > 1, 'the actual inner receiver sees a release blueshift');
      const closeBasis = geometry(.23), closePosition = closeBasis.radial.map(v => 3 * v);
      const closeImage = probeImage(closePosition, .998, history[0]);
      // At release the source is behind the inward-looking camera; turn the view after the drop.
      const yaw = Math.asin(dot(closeImage.sceneDirection, closeBasis.right));
      const pitch = Math.atan2(dot(closeImage.sceneDirection, closeBasis.up), -dot(closeImage.sceneDirection, closeBasis.radial));
      await afterRender(page, { camera: { ...camera, radius: 3, elevation: .23, yaw, pitch }, layers: { probe: true } });
      await hide(page);
      await settledExposure(page);
      const closeOn = await frame(page, outDir, 'probe-close-blueshift');
      await afterRender(page, { layers: { probe: false } });
      const closeOff = await frame(page, outDir, 'probe-close-off');
      const closePixels = differencePixels(closeOn, closeOff, { minX: centre - 20, maxX: centre + 20, minY: centre - 20, maxY: centre + 20 });
      assert.ok(closePixels.length > 0, 'the close-camera probe hull is visible');
      await afterRender(page, { layers: { probe: true } });
      assert.deepEqual(audit.consoleErrors,[]);
      await json(outDir,'probe-history',{rows,gaps,flashes,independentFlashes,fading,closeProbe,closePixels:closePixels.length,
        lost:lostProbe});
    },
  },
];
