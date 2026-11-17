import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { GEODESIC } from '../../../src/geodesic.js';
import { PRESETS } from '../../../src/physics.js';
import { START_PHASES, drawnWorlds, worldPosition, directImage, screenPoint } from '../../../src/worldview.js';
import { pixels, afterRender, settledExposure } from '../pixels.mjs';
import { traceRay } from '../../../src/geodesic.js';

const viewport = { width: 1440, height: 900 };
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const norm = a => Math.hypot(...a);
const unit = a => a.map(v => v / norm(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const state = page => page.evaluate(() => window.eventHorizon.getState());

function cameraGeometry(camera) {
  const { radius, theta, elevation, gazeYaw: yaw, gazePitch: pitch } = camera;
  const radial = [Math.sin(theta) * Math.cos(elevation), Math.sin(elevation), Math.cos(theta) * Math.cos(elevation)];
  const right = [Math.cos(theta), 0, -Math.sin(theta)], forward = radial.map(v => -v), up = cross(right, forward);
  const pitched = forward.map((v, i) => v * Math.cos(pitch) + up[i] * Math.sin(pitch));
  return { position: radial.map(v => v * radius), radial,
    forward: pitched.map((v, i) => v * Math.cos(yaw) + right[i] * Math.sin(yaw)),
    right: right.map((v, i) => v * Math.cos(yaw) - pitched[i] * Math.sin(yaw)),
    up: up.map((v, i) => v * Math.cos(pitch) + radial[i] * Math.sin(pitch)) };
}

function impact(direction, position) {
  const r = norm(position), mu = dot(direction, unit(position));
  return r * Math.sqrt(Math.max(0, 1 - mu * mu)) / Math.sqrt(1 - 1 / r);
}

export function prediction(world, camera, size = viewport) {
  const basis = cameraGeometry(camera), direction = directImage(basis.position, world.center);
  const point = screenPoint(direction, basis, size.width, size.height);
  assert.ok(point, `direct image exists for ${world.id}`);
  // Coordinate-normal limbs project the Euclidean sphere used by the shader.
  const reverse = directImage(world.center, basis.position), radial = unit(world.center);
  const along = dot(reverse, radial), lapse = Math.sqrt(1 - 1 / norm(world.center));
  const sourceRay = unit(reverse.map((v, i) => along * radial[i] + (v - along * radial[i]) / lapse));
  const a = unit(cross(sourceRay, Math.abs(sourceRay[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const b = cross(sourceRay, a);
  const limbDirections = [], polygon = Array.from({ length: 48 }, (_, i) => {
    const angle = 2 * Math.PI * i / 48;
    const limb = world.center.map((v, axis) => v + world.radius * (Math.cos(angle) * a[axis] + Math.sin(angle) * b[axis]));
    const ray = directImage(basis.position, limb);
    limbDirections.push(ray);
    const projected = screenPoint(ray, basis, size.width, size.height);
    assert.ok(projected, `visible limb point ${i} for ${world.id}`);
    return projected;
  });
  const area = Math.abs(polygon.reduce((sum, p, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return sum + p.x * next.y - p.y * next.x;
  }, 0)) / 2;
  return { id: world.id, ...point, polygon, bounds: bounds(polygon), radius: Math.sqrt(area / Math.PI), area, impact: impact(direction, basis.position),
    limbImpacts: limbDirections.map(d => impact(d, basis.position)) };
}

function bounds(points) {
  return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
}

export function inPolygon(x, y, polygon, dilation = 0) {
  let inside = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if ((a.y > y) !== (b.y > y) && x < a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / Math.max(dx * dx + dy * dy, 1e-20)));
    if (Math.hypot(x - a.x - t * dx, y - a.y - t * dy) <= dilation) return true;
  }
  return inside;
}

async function renderedMutation(page, callback, value) {
  const frame = (await state(page)).renderedFrames;
  await page.evaluate(callback, value);
  await page.waitForFunction(frame => window.eventHorizon.getState().renderedFrames > frame + 1, frame);
}

async function mission(page, open) {
  if ((await state(page)).mission.open !== open) await page.keyboard.press('KeyM');
  await page.waitForFunction(open => window.eventHorizon.getState().mission.open === open, open);
  await page.waitForFunction(open => getComputedStyle(document.querySelector('.mission-panel')).opacity === (open ? '1' : '0'), open);
  await afterRender(page, {});
}

async function prepare(page, hideHud = true) {
  await page.locator('[data-preset="deep"]').click();
  await page.waitForFunction(delta => window.eventHorizon.getState().settings.spinDelta === delta
    && document.querySelector('[data-preset="deep"]').getAttribute('aria-pressed') === 'true', PRESETS.deep.spinDelta);
  await page.locator('[data-quality="high"]').click();
  await page.waitForFunction(() => window.eventHorizon.getState().qualityMode === 'high'
    && window.eventHorizon.getState().renderScale === 1);
  await afterRender(page, { paused: true, camera: { radius: 23, theta: 0.05, elevation: 0.23, yaw: 0, pitch: 0 },
    layers: { disk: true, sky: true, ring: true, probe: false, worlds: false } });
  await renderedMutation(page, phases => {
    window.eventHorizon.debug.setSimulationTime(0);
    window.eventHorizon.debug.setWorldPhases(phases);
  }, START_PHASES);
  await mission(page, true);
  if (hideHud) {
    await page.keyboard.press('KeyH');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#hud')).opacity === '0');
  }
}

async function capture(page, outDir, name) {
  return pixels(await page.screenshot({ path: join(outDir, `${name}.png`), scale: 'css' }));
}

function difference(on, off, threshold = 1) {
  assert.equal(on.width, off.width); assert.equal(on.height, off.height);
  const marked = new Set();
  let maximum = 0;
  for (let y = 0; y < on.height; y++) for (let x = 0; x < on.width; x++) {
    const a = on.rgb(x, y), b = off.rgb(x, y);
    const value = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    maximum = Math.max(maximum, value);
    if (value > threshold) marked.add(y * on.width + x);
  }
  return { marked, maximum };
}

function components(marked, width, height) {
  const remaining = new Set(marked), result = [];
  while (remaining.size) {
    const indices = [remaining.values().next().value];
    remaining.delete(indices[0]);
    let sx = 0, sy = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < indices.length; i++) {
      const x = indices[i] % width, y = Math.floor(indices[i] / width);
      sx += x; sy += y;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const next = ny * width + nx;
        if (remaining.delete(next)) indices.push(next);
      }
    }
    result.push({ x: sx / indices.length, y: sy / indices.length, area: indices.length,
      bounds: { minX, minY, maxX, maxY }, indices });
  }
  return result;
}

function coneField(camera, worlds, width, height, lensing) {
  const basis = cameraGeometry(camera), lapse = Math.sqrt(1 - lensing / camera.radius);
  const spheres = worlds.filter(w => w.drawn).map(w => {
    const relative = w.center.map((v, i) => v - basis.position[i]), distance = norm(relative);
    return { relative, distance, radius: w.radius };
  }).filter(w => w.distance > w.radius).map(w => ({ ...w,
    direction: unit(w.relative), angularRadius: Math.asin(w.radius / w.distance) }));
  return (x, y) => {
    const sx = (2 * (x + 0.5) / width - 1 + (width > 1000 ? 0.13 : 0)) * width / height;
    const sy = 1 - 2 * (y + 0.5) / height;
    const ray = unit(basis.forward.map((v, i) => v + Math.tan(GEODESIC.halfFov) * (sx * basis.right[i] + sy * basis.up[i])));
    const mu = Math.max(-1, Math.min(1, -dot(ray, basis.radial)));
    const transverse = ray.map((v, i) => v + basis.radial[i] * mu), b = camera.radius * norm(transverse) / lapse;
    const margin = Math.max(...spheres.map(w => dot(ray, w.direction)
      - Math.cos(Math.min(Math.PI, w.angularRadius + 2.5 / b + 0.02))));
    return { margin, impact: b, integrated: b >= GEODESIC.weakEnd && margin >= 0 };
  };
}

function coneBoundaryDistance(field, x, y, weakEnd = false) {
  let distance = Infinity;
  const step = 0.5;
  // Interpolate the zero contour locally; the search extends beyond the 2 px band.
  for (let dy = -3; dy < 3; dy += step) for (let dx = -3; dx < 3; dx += step) {
    const corners = [[x + dx, y + dy], [x + dx + step, y + dy],
      [x + dx + step, y + dy + step], [x + dx, y + dy + step]].map(([x, y]) => {
      const value = field(x, y);
      return { x, y, margin: weakEnd ? value.impact - GEODESIC.weakEnd : value.margin };
    });
    const crossings = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      if ((a.margin >= 0) === (b.margin >= 0)) continue;
      const t = a.margin / (a.margin - b.margin);
      const p = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      if (weakEnd || field(p.x, p.y).impact >= GEODESIC.weakEnd) crossings.push(p);
    }
    if (crossings.length !== 2) continue;
    const [a, b] = crossings, vx = b.x - a.x, vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy)));
    distance = Math.min(distance, Math.hypot(x - a.x - t * vx, y - a.y - t * vy));
  }
  return Number.isFinite(distance) ? distance : null;
}

