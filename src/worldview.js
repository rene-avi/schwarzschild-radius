import { circularOrbit } from './kerr.js';
import { GEODESIC } from './geodesic.js';

export const START_PHASES = Object.freeze({ lantern: -0.9, farShore: 1.82 });
const candidates = [
  { id: 'lantern', radiusM: 12, radius: 0.18 },
  { id: 'farShore', radiusM: 120, radius: 0.6 },
];
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const norm = a => Math.hypot(...a);
const unit = a => a.map(value => value / norm(a));

/** Decisions compare Kerr clocks and angular speeds with Schwarzschild at the same radius. */
export function drawnWorlds(delta, lensing) {
  return candidates.map(body => {
    const { omega, dtdtau } = circularOrbit(body.radiusM, delta);
    const omegaDeviation = Math.abs(omega * body.radiusM ** 1.5 - 1);
    const clockDeviation = Math.abs(dtdtau * Math.sqrt(1 - 3 / body.radiusM) - 1);
    return { ...body, omega, omegaDeviation, clockDeviation,
      drawn: body.radiusM / 2 >= 3 && omegaDeviation <= 0.03 && clockDeviation <= 0.03
        && Math.abs(lensing - 1) <= 1e-9 };
  });
}

/** dtSim is coordinate time in r_s/c; Kerr omega uses inverse M time. */
export function advancePhases(phases, dtSim, delta) {
  return Object.fromEntries(candidates.map(body => [body.id,
    phases[body.id] + 2 * circularOrbit(body.radiusM, delta).omega * dtSim]));
}

/** e2 = cross(n, e1), so increasing phase has the disk's Doppler sense. */
export function worldPosition(radiusM, phase, tilt) {
  const r = radiusM / 2;
  const angle = tilt * Math.PI / 180;
  return [r * Math.cos(phase), -r * Math.sin(phase) * Math.sin(angle), -r * Math.sin(phase) * Math.cos(angle)];
}

export function retardedPosition(body, phase, cameraPosition, tilt) {
  const omega = 2 * body.omega;
  const distance = seen => norm(worldPosition(body.radiusM, seen, tilt).map((v, i) => v - cameraPosition[i]));
  let seen = phase;
  for (let i = 0; i < 3; i++) seen = phase - omega * distance(seen);
  // Refine the delay residual: three fixed-point steps alone do not reach nanoradian accuracy.
  for (let i = 0; i < 8; i++) {
    const position = worldPosition(body.radiusM, seen, tilt);
    const relative = position.map((v, axis) => v - cameraPosition[axis]);
    const d = norm(relative);
    const a = tilt * Math.PI / 180;
    const derivative = [-Math.sin(seen), -Math.cos(seen) * Math.sin(a), -Math.cos(seen) * Math.cos(a)]
      .map(v => v * body.radiusM / 2);
    const residual = seen - phase + omega * d;
    if (Math.abs(residual) < 1e-13) break;
    seen -= residual / (1 + omega * (d > 0 ? dot(relative, derivative) / d : 0));
  }
  return { phase: seen, center: worldPosition(body.radiusM, seen, tilt) };
}

// Integrate to a fixed orbital angle; capture and infinity bound the shooting residual.
function endpoint(angle, u, v) {
  const count = Math.max(1, Math.ceil(angle / 0.001));
  const h = angle / count;
  for (let i = 0; i < count; i++) {
    const a1 = 1.5 * u * u - u;
    const u2 = u + v * h / 2, v2 = v + a1 * h / 2;
    const a2 = 1.5 * u2 * u2 - u2;
    const u3 = u + v2 * h / 2, v3 = v + a2 * h / 2;
    const a3 = 1.5 * u3 * u3 - u3;
    const u4 = u + v3 * h, v4 = v + a3 * h;
    u += h / 6 * (v + 2 * v2 + 2 * v3 + v4);
    v += h / 6 * (a1 + 2 * a2 + 2 * a3 + 1.5 * u4 * u4 - u4);
    if (u >= 1) return Infinity;
    if (u <= 0) return -Infinity;
  }
  return u;
}

/** Direct, non-winding null ray at a static observer; axial alignment has no unique image. */
export function directImage(cameraPosition, worldPosition) {
  const r = norm(cameraPosition), sourceRadius = norm(worldPosition);
  if (!(r > 1 && sourceRadius > 1)) return null;
  const radial = unit(cameraPosition), source = unit(worldPosition);
  const cosine = Math.max(-1, Math.min(1, dot(radial, source)));
  const transverse = source.map((v, i) => v - cosine * radial[i]);
  const sine = norm(transverse);
  if (sine < 1e-14) {
    if (cosine < 0 || Math.abs(r - sourceRadius) < 1e-14) return null;
    return radial.map(v => v * Math.sign(sourceRadius - r));
  }
  const angle = Math.atan2(sine, cosine), tangent = unit(transverse);
  const u = 1 / r, target = 1 / sourceRadius;
  const maximumImpact = r / Math.sqrt(1 - u);
  const inward = endpoint(angle, u, 0) < target;
  let low = 0, high = maximumImpact;
  for (let i = 0; i < 64; i++) {
    const b = (low + high) / 2;
    const v = (inward ? 1 : -1) * Math.sqrt(Math.max(0, 1 / (b * b) - u * u * (1 - u)));
    const residual = endpoint(angle, u, v) - target;
    if ((residual > 0) === inward) low = b;
    else high = b;
  }
  const impact = (low + high) / 2;
  const v = (inward ? 1 : -1) * Math.sqrt(Math.max(0, 1 / (impact * impact) - u * u * (1 - u)));
  const coordinate = radial.map((value, i) => -v * value + u * tangent[i]);
  const radialPart = dot(coordinate, radial);
  const lapse = Math.sqrt(1 - u);
  return unit(coordinate.map((value, i) => radialPart * radial[i] + lapse * (value - radialPart * radial[i])));
}

export function screenPoint(direction, cameraBasis, width, height) {
  if (!direction) return null;
  const forward = dot(direction, cameraBasis.forward);
  if (forward <= 0) return null;
  const focal = height / (2 * Math.tan(GEODESIC.halfFov));
  return { x: width * (0.5 - (width > 1000 ? 0.065 : 0)) - 0.5 + focal * dot(direction, cameraBasis.right) / forward,
    y: height / 2 - 0.5 - focal * dot(direction, cameraBasis.up) / forward };
}
