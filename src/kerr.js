import { G, C, SOLAR_MASS } from './physics.js';

function validDelta(delta) {
  if (!Number.isFinite(delta) || delta <= 0 || delta > 1) {
    throw new RangeError('Spin delta must be finite and in (0, 1].');
  }
}

function radiusOffset(radius) {
  const offset = typeof radius === 'number' ? radius - 1
    : radius !== null && typeof radius === 'object' ? radius.offset : NaN;
  if (!Number.isFinite(offset)) throw new RangeError('Radius or offset must be finite.');
  return offset;
}

function radiusValue(radius) {
  const value = typeof radius === 'number' ? radius : 1 + radiusOffset(radius);
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Radius must be finite and nonnegative.');
  return value;
}

/** Convert a radius in M units (number or { offset: r/M - 1 }) to r_s units. */
export function mToRs(r) {
  return radiusValue(r) / 2;
}

/** Convert a radius in r_s units (number or { offset: r/r_s - 1 }) to M units. */
export function rsToM(r) {
  return 2 * radiusValue(r);
}

/** Dimensionless a/M = 1 - delta, for display only; no radius or time units. */
export function spinFromDelta(delta) {
  validDelta(delta);
  return 1 - delta;
}

/** Outer horizon offset r_+/M - 1, in M units; delta = 1 - a/M. */
export function horizonOffset(delta) {
  validDelta(delta);
  return Math.sqrt(delta * (2 - delta));
}

/** Outer horizon Boyer-Lindquist radius in M units; delta = 1 - a/M. */
export function horizonRadius(delta) {
  return 1 + horizonOffset(delta);
}

/** Prograde equatorial photon-orbit offset r_ph/M - 1, in M units. */
export function photonOffset(delta) {
  validDelta(delta);
  // arccos(-a) = pi - theta, theta = 2 asin(sqrt(delta/2)). Expanding
  // cos(2pi/3 - 2theta/3) gives r_ph - 1 = 1 - cos(2theta/3) + sqrt(3) sin(2theta/3).
  const theta = 2 * Math.asin(Math.sqrt(delta / 2));
  return 2 * Math.sin(theta / 3) ** 2 + Math.sqrt(3) * Math.sin(2 * theta / 3);
}

/** Prograde equatorial photon-orbit Boyer-Lindquist radius in M units. */
export function photonOrbitRadius(delta) {
  return 1 + photonOffset(delta);
}

/** Prograde equatorial ISCO offset r_isco/M - 1, in M units. */
export function iscoOffset(delta) {
  validDelta(delta);
  const a = 1 - delta;
  const p = Math.cbrt(2 - delta);
  const q = Math.cbrt(delta);
  const eps = p * q * (p + q);
  const z2 = Math.sqrt(3 * a * a + (1 + eps) ** 2);
  // p^3 + q^3 = 2 and p^3 - q^3 = 2a, so eps = Z1 - 1 and
  // 3 - Z1 = 2 - eps = (p + q)(p - q)^2, p - q = 2a/(p^2 + pq + q^2).
  // Thus B below is the BPT square root, including the a = 0 endpoint.
  // Rationalizing 2 + Z2 - B gives [(2 + Z2)^2 - B^2]/(2 + Z2 + B).
  // With Z2^2 = 3a^2 + (1 + eps)^2, its numerator simplifies to
  // 2eps(2 + eps + Z2) - 3(1 - a^2), where 1 - a^2 = delta(2 - delta).
  const difference = 2 * a / (p * p + p * q + q * q);
  const b = difference * Math.sqrt((p + q) * (4 + eps + 2 * z2));
  return (2 * eps * (2 + eps + z2) - 3 * delta * (2 - delta)) / (2 + z2 + b);
}

/** Prograde equatorial ISCO Boyer-Lindquist radius in M units. */
export function iscoRadius(delta) {
  return 1 + iscoOffset(delta);
}

/**
 * Prograde equatorial circular orbit at r in M units (number or { offset: r/M - 1 }).
 * Returns omega in inverse M time units, dimensionless dt/dtau and ISCO stability.
 */
export function circularOrbit(r, delta) {
  validDelta(delta);
  const x = radiusOffset(r);
  if (x <= 0) throw new RangeError('A circular orbit must be outside r/M = 1.');
  const s = Math.sqrt(1 + x);
  // s^3 - 3s + 2 = (s - 1)^2(s + 2); (s - 1)(s + 1) = x.
  // Hence D = [x/(1 + s)]^2(s + 2) - 2delta avoids subtracting O(1) terms.
  const difference = x / (1 + s);
  const d = difference * difference * (s + 2) - 2 * delta;
  if (!Number.isFinite(d) || d <= 0) {
    throw new RangeError('No timelike circular orbit at or inside the photon orbit.');
  }
  const numerator = (1 + x) * s + 1 - delta;
  return {
    omega: 1 / numerator,
    dtdtau: numerator / (s * Math.sqrt(s) * Math.sqrt(d)),
    stable: typeof r === 'number' ? r >= iscoRadius(delta) : x >= iscoOffset(delta),
  };
}

/** Distant and orbiting-clock periods in M time units, at r in M units or { offset }. */
export function orbitPeriod(r, delta) {
  const { omega, dtdtau } = circularOrbit(r, delta);
  const home = 2 * Math.PI / omega;
  return { home, local: home / dtdtau };
}

/** Seconds per M time unit (GM/c^3) for a nonnegative mass in solar masses. */
export function secondsPerUnit(massSolar) {
  if (!Number.isFinite(massSolar) || massSolar < 0) {
    throw new RangeError('Mass must be finite and nonnegative.');
  }
  return (G * SOLAR_MASS / (C * C * C)) * massSolar;
}