export function locality(on, off, predictions, hole, secondaryRadius, skyGeometry) {
  const changed = difference(on, off).marked, outside = new Set();
  for (const index of changed) {
    const x = index % on.width, y = Math.floor(index / on.width);
    if (Math.hypot(x - hole.x, y - hole.y) <= secondaryRadius) continue;
    if (!predictions.some(p => inPolygon(x, y, p.polygon, 3))) outside.add(index);
  }
  const measured = { predictions, hole, secondaryRadius, dilation: 3, changed: changed.size, outside: outside.size,
    outsideClusters: components(outside, on.width, on.height).map(({ indices, ...region }) => region) };
  if (skyGeometry) {
    const { camera, worlds, lensing } = skyGeometry, field = coneField(camera, worlds, on.width, on.height, lensing);
    measured.skyGeometry = skyGeometry;
    measured.starBrightnessLuma = 40;
    measured.coneBoundaryBandPx = 2;
    measured.coneContourStepPx = 0.5;
    measured.outsidePixels = [...outside].map(index => {
      const x = index % on.width, y = Math.floor(index / on.width), b = off.rgb(x, y), c = on.rgb(x, y);
      const channelDifference = c.map((v, i) => v - b[i]);
      const distance = coneBoundaryDistance(field, x, y);
      const weakDistance = coneBoundaryDistance(field, x, y, true);
      return { x, y, b, c, channelDifference, maximumDifference: Math.max(...channelDifference.map(Math.abs)),
        bLuma: off.luma(x, y), starPixel: off.luma(x, y) >= measured.starBrightnessLuma,
        ...field(x, y), coneBoundaryDistancePx: distance, within2PxOfConeBoundary: distance !== null && distance <= 2,
        weakEndBoundaryDistancePx: weakDistance, within2PxOfWeakEndBoundary: weakDistance !== null && weakDistance <= 2 };
    });
    measured.outsideSummary = {
      nearConeBoundary: measured.outsidePixels.filter(p => p.within2PxOfConeBoundary).length,
      nearWeakEndBoundary: measured.outsidePixels.filter(p => p.within2PxOfWeakEndBoundary).length,
      awayFromBothBoundaries: measured.outsidePixels.filter(p => !p.within2PxOfConeBoundary && !p.within2PxOfWeakEndBoundary).length,
      starPixels: measured.outsidePixels.filter(p => p.starPixel).length,
      maximumChannelDifference: Math.max(0, ...measured.outsidePixels.map(p => p.maximumDifference)),
    };
  }
  return measured;
}

