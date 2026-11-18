import { blRadius, metricProduct, observerFrame, traceRay } from './kerrray.js';

const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a, b) => a.map((v, i) => v - b[i]);
const unit = a => a.map(v => v / Math.hypot(...a));
const mix = (a, b, t) => a.map((v, i) => v + t * (b[i] - v));
function finite(...values) {
  if (!values.every(Number.isFinite)) throw new RangeError('Expected finite Kerr world inputs.');
}

export function photonOrbit(spin) {
  finite(spin);
  if (spin < 0 || spin > 0.998) throw new RangeError('Picture spin must be in [0, 0.998].');
  return 1 + Math.cos(2 / 3 * Math.acos(-spin));
}

export function worldOmega(radius, spin) {
  const minimum = 1.2 * photonOrbit(spin);
  finite(radius);
  if (radius < minimum) throw new RangeError('World must be at or above 1.2 photon radii.');
  return Math.sqrt(0.5) / (radius ** 1.5 + spin / 2 * Math.sqrt(0.5));
}

/** Phase uses the scene convention; KS azimuth is phase + pi/2, with zero tilt. */
export function worldEvent(radius, phase, time, spin) {
  finite(phase, time);
  const omega = worldOmega(radius, spin), phi = phase + Math.PI / 2 + omega * time;
  const rho = Math.sqrt(radius * radius + spin * spin / 4);
  const x = [rho * Math.cos(phi), rho * Math.sin(phi), 0];
  return { t: time, x, omega };
}

/** Small spherical bodies and their surface normals are defined in KS Cartesian coordinates. */
export function movingSphere(start, end, centerStart, centerEnd, radius) {
  if (![start, end, centerStart, centerEnd].every(v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite))
    || !Number.isFinite(radius) || radius <= 0) throw new RangeError('Invalid moving sphere.');
  const relative = sub(start, centerStart), delta = sub(sub(end, start), sub(centerEnd, centerStart));
  const A = dot(delta, delta), B = dot(relative, delta), C = dot(relative, relative) - radius * radius;
  const D = B * B - A * C;
  if (A === 0 || D < 0) return null;
  const near = (-B - Math.sqrt(D)) / A, far = (-B + Math.sqrt(D)) / A;
  const fraction = near >= 0 ? near : far;
  if (fraction < 0 || fraction > 1) return null;
  const x = mix(start, end, fraction), center = mix(centerStart, centerEnd, fraction);
  return { fraction, x, center, normal: sub(x, center).map(v => v / radius) };
}

export function circularVelocity(x, radius, spin) {
  blRadius(x, spin);
  const omega = worldOmega(radius, spin), v = [1, -omega * x[1], omega * x[0], 0];
  const norm = metricProduct(x, spin, v, v);
  if (!(norm < 0)) throw new RangeError('Circular emitter must be timelike.');
  return v.map(value => value / Math.sqrt(-norm));
}

export function worldShift(x, p, pt, radius, spin) {
  if (!Array.isArray(p) || p.length !== 3) throw new RangeError('Expected finite three-momentum.');
  finite(pt); finite(...p);
  const u = circularVelocity(x, radius, spin);
  return 1 / (pt * u[0] + dot(p, u.slice(1)));
}

export function traceWorld({ radius, phase, bodyRadius, ...ray }) {
  worldOmega(radius, ray.spin); finite(phase, bodyRadius);
  if (bodyRadius <= 0) throw new RangeError('World size must be positive.');
  return traceRay({ ...ray, onChord(start, end) {
    const c0 = worldEvent(radius, phase, start.t, ray.spin).x;
    const c1 = worldEvent(radius, phase, end.t, ray.spin).x;
    const hit = movingSphere(start.x, end.x, c0, c1, bodyRadius);
    if (!hit) return null;
    const p = mix(start.p, end.p, hit.fraction), t = start.t + hit.fraction * (end.t - start.t);
    return { ...hit, t, delay: -t, p, g: worldShift(hit.x, p, start.pt, radius, ray.spin) };
  } });
}

