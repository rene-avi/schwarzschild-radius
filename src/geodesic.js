// Distances use r_s = 1; angles use radians. Shared with the fragment shader.
export const GEODESIC = Object.freeze({
  halfFov: 21 * Math.PI / 180,
  criticalImpact: 3 * Math.sqrt(3) / 2,
  captureRadius: 1.015,
  minimumRadius: 1.03,
  maximumRadius: 65,
  highSteps: 352,
  balancedSteps: 192,
  performanceSteps: 144,
  highAngle: 0.22,
  balancedAngle: 0.28,
  performanceAngle: 0.34,
  highCriticalAngle: 0.055,
  balancedCriticalAngle: 0.075,
  performanceCriticalAngle: 0.1,
  criticalStep: 0.5,
  criticalImpactScale: 4,
  flatAngle: 0.1,
  radialStep: 0.5,
  escapeRadius: 12,
  escapeImpact: 2,
  minimumAngle: 0.000001,
  radialEpsilon: 0.000001,
  weakStart: 10,
  weakEnd: 12,
});

// Second-order integral from an outgoing vacuum point to infinity, where b/r <= 1/2.
export function escapeAngle(u, b, L) {
  const z = b * u;
  const z2 = z * z;
  const c = Math.sqrt(1 - z2);
  const first = z2 * z2 / (c * (1 + c) ** 2);
  const second = z * z2 ** 3 * (1 / 7 + z2 * (5 / 18 + z2 * (35 / 88 + z2 * (105 / 208 + z2 * 77 / 128))));
  const epsilon = L / b;
  return Math.asin(z) - epsilon * first / 2 + 3 * epsilon * epsilon * second / 8;
}

function observer(r, L) {
  if (!Number.isFinite(L) || L < 0 || L > 2 || !(r > L)) {
    throw new RangeError('A static observer requires 0 <= L <= 2 and r > L.');
  }
}

export const captureRadius = L => GEODESIC.captureRadius * Math.max(1, L);
export const minimumRadius = L => GEODESIC.minimumRadius * Math.max(1, L);

export function impactParameter(r, psi, L = 1) {
  observer(r, L);
  return r * Math.sin(psi) / Math.sqrt(1 - L / r);
}

// atan2 preserves the inward/outward hemisphere, including inside the photon sphere.
export function localToFlatAngle(r, psi, L = 1) {
  observer(r, L);
  return Math.atan2(Math.sin(psi) / Math.sqrt(1 - L / r), Math.cos(psi));
}

export function shadowAngularRadius(r, L = 1) {
  observer(r, L);
  const surface = captureRadius(L);
  const photonSphere = 1.5 * L;
  const critical = photonSphere >= surface ? GEODESIC.criticalImpact * L
    : surface / Math.sqrt(1 - L / surface);
  const alpha = Math.asin(Math.min(1, critical / r * Math.sqrt(1 - L / r)));
  return r < photonSphere ? Math.PI - alpha : alpha;
}

export function shiftFactor(rEmit, rObs, L = 1) {
  observer(rEmit, L);
  observer(rObs, L);
  return Math.sqrt((1 - L / rEmit) / (1 - L / rObs));
}