export function colourMetrics(image, indices) {
  assert.ok(indices.length, 'nonempty colour region');
  const samples = indices.map(index => ({ y: Math.floor(index / image.width), rgb: image.rgb(index % image.width, Math.floor(index / image.width)) }));
  const colours = new Map(samples.map(p => [p.rgb.join(','), p.rgb]));
  let flatColour, flatPixels = 0;
  for (const colour of colours.values()) {
    const count = samples.filter(p => p.rgb.every((v, i) => Math.abs(v - colour[i]) <= 3)).length;
    if (count > flatPixels) { flatPixels = count; flatColour = colour; }
  }
  const flat = samples.filter(p => p.rgb.every((v, i) => Math.abs(v - flatColour[i]) <= 3));
  const varied = samples.filter(p => !p.rgb.every((v, i) => Math.abs(v - flatColour[i]) <= 3));
  return { pixels: indices.length, flatColour, tolerance: 3, flatPixels, flatShare: flatPixels / samples.length,
    variedPixels: varied.length, variedShare: varied.length / samples.length,
    flatMeanY: flat.reduce((s, p) => s + p.y, 0) / flat.length,
    variedMeanY: varied.length ? varied.reduce((s, p) => s + p.y, 0) / varied.length : null };
}

export function silhouettePixels(predicted, width, height) {
  const indices = [], b = predicted.bounds;
  for (let y = Math.max(0, Math.ceil(b.minY)); y <= Math.min(height - 1, Math.floor(b.maxY)); y++) {
    for (let x = Math.max(0, Math.ceil(b.minX)); x <= Math.min(width - 1, Math.floor(b.maxX)); x++) {
      if (inPolygon(x, y, predicted.polygon)) indices.push(y * width + x);
    }
  }
  return indices;
}

