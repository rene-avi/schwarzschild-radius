import { GEODESIC } from '../src/geodesic.js';
import { observerFrame, traceRay } from '../src/kerrray.js';
import { worldEvent } from '../src/kerrworlds.js';

const drawnIds = new Set(['lantern', 'farShore']);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const mix = (a, b, t) => a.map((v, i) => v + t * (b[i] - v));

export function geometry(elevation = .23) {
  const radial = [0, Math.sin(elevation), Math.cos(elevation)];
  return { position: radial.map(v => v * 23), radial,
    forward: radial.map(v => -v), right: [1, 0, 0], up: [0, Math.cos(elevation), -Math.sin(elevation)],
    polar: [0, -Math.cos(elevation), Math.sin(elevation)], azimuth: [1, 0, 0] };
}

export function pixelRay(x, y, basis) {
  const scale = 450 / Math.tan(GEODESIC.halfFov), centre = 449.5;
  const sx = (x - centre) / scale, sy = (centre - y) / scale;
  const d = basis.forward.map((v, i) => v + sx * basis.right[i] + sy * basis.up[i]);
  return [dot(d, basis.radial), dot(d, basis.polar), dot(d, basis.azimuth)];
}

export function inPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if ((a.y > y) !== (b.y > y) && x < a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

export function edgeDistance(x, y, polygon) {
  return Math.min(...polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
  }));
}

// Exact support of kerrWorldHit, including its one-pixel smooth coverage rim.
// No screen-space dilation or exception for small clusters is applied here.
export function worldCoverage(start, end, c0, c1, radius, pixel) {
  const relative = start.map((v, i) => v - c0[i]);
  const delta = end.map((v, i) => v - start[i] - (c1[i] - c0[i]));
  const A = dot(delta, delta), B = dot(relative, delta), C = dot(relative, relative);
  if (A <= 0) return null;
  const perpendicular = Math.sqrt(Math.max(0, C - B * B / A));
  const t = Math.max(0, Math.min(1, (perpendicular - radius + pixel * .5) / pixel));
  const coverage = 1 - t * t * (3 - 2 * t);
  const root = Math.sqrt(Math.max(0, B * B - A * (C - radius * radius)));
  const near = (-B - root) / A, far = (-B + root) / A;
  const fraction = near >= 0 ? near : far;
  return coverage > 0 && fraction >= 0 && fraction <= 1 ? { fraction, coverage } : null;
}

export function traceWorldPixel(pixel, { basis, spin, worlds }) {
  const frame = observerFrame(basis.position, spin), pixelAngle = 2 * Math.tan(GEODESIC.halfFov) / 900;
  // The reference allowlist is independent of the shader/getState draw gate.
  const allowed = worlds.filter(w => drawnIds.has(w.id) && w.drawn);
  const ray = traceRay({ position: basis.position, direction: pixelRay(pixel.x, pixel.y, basis), spin,
    quality: 'high', stepScale: 1, onChord(start, end) {
      let nearest = null;
      for (const world of allowed) {
        const c0 = worldEvent(world.orbitRadius, world.phase, start.t, spin).x;
        const c1 = worldEvent(world.orbitRadius, world.phase, end.t, spin).x;
        const footprint = Math.hypot(...frame.position.map((v, i) => v - (c0[i] + c1[i]) / 2)) * pixelAngle * frame.ut;
        const hit = worldCoverage(start.x, end.x, c0, c1, world.radius, footprint);
        if (hit && (!nearest || hit.fraction < nearest.fraction)) {
          nearest = { ...hit, id: world.id, delay: -(start.t + hit.fraction * (end.t - start.t)),
            x: mix(start.x, end.x, hit.fraction) };
        }
      }
      return nearest;
    } });
  return ray.fate === 'hit' ? ray.hit : null;
}

export function classifyWorldChanges(changed, images, tracePixel) {
  const result = { direct: 0, confirmed: [], unexplained: [] };
  for (const p of changed) {
    if (images.some(row => drawnIds.has(row.id) && (inPolygon(p.x, p.y, row.polygon)
      || edgeDistance(p.x, p.y, row.polygon) <= 3))) {
      result.direct++;
      continue;
    }
    // Check every residual pixel: a valid neighbour never excuses a ghost.
    const hit = tracePixel(p);
    if (hit && drawnIds.has(hit.id) && hit.coverage > 0 && hit.coverage <= 1) {
      result.confirmed.push({ ...p, id: hit.id, coverage: hit.coverage, delay: hit.delay });
    } else result.unexplained.push(p);
  }
  return result;
}