/** Shoot a direct event curve x(t), retaining the closer angular match at either radius crossing. */
export function directEventImage({ position, spin, eventAt, stepScale = 0.1, initialDirection, primary = false, imageSeeds }) {
  const frame = observerFrame(position, spin);
  let target = eventAt(0).x;
  for (let i = 0; i < 8; i++) target = eventAt(-Math.hypot(...sub(target, frame.position))).x;
  const forward = unit(sub(target, frame.position));
  // Seed with the spatial coordinate velocity projected onto the local tetrad.
  const initial = frame.covectors.slice(1).map(cov => dot(cov.slice(1), forward));
  let n, result;
  let refinement = primary ? Math.max(0.4, stepScale) : stepScale;
  const shoot = (direction, scale = refinement) => {
    let found;
    traceRay({ position, spin, direction, stepScale: scale, onChord(s, e) {
      const target0 = eventAt(s.t).x, target1 = eventAt(e.t).x;
      const d0 = blRadius(s.x, spin) - blRadius(target0, spin);
      const d1 = blRadius(e.x, spin) - blRadius(target1, spin);
      if (d0 * d1 > 0 || d0 === d1) return null;
      const f = d0 / (d0 - d1), t = s.t + f * (e.t - s.t), x = mix(s.x, e.x, f);
      const center = eventAt(t).x, radius = blRadius(center, spin);
      const phi = Math.atan2(x[1], x[0]) - Math.atan2(center[1], center[0]);
      const theta = Math.acos(Math.max(-1, Math.min(1, x[2] / blRadius(x, spin))))
        - Math.acos(Math.max(-1, Math.min(1, center[2] / radius)));
      const candidate = { x, t, p: mix(s.p, e.p, f), pt: s.pt,
        residual: [radius * Math.atan2(Math.sin(phi), Math.cos(phi)), radius * theta] };
      if (!found || Math.hypot(...candidate.residual) < Math.hypot(...found.residual)) found = candidate;
      // A nearby shooting branch needs no continuation behind its target shell.
      return d1 > d0 || Math.hypot(...found.residual) < 1e-5 * radius ? found : null;
    } });
    return found;
  };
  const solve = seed => {
    n = unit(seed);
    const e1 = unit(Math.abs(n[0]) > 0.7 ? [-n[1], n[0], 0] : [0, -n[2], n[1]]);
    const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
    for (let i = 0; i < 16; i++) {
      result = shoot(n);
      if (!result) {
        n = unit([n[0], n[1] * 0.995, n[2] * 0.995]);
        continue;
      }
      if (Math.hypot(...result.residual) < 1e-9) break;
      const epsilon = 1e-7;
      const r1 = shoot(unit(n.map((v, j) => v + epsilon * e1[j])));
      const r2 = shoot(unit(n.map((v, j) => v + epsilon * e2[j])));
      if (!r1 || !r2) return false;
      const [x, y] = result.residual;
      const a = (r1.residual[0] - x) / epsilon, b = (r2.residual[0] - x) / epsilon;
      const c = (r1.residual[1] - y) / epsilon, d = (r2.residual[1] - y) / epsilon;
      const det = a * d - b * c;
      if (Math.abs(det) < 1e-12) return false;
      const du = (d * x - b * y) / det, dv = (-c * x + a * y) / det;
      let accepted = false;
      for (let damping = 1; damping >= 1 / 4096; damping /= 2) {
        const candidate = unit(n.map((v, j) => v - damping * (du * e1[j] + dv * e2[j])));
        const next = shoot(candidate);
        if (next && Math.hypot(...next.residual) < Math.hypot(...result.residual)) {
          n = candidate; accepted = true; break;
        }
      }
      if (!accepted) return Math.hypot(...result.residual) <= 1e-6;
    }
    return result && Math.hypot(...result.residual) <= 1e-6;
  };
  let best;
  const roots = [];
  const retain = () => {
    if (!best || result.t > best.result.t) best = { n: [...n], result };
    if (!roots.some(seed => Math.hypot(...seed.map((v, i) => v - n[i])) < 1e-6)) roots.push([...n]);
  };
  if (solve(initialDirection ?? initial)) retain();
  if (primary && initialDirection && solve(initial)) retain();
  const near = primary && blRadius(target, spin) < 2;
  if (near && imageSeeds) for (const seed of imageSeeds) {
    if (solve(seed)) retain();
  }
  if (!best || (near && !imageSeeds)) {
    // Strong lensing admits several images; reception uses the earliest arrival.
    const seeds = [];
    for (let y = -6; y <= 6; y++) for (let z = -6; z <= 6; z++) {
      const direction = unit([Math.sign(initial[0]) || -1, y * 0.025, z * 0.025]);
      const hit = shoot(direction, 0.5);
      if (hit) seeds.push({ direction, error: Math.hypot(...hit.residual) });
    }
    seeds.sort((a, b) => a.error - b.error);
    for (const seed of seeds.slice(0, 6)) if (solve(seed.direction)) retain();
  }
  if (!best) throw new RangeError('Direct image did not converge.');
  if (refinement !== stepScale) {
    refinement = stepScale;
    if (!solve(best.n)) throw new RangeError('Direct image refinement did not converge.');
    best = { n: [...n], result };
  }
  ({ n, result } = best);
  const sceneDirection = frame.sceneBasis[0].map((_, j) => dot(n, frame.sceneBasis.map(v => v[j])));
  return { ...result, imageSeeds: near ? roots : undefined, direction: n, sceneDirection, delay: -result.t, radius: blRadius(result.x, spin) };
}

export function worldImage({ radius, phase, ...ray }) {
  worldOmega(radius, ray.spin); finite(phase);
  return directEventImage({ ...ray, eventAt: t => worldEvent(radius, phase, t, ray.spin) });
}