export function assertDiskOrder(measured) {
  assert.ok(measured.flatShare >= 0.4 && measured.flatShare <= 0.8, `flat hemisphere share ${measured.flatShare}`);
  assert.ok(measured.variedShare >= 0.15, `foreground disk share ${measured.variedShare}`);
  assert.ok(measured.variedMeanY > measured.flatMeanY, `foreground disk lies below flat hemisphere: ${measured.variedMeanY} > ${measured.flatMeanY}`);
}

function nearRegion(on, off, predicted) {
  const regions = components(difference(on, off, 11).marked, on.width, on.height)
    .filter(region => Math.hypot(region.x - predicted.x, region.y - predicted.y) < 1.5 * predicted.radius + 3)
    .sort((a, b) => Math.hypot(a.x - predicted.x, a.y - predicted.y) - Math.hypot(b.x - predicted.x, b.y - predicted.y));
  assert.ok(regions.length, `difference exists near ${JSON.stringify(predicted)}`);
  return { nearest: regions[0], regions };
}

async function pair(page, outDir, name) {
  await afterRender(page, { layers: { worlds: false } });
  await settledExposure(page);
  const offExposure = (await state(page)).exposure;
  const off = await capture(page, outDir, `${name}-off`);
  await afterRender(page, { layers: { worlds: true } });
  const on = await capture(page, outDir, `${name}-on`);
  return { off, on, exposures: [offExposure, (await state(page)).exposure] };
}

async function setSeenPhase(page, id, phase) {
  const snapshot = await state(page), camera = cameraGeometry(snapshot.camera);
  const body = drawnWorlds(snapshot.settings.spinDelta, 1).find(b => b.id === id);
  const center = worldPosition(body.radiusM, phase, snapshot.settings.tilt);
  const accumulated = phase + 2 * body.omega * norm(center.map((v, i) => v - camera.position[i]));
  await renderedMutation(page, phases => window.eventHorizon.debug.setWorldPhases(phases), { [id]: accumulated });
  const actual = (await state(page)).worlds.find(b => b.id === id).center;
  assert.ok(norm(actual.map((v, i) => v - center[i])) < 1e-9);
}

async function placeFarShore(page, target, radius) {
  await afterRender(page, { camera: { radius, theta: 0.05, elevation: 0.13, yaw: 0, pitch: 0 } });
  const snapshot = await state(page), basis = cameraGeometry(snapshot.camera);
  const measure = phase => impact(directImage(basis.position, worldPosition(120, phase, snapshot.settings.tilt)), basis.position);
  let low = 0, high = Math.PI / 2;
  assert.ok(measure(low) > target && measure(high) < target, `impact ${target} bracket`);
  for (let i = 0; i < 48; i++) {
    const mid = (low + high) / 2;
    if (measure(mid) > target) low = mid;
    else high = mid;
  }
  await setSeenPhase(page, 'farShore', (low + high) / 2);
  const world = (await state(page)).worlds.find(b => b.id === 'farShore');
  const ray = directImage(basis.position, world.center);
  const f = dot(ray, basis.forward), u = dot(ray, basis.up), r = dot(ray, basis.right);
  await afterRender(page, { camera: { yaw: Math.atan2(r, Math.hypot(f, u)), pitch: Math.atan2(u, f) } });
  const current = await state(page), predicted = prediction(current.worlds.find(b => b.id === 'farShore'), current.camera);
  assert.ok(Math.abs(predicted.impact - target) < 1e-8);
  return predicted;
}