/** Optional disk has a unit normal (x = 0) and orthonormal orbital radial/tangent. */
export function traceRay({ r, psi, L = 1, quality = 'high', disk, stepScale = 1 }) {
  observer(r, L);
  if (!(stepScale > 0 && stepScale <= 1)) throw new RangeError('Step scale must be in (0, 1].');
  const b = impactParameter(r, psi, L);
  if (Math.abs(Math.sin(psi)) < GEODESIC.radialEpsilon) {
    const captured = Math.cos(psi) > 0;
    return { captured, escaped: !captured, exhausted: false, direction: [-Math.cos(psi), Math.sin(psi)], deflection: 0, steps: 0,
      ...(disk ? { crossings: [] } : {}) };
  }
  const mode = String(quality).toLowerCase();
  const limit = Math.ceil(GEODESIC[`${mode}Steps`] / stepScale);
  const maxAngle = GEODESIC[`${mode}Angle`];
  const criticalAngle = GEODESIC[`${mode}CriticalAngle`];
  const surface = captureRadius(L);
  const critical = 1.5 * L >= surface ? GEODESIC.criticalImpact * L : surface / Math.sqrt(1 - L / surface);
  const criticalDistance = Math.min(1, GEODESIC.criticalImpactScale * Math.abs(b / critical - 1));
  if (!limit) throw new RangeError('Unknown ray quality.');
  let u = 1 / r;
  let v = Math.cos(psi) / b;
  let phi = 0;
  const crossings = [];
  let orbitRadial = disk?.radial;
  let orbitTangent = disk?.tangent;
  let position = orbitRadial?.map(value => value * r);
  const finish = result => disk ? { ...result, crossings } : result;
  for (let i = 0; i < limit; i++) {
    if (u >= 1 / captureRadius(L)) return finish({ captured: true, escaped: false, exhausted: false, steps: i });
    if (v < 0 && u < 1 / Math.max(GEODESIC.escapeRadius, GEODESIC.escapeImpact * b)) {
      phi += escapeAngle(u, b, L);
      return finish({ captured: false, escaped: true, exhausted: false,
        direction: [Math.cos(phi), Math.sin(phi)], deflection: phi - (Math.PI - psi), steps: i });
    }
    const angularLimit = Math.min(maxAngle, GEODESIC.flatAngle + L,
      criticalAngle + GEODESIC.criticalStep * Math.abs(1 - 1.5 * L * u) * criticalDistance);
    const h = stepScale * Math.min(angularLimit, Math.max(GEODESIC.minimumAngle, GEODESIC.radialStep * u / Math.max(Math.abs(v), u)));
    const a1 = 1.5 * L * u * u - u;
    const u2 = u + v * h * 0.5;
    const v2 = v + a1 * h * 0.5;
    const a2 = 1.5 * L * u2 * u2 - u2;
    const u3 = u + v2 * h * 0.5;
    const v3 = v + a2 * h * 0.5;
    const a3 = 1.5 * L * u3 * u3 - u3;
    const u4 = u + v3 * h;
    const v4 = v + a3 * h;
    const a4 = 1.5 * L * u4 * u4 - u4;
    const nextU = u + h / 6 * (v + 2 * v2 + 2 * v3 + v4);
    const nextV = v + h / 6 * (a1 + 2 * a2 + 2 * a3 + a4);
    if (nextU <= 0) {
      phi += h * u / (u - nextU);
      const initial = Math.PI - psi;
      return finish({ captured: false, escaped: true, exhausted: false,
        direction: [Math.cos(phi), Math.sin(phi)], deflection: phi - initial, steps: i + 1 });
    }
    if (disk) {
      const h2 = h * h;
      const s = h * (1 + h2 * (-1 / 6 + h2 * (1 / 120 - h2 / 5040)));
      const c = 1 + h2 * (-1 / 2 + h2 * (1 / 24 - h2 / 720));
      const nextRadial = orbitRadial.map((value, axis) => value * c + orbitTangent[axis] * s);
      const nextTangent = orbitRadial.map((value, axis) => -value * s + orbitTangent[axis] * c);
      const nextPosition = nextRadial.map(value => value / nextU);
      const plane0 = dot(position, disk.normal);
      const plane1 = dot(nextPosition, disk.normal);
      disk.onSegment?.({ position, nextPosition });
      if (plane0 * plane1 < 0) {
        // The orbital plane fixes the crossing angle independently of radius.
        const planeRadial = dot(orbitRadial, disk.normal);
        const planeTangent = dot(orbitTangent, disk.normal);
        const fraction = Math.atan2(Math.abs(planeRadial), Math.abs(planeTangent)) / h;
        const slope0 = h * v, slope1 = h * nextV;
        const quadratic = 3 * (nextU - u) - 2 * slope0 - slope1;
        const cubic = 2 * (u - nextU) + slope0 + slope1;
        const crossingU = u + fraction * (slope0 + fraction * (quadratic + fraction * cubic));
        const crossingV = (slope0 + fraction * (2 * quadratic + fraction * 3 * cubic)) / h;
        const crossingRadial = normalize(orbitRadial.map((value, axis) => value * Math.abs(planeTangent) + orbitTangent[axis] * Math.abs(planeRadial)));
        const crossingTangent = normalize(orbitRadial.map((value, axis) => -value * Math.abs(planeRadial) + orbitTangent[axis] * Math.abs(planeTangent)));
        const crossing = crossingRadial.map(value => value / crossingU);
        const direction = normalize(crossingRadial.map((value, axis) => -crossingV * value + crossingU * crossingTangent[axis]));
        const axisY = [0, disk.normal[2], -disk.normal[1]];
        crossings.push({ radius: Math.hypot(...crossing), azimuth: Math.atan2(dot(crossing, axisY), crossing[0]),
          position: crossing, direction, step: i, phi: phi + h * fraction });
      }
      orbitRadial = nextRadial;
      orbitTangent = nextTangent;
      position = nextPosition;
    }
    phi += h;
    u = nextU;
    v = nextV;
  }
  return finish({ captured: false, escaped: false, exhausted: true, steps: limit });
}

const dot = (a, b) => a.reduce((sum, value, axis) => sum + value * b[axis], 0);
const normalize = vector => vector.map(value => value / Math.hypot(...vector));