function surfaceAtPixel(world, camera, size, x, y) {
  const basis = cameraGeometry(camera);
  const sx = (2 * (x + 0.5) / size.width - 1 + (size.width > 1000 ? 0.13 : 0)) * size.width / size.height;
  const sy = 1 - 2 * (y + 0.5) / size.height;
  const ray = unit(basis.forward.map((v, i) => v + Math.tan(GEODESIC.halfFov) * (sx * basis.right[i] + sy * basis.up[i])));
  const mu = Math.max(-1, Math.min(1, -dot(ray, basis.radial)));
  const tangent = unit(ray.map((v, i) => v + mu * basis.radial[i]));
  const pixel = norm(world.center.map((v, i) => v - basis.position[i]))
    * 2 * Math.tan(GEODESIC.halfFov) / size.height / Math.sqrt(1 - 1 / camera.radius);
  let hit, tailStart = basis.position;
  const intersect = (position, direction, length) => {
    if (hit) return;
    const relative = position.map((v, i) => v - world.center[i]), along = dot(relative, direction);
    const perpendicular = norm(relative.map((v, i) => v - along * direction[i]));
    if (perpendicular >= world.radius) return;
    const entry = -along - Math.sqrt(world.radius ** 2 - perpendicular ** 2);
    if (entry < 0 || entry > length) return;
    const point = position.map((v, i) => v + entry * direction[i]);
    const normal = unit(point.map((v, i) => v - world.center[i]));
    hit = { cosine: dot(normal, unit(point).map(v => -v)), incidence: -dot(normal, direction),
      interior: world.radius - perpendicular >= pixel * 0.5, normal };
  };
  const traced = traceRay({ r: camera.radius, psi: Math.acos(mu), disk: {
    radial: basis.radial, tangent, normal: [0, 1, 0],
    onSegment({ position, nextPosition }) {
      const delta = nextPosition.map((v, i) => v - position[i]), length = norm(delta);
      if (length > 0) intersect(position, delta.map(v => v / length), length);
      tailStart = nextPosition;
    },
  } });
  if (!hit && traced.escaped) {
    const radius = norm(tailStart), radial = unit(tailStart), b = impact(ray, basis.position);
    const orbitNormal = cross(basis.radial, tangent), tailTangent = cross(orbitNormal, radial);
    const v = -Math.sqrt(Math.max(0, 1 / b ** 2 - (1 - 1 / radius) / radius ** 2));
    intersect(tailStart, unit(radial.map((value, i) => -v * value + tailTangent[i] / radius)), 1e6);
  }
  return hit;
}

export function surfaceSamples(image, world, camera, includeLimb = false) {
  const predicted = prediction(world, camera, image), samples = [];
  for (const index of silhouettePixels(predicted, image.width, image.height)) {
    const x = index % image.width, y = Math.floor(index / image.width);
    const hit = surfaceAtPixel(world, camera, image, x, y);
    if (hit && (includeLimb || (hit.interior && hit.incidence > 0.1))) samples.push({ x, y, ...hit, luma: image.luma(x, y) });
  }
  return samples;
}

function meanLuma(samples) {
  assert.ok(samples.length > 0, 'nonempty surface sample');
  return samples.reduce((sum, sample) => sum + sample.luma, 0) / samples.length;
}

function haloMetrics(on, off, predictions) {
  const enlarged = scale => predictions.map(p => p.polygon.map(v => ({
    x: p.x + scale * (v.x - p.x), y: p.y + scale * (v.y - p.y),
  })));
  const inner = enlarged(1.5), outer = enlarged(2.5);
  let pixels = 0, maximum = 0;
  for (let y = 0; y < on.height; y++) for (let x = 0; x < on.width; x++) {
    if (inner.some(p => inPolygon(x, y, p)) || !outer.some(p => inPolygon(x, y, p))) continue;
    pixels++;
    const a = on.rgb(x, y), b = off.rgb(x, y);
    maximum = Math.max(maximum, ...a.map((v, i) => Math.abs(v - b[i])));
  }
  return { innerRadii: 1.5, outerRadii: 2.5, pixels, maximum };
}

export const checks = [
  {
    name: 'spheres surface lighting visibility exposure and bloom', gpu: true, path: '/?debug=1', viewport,
    async run({ page, outDir }) {
      await prepare(page);
      await afterRender(page, { layers: { worlds: false } });
      await settledExposure(page);
      const exposureOff = (await state(page)).exposure;
      await afterRender(page, { layers: { worlds: true } });
      await settledExposure(page);
      const exposureOn = (await state(page)).exposure;
      const result = { exposureOff, exposureOn, exposureRatio: exposureOn / exposureOff };
      await writeFile(join(outDir, 'spheres-lighting.json'), JSON.stringify(result, null, 2));
      assert.ok(Math.abs(result.exposureRatio - 1) <= 0.01, `world exposure ratio ${result.exposureRatio}`);

      await afterRender(page, { layers: { disk: false, sky: false, ring: false } });
      await settledExposure(page);
      const isolated = await capture(page, outDir, 'spheres-default-surfaces');
      const snapshot = await state(page);
      const surfaces = snapshot.worlds.map(world => ({
        id: world.id, samples: surfaceSamples(isolated, world, snapshot.camera),
      }));
      result.defaultSurfaces = surfaces;
      const farDay = surfaces.find(w => w.id === 'farShore').samples.filter(p => p.cosine >= 0.35);
      result.farShore = { dayPixels: farDay.length, dayMeanLuma: meanLuma(farDay) };
      await writeFile(join(outDir, 'spheres-lighting.json'), JSON.stringify(result, null, 2));
      // A stretched image must retain the source sphere's illumination gradient.
      const far = surfaces[1].samples.filter(p => p.interior && p.incidence > 0.1).sort((a, b) => a.cosine - b.cosine);
      const quarter = Math.floor(far.length / 4);
      assert.ok(quarter > 0, 'resolved Far Shore surface');
      result.farGradient = { low: meanLuma(far.slice(0, quarter)), high: meanLuma(far.slice(-quarter)) };
      await writeFile(join(outDir, 'spheres-lighting.json'), JSON.stringify(result, null, 2));
      assert.ok(result.farGradient.high >= 1.2 * result.farGradient.low, `Far Shore surface gradient ${JSON.stringify(result.farGradient)}`);

      const predictions = snapshot.worlds.map(w => prediction(w, snapshot.camera));
      await afterRender(page, { layers: { worlds: false } });
      await settledExposure(page);
      const dark = await capture(page, outDir, 'spheres-dark-background');
      result.halos = [];
      for (const temperature of [2000, 6500, 20000]) {
        await renderedMutation(page, temperature => {
          const slider = document.querySelector('#param-temperature');
          slider.value = String(temperature);
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }, temperature);
        await page.waitForFunction(temperature => window.eventHorizon.getState().settings.temperature === temperature, temperature);
        await afterRender(page, { layers: { worlds: true } });
        await settledExposure(page);
        const frame = await capture(page, outDir, `spheres-no-halo-${temperature}`);
        const measured = { temperature, ...haloMetrics(frame, dark, predictions) };
        result.halos.push(measured);
        await writeFile(join(outDir, 'spheres-lighting.json'), JSON.stringify(result, null, 2));
        assert.ok(measured.pixels > 100, 'nonempty annuli beyond 1.5 world radii');
        assert.ok(measured.maximum <= 1, `world bloom halo at ${temperature} K: ${measured.maximum}`);
      }

      await renderedMutation(page, () => {
        const slider = document.querySelector('#param-temperature');
        slider.value = '6500';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(() => window.eventHorizon.getState().settings.temperature === 6500);
      await setSeenPhase(page, 'lantern', 0);
      await settledExposure(page);
      const quarterLit = await capture(page, outDir, 'spheres-lantern-day-night');
      const current = await state(page);
      const samples = surfaceSamples(quarterLit, current.worlds.find(w => w.id === 'lantern'), current.camera);
      const day = samples.filter(p => p.cosine >= 0.35), night = samples.filter(p => p.cosine <= -0.15);
      result.lantern = { dayPixels: day.length, nightPixels: night.length, dayMeanLuma: meanLuma(day), nightMeanLuma: meanLuma(night) };
      result.lantern.ratio = result.lantern.dayMeanLuma / result.lantern.nightMeanLuma;
      result.farLitRatio = result.farShore.dayMeanLuma / result.lantern.dayMeanLuma;
      await writeFile(join(outDir, 'spheres-lighting.json'), JSON.stringify(result, null, 2));
      assert.ok(result.farLitRatio >= 0.35, `Far Shore / quarter-lit Lantern core luma ${result.farLitRatio}`);
      assert.ok(result.lantern.ratio >= 2, `Lantern day/night luma ${result.lantern.ratio}`);
    },
  },
  {
    name: 'spheres mission gate and localized image changes', gpu: true, path: '/?debug=1', viewport,
    async run({ page, outDir }) {
      await prepare(page);
      await afterRender(page, { layers: { worlds: true } });
      const startingWorlds = (await state(page)).worlds;
      await renderedMutation(page, phases => window.eventHorizon.debug.setWorldPhases(phases),
        { lantern: -Math.PI / 2, farShore: 1.2 });
      await mission(page, false);
      await afterRender(page, { layers: { worlds: true } });
      await settledExposure(page);
      const a = await capture(page, outDir, 'spheres-A-closed');
      assert.ok((await state(page)).worlds.every(b => !b.drawn));
      await afterRender(page, { layers: { worlds: false } });
      await mission(page, true);
      const b = await capture(page, outDir, 'spheres-B-disabled');
      assert.ok(difference(a, b).maximum <= 1, 'closed Mission equals worlds disabled');
      await afterRender(page, { layers: { worlds: true } });
      const c = await capture(page, outDir, 'spheres-C-worlds');
      const snapshot = await state(page);
      assert.deepEqual(snapshot.worlds.map(w => [w.id, w.drawn]), [['lantern', true], ['farShore', true]]);
      const predictions = snapshot.worlds.map(w => prediction(w, snapshot.camera));
      const geometry = cameraGeometry(snapshot.camera), hole = screenPoint(geometry.radial.map(v => -v), geometry, 1440, 900);
      const secondaryRadius = 900 / (2 * Math.tan(GEODESIC.halfFov))
        * Math.tan(Math.asin(4 * Math.sqrt(1 - 1 / snapshot.camera.radius) / snapshot.camera.radius));
      const measured = locality(c, b, predictions, hole, secondaryRadius,
        { camera: snapshot.camera, worlds: snapshot.worlds, lensing: snapshot.settings.lensing });
      await writeFile(join(outDir, 'spheres-locality.json'), JSON.stringify(measured, null, 2));
      assert.ok(measured.changed > 0);
      assert.equal(measured.outside, 0, 'all changes stay within solved limb polygons + 3 px or the 4 r_s secondary-image region; see outsideClusters');
      for (const predicted of predictions) nearRegion(c, b, predicted);
      const untouched = await page.evaluate(() => {
        const first = window.eventHorizon.getState().worlds;
        first[0].center[0] = 999; first[0].drawn = false;
        return window.eventHorizon.getState().worlds;
      });
      assert.deepEqual(untouched, snapshot.worlds, 'world telemetry is copied');
      await renderedMutation(page, () => {
        window.eventHorizon.debug.setWorldPhases({ lantern: 0.4, farShore: -0.8 });
        window.eventHorizon.debug.setSimulationTime(123);
      });
      await page.keyboard.press('KeyR');
      await page.waitForFunction(() => window.eventHorizon.getState().simulationTime === 0
        && document.querySelector('.notice').textContent === 'OBSERVATION POINT RESTORED');
      await afterRender(page, {});
      assert.deepEqual((await state(page)).worlds, startingWorlds, 'reset restores accumulated start phases');
    },
  },
  {
    name: 'spheres default images clear visible panels', gpu: true, path: '/?debug=1', viewport,
    async run({ page, outDir }) {
      await prepare(page, false);
      await afterRender(page, { layers: { worlds: true } });
      const results = [];
      for (const size of [viewport, { width: 1000, height: 800 }]) {
        await page.setViewportSize(size);
        await page.waitForFunction(size => innerWidth === size.width && innerHeight === size.height, size);
        await afterRender(page, {});
        const snapshot = await state(page);
        assert.equal(snapshot.simulationTime, 0);
        assert.ok(snapshot.worlds.every(w => w.drawn));
        const predictions = snapshot.worlds.map(w => prediction(w, snapshot.camera, size));
        const panels = await page.evaluate(() => ['.mission-panel', '.control-panel', '.telemetry', '.object-label', '.simulation-time', '.camera-dock', '.notice'].map(selector => {
          const element = document.querySelector(selector), box = element.getBoundingClientRect(), style = getComputedStyle(element);
          return { selector, minX: box.left, minY: box.top, maxX: box.right, maxY: box.bottom,
            visible: style.visibility !== 'hidden' && Number(style.opacity) > 0 };
        }));
        results.push({ viewport: size, phases: START_PHASES, predictions, panels });
        await writeFile(join(outDir, 'spheres-default-layout.json'), JSON.stringify(results, null, 2));
        for (const p of predictions) {
          const b = p.bounds;
          assert.ok(b.minX > 3 && b.maxX < size.width - 3 && b.minY > 3 && b.maxY < size.height - 3, `${p.id} silhouette fits frame`);
          for (const panel of panels) {
            assert.ok(b.maxX + 3 < panel.minX || b.minX - 3 > panel.maxX || b.maxY + 3 < panel.minY || b.minY - 3 > panel.maxY,
              `${p.id} clears ${panel.selector}: ${JSON.stringify({ image: b, panel })}`);
          }
        }
        await page.screenshot({ path: join(outDir, `spheres-default-${size.width}.png`), scale: 'css' });
      }
    },
  },
  {
    name: 'spheres direct images across weak field boundary', gpu: true, path: '/?debug=1', viewport,
    async run({ page, outDir }) {
      await prepare(page);
      const results = [];
      for (const [target, radius] of [[6, 12], [16, 23], [12, 23]]) {
        const predicted = await placeFarShore(page, target, radius);
        const { on, off, exposures } = await pair(page, outDir, `spheres-impact-${target}`);
        const { nearest, regions } = nearRegion(on, off, predicted);
        const error = Math.hypot(nearest.x - predicted.x, nearest.y - predicted.y);
        results.push({ target, predicted, centroid: { x: nearest.x, y: nearest.y }, area: nearest.area, error, exposures,
          components: regions.map(r => ({ x: r.x, y: r.y, area: r.area })) });
        await writeFile(join(outDir, 'spheres-positions.json'), JSON.stringify(results, null, 2));
        assert.ok(error <= Math.max(3, predicted.radius / 4), `impact ${target}: centroid error ${error}`);
        assert.ok(Math.abs(nearest.area / predicted.area - 1) <= 0.35, `impact ${target}: area ${nearest.area}, predicted ${predicted.area}`);
        if (target === 12) {
          assert.ok(Math.min(...predicted.limbImpacts) < 12 && Math.max(...predicted.limbImpacts) > 12, 'disc straddles impact 12');
          assert.equal(regions.length, 1, 'the straddling disc is one connected component');
        }
      }
    },
  },
  {
    name: 'spheres disk crossing order retains foreground light', gpu: true, path: '/?debug=1', viewport,
    async run({ page, outDir }) {
      await prepare(page);
      await setSeenPhase(page, 'lantern', -Math.PI / 2);
      const snapshot = await state(page), predicted = prediction(snapshot.worlds.find(b => b.id === 'lantern'), snapshot.camera);
      const { on, off, exposures } = await pair(page, outDir, 'spheres-lantern-front');
      const { nearest } = nearRegion(on, off, predicted);
      // Opaque foreground gas can leave the lower silhouette unchanged between frames.
      const measured = colourMetrics(on, silhouettePixels(predicted, on.width, on.height));
      await writeFile(join(outDir, 'spheres-disk-order.json'), JSON.stringify({ phase: -Math.PI / 2, predicted, exposures,
        differenceOnly: colourMetrics(on, nearest.indices), silhouette: measured }, null, 2));
      assertDiskOrder(measured);
    },
  },
  {
    name: 'spheres reference lensing gate', gpu: true, path: '/?debug=1', viewport,
    async run({ page, outDir }) {
      await prepare(page);
      await renderedMutation(page, () => {
        const slider = document.querySelector('#param-lensing');
        slider.value = '1.15';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForFunction(() => window.eventHorizon.getState().settings.lensing === 1.15
        && window.eventHorizon.getState().worlds.length === 2 && window.eventHorizon.getState().worlds.every(w => !w.drawn));
      const { on, off } = await pair(page, outDir, 'spheres-lensing-115');
      assert.ok((await state(page)).worlds.every(b => !b.drawn));
      assert.ok(difference(on, off).maximum <= 1, 'worlds disabled at lensing 1.15');
    },
  },
];
