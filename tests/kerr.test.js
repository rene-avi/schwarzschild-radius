import test from 'node:test';
import assert from 'node:assert/strict';
import { G, C, SOLAR_MASS } from '../src/physics.js';
import {
  mToRs, rsToM, spinFromDelta, horizonOffset, horizonRadius, photonOffset,
  photonOrbitRadius, iscoOffset, iscoRadius, circularOrbit, orbitPeriod, secondsPerUnit,
} from '../src/kerr.js';

function relative(actual, expected, tolerance = 1e-9, label = '') {
  const error = Math.abs(actual / expected - 1);
  assert.ok(Number.isFinite(error) && error <= tolerance,
    `${label}: ${actual} vs ${expected}, relative error ${error} > ${tolerance}`);
}

// Independent reference: 80 decimal places, exact binary64 inputs, polynomial
// root bisection for ISCO/photon radii, and four-velocity metric normalization.
// It uses neither BPT/rationalized offsets nor the factored double radicand.
// Direct high-precision subtraction retains over 60 digits even near extremality.
const SCALE = 10n ** 80n;
const bits = new DataView(new ArrayBuffer(8));
const mul = (a, b) => a * b / SCALE;
const div = (a, b) => a * SCALE / b;
const asNumber = value => Number(value) / Number(SCALE);

function fixed(value) {
  assert.ok(Number.isFinite(value));
  bits.setFloat64(0, value);
  const raw = bits.getBigUint64(0);
  const exponent = Number((raw >> 52n) & 0x7ffn);
  const fraction = raw & ((1n << 52n) - 1n);
  const significand = exponent === 0 ? fraction : fraction + (1n << 52n);
  const shift = exponent === 0 ? -1074 : exponent - 1023 - 52;
  const magnitude = shift >= 0 ? (significand * SCALE) << BigInt(shift)
    : (significand * SCALE) >> BigInt(-shift);
  return raw >> 63n ? -magnitude : magnitude;
}

function integerSqrt(value) {
  assert.ok(value >= 0n);
  if (value < 2n) return value;
  let x = 1n << BigInt(Math.ceil(value.toString(2).length / 2));
  for (;;) {
    const next = (x + value / x) / 2n;
    if (next >= x) return x;
    x = next;
  }
}

const sqrt = value => integerSqrt(value * SCALE);

function root(polynomial, lower, upper) {
  assert.ok(polynomial(lower) <= 0n && polynomial(upper) >= 0n);
  while (upper - lower > 1n) {
    const middle = (lower + upper) / 2n;
    if (polynomial(middle) > 0n) upper = middle;
    else lower = middle;
  }
  return (lower + upper) / 2n;
}

function referenceRadii(delta) {
  const a = SCALE - fixed(delta);
  const a2 = mul(a, a);
  const sIsco = root(s => {
    const s2 = mul(s, s);
    return mul(s2, s2) - 6n * s2 + 8n * mul(a, s) - 3n * a2;
  }, SCALE, 3n * SCALE);
  const sPhoton = root(s => mul(mul(s, s), s) - 3n * s + 2n * a,
    SCALE, 2n * SCALE);
  return {
    horizon: sqrt(SCALE - a2),
    photon: mul(sPhoton, sPhoton) - SCALE,
    isco: mul(sIsco, sIsco) - SCALE,
  };
}

function referenceOrbit(radius, delta) {
  const r = typeof radius === 'number' ? fixed(radius) : SCALE + fixed(radius.offset);
  const a = SCALE - fixed(delta);
  const a2 = mul(a, a);
  const omega = div(SCALE, mul(r, sqrt(r)) + a);
  const gtt = -SCALE + div(2n * SCALE, r);
  const gtphi = -div(2n * a, r);
  const gphiphi = mul(r, r) + a2 + div(2n * a2, r);
  const norm = gtt + 2n * mul(gtphi, omega) + mul(gphiphi, mul(omega, omega));
  assert.ok(norm < 0n, 'reference four-velocity must be timelike');
  return { omega: asNumber(omega), dtdtau: asNumber(div(SCALE, sqrt(-norm))) };
}

const deltas = [...new Set([
  ...Array.from({ length: 57 }, (_, i) => 10 ** (-i / 4)),
  ...Array.from({ length: 12 }, (_, i) => 1 - 10 ** (-i - 1)),
  1.3e-14,
])].sort((a, b) => a - b);

test('Kerr unit converters and solar-mass time scale use explicit M and r_s units', () => {
  for (const r of [0, 1e-20, 1, 2, 6, 1000]) {
    assert.equal(mToRs(r), r / 2);
    assert.equal(rsToM(r), 2 * r);
    assert.equal(rsToM(mToRs(r)), r);
  }
  assert.equal(mToRs({ offset: 5 }), 3);
  assert.equal(rsToM({ offset: 2 }), 6);
  assert.equal(mToRs({ offset: -1 }), 0);
  assert.equal(secondsPerUnit(0), 0);
  for (const mass of [1, 10, 4_300_000, 100_000_000]) {
    relative(secondsPerUnit(mass), G * SOLAR_MASS * mass / C ** 3, 1e-15);
    relative(secondsPerUnit(mass) / secondsPerUnit(1), mass, 1e-15);
  }
  relative(secondsPerUnit(1), 4.925639893961039e-6, 1e-12);
  for (const delta of deltas) assert.equal(spinFromDelta(delta), 1 - delta);
});

test('Schwarzschild limit gives circular-orbit clocks and ISCO at 3 r_s', () => {
  relative(horizonRadius(1), 2, 1e-12);
  relative(photonOrbitRadius(1), 3, 1e-12);
  relative(iscoRadius(1), 6, 1e-12);
  relative(mToRs(iscoRadius(1)), 3, 1e-12);
  for (const r of [3.1, 4, 6, 10, 100, 1000]) {
    for (const radius of [r, { offset: r - 1 }]) {
      const orbit = circularOrbit(radius, 1);
      relative(orbit.omega, r ** -1.5, 1e-12);
      relative(orbit.dtdtau, 1 / Math.sqrt(1 - 3 / r), 1e-12);
      relative(orbit.dtdtau, 1 / Math.sqrt(1 - 1.5 / mToRs(r)), 1e-12);
      assert.equal(orbit.stable, r >= iscoRadius(1));
    }
  }
});

test('offsets agree with independent 80-place polynomial roots across both spin endpoints', () => {
  for (const delta of deltas) {
    const reference = referenceRadii(delta);
    for (const [name, calculate] of [
      ['horizon', horizonOffset], ['photon', photonOffset], ['isco', iscoOffset],
    ]) {
      relative(calculate(delta), asNumber(reference[name]), 1e-9, `${name}, delta=${delta}`);
    }
    assert.equal(horizonRadius(delta), 1 + horizonOffset(delta));
    assert.equal(photonOrbitRadius(delta), 1 + photonOffset(delta));
    assert.equal(iscoRadius(delta), 1 + iscoOffset(delta));
  }
});

test('orbit frequency and clocks agree with independent 80-place metric normalization through r=1000', () => {
  for (const delta of deltas) {
    const inner = iscoOffset(delta);
    const offsets = [inner, ...Array.from({ length: 17 }, (_, i) =>
      inner * (999 / inner) ** ((i + 1) / 17)), 999];
    for (const offset of offsets) {
      for (const radius of [{ offset }, 1 + offset]) {
        const orbit = circularOrbit(radius, delta);
        const reference = referenceOrbit(radius, delta);
        const label = `delta=${delta}, radius=${JSON.stringify(radius)}`;
        relative(orbit.omega, reference.omega, 1e-9, `omega, ${label}`);
        relative(orbit.dtdtau, reference.dtdtau, 1e-9, `dt/dtau, ${label}`);
        assert.equal(orbit.stable, true, label);
      }
    }
  }
});

test('explicit offsets retain information lost when forming a Number radius', () => {
  const delta = 1e-14;
  const offset = 1e-5;
  assert.notEqual(fixed(1 + offset), SCALE + fixed(offset));
  for (const radius of [1 + offset, { offset }]) {
    const orbit = circularOrbit(radius, delta);
    const reference = referenceOrbit(radius, delta);
    relative(orbit.dtdtau, reference.dtdtau, 1e-9);
    relative(orbit.omega, reference.omega, 1e-9);
    assert.equal(orbit.stable, false);
  }
  const threshold = iscoOffset(delta);
  const justBelow = threshold * (1 - Number.EPSILON);
  assert.ok(justBelow < threshold);
  assert.equal(1 + justBelow, iscoRadius(delta));
  assert.equal(circularOrbit({ offset: justBelow }, delta).stable, false);
  assert.equal(circularOrbit(1 + justBelow, delta).stable, true);
});

test('photon boundary rejects spacelike orbits and accepts unstable timelike orbits on either radius path', () => {
  for (const delta of deltas) {
    const photon = photonOffset(delta);
    for (const wrap of [offset => ({ offset }), offset => 1 + offset]) {
      const below = wrap(photon * (1 - 1e-6));
      assert.throws(() => circularOrbit(below, delta), RangeError);
      assert.throws(() => orbitPeriod(below, delta), RangeError);
      const above = wrap(photon * (1 + 1e-6));
      const orbit = circularOrbit(above, delta);
      assert.ok(Number.isFinite(orbit.dtdtau) && orbit.dtdtau > 1);
      assert.equal(orbit.stable, false);
      assert.equal(circularOrbit(wrap((photon + iscoOffset(delta)) / 2), delta).stable, false);
    }
    assert.equal(circularOrbit(iscoRadius(delta), delta).stable, true);
    assert.equal(circularOrbit({ offset: iscoOffset(delta) }, delta).stable, true);
    assert.equal(circularOrbit(iscoRadius(delta) * (1 - 1e-10), delta).stable, false);
    assert.equal(circularOrbit({ offset: iscoOffset(delta) * (1 - 1e-10) }, delta).stable, false);
  }
});

test('orbit periods follow distant and onboard clocks and share the metric reference', () => {
  for (const delta of [1, 0.1, 1e-8, 1e-14]) {
    for (const radius of [iscoRadius(delta), { offset: iscoOffset(delta) }, 10, { offset: 999 }]) {
      const orbit = circularOrbit(radius, delta);
      const reference = referenceOrbit(radius, delta);
      const { home, local } = orbitPeriod(radius, delta);
      relative(home, 2 * Math.PI / reference.omega, 1e-9);
      relative(local, 2 * Math.PI / reference.omega / reference.dtdtau, 1e-9);
      relative(home / local, orbit.dtdtau, 1e-15);
      relative(home * orbit.omega, 2 * Math.PI, 1e-15);
      assert.ok(home > local && local > 0);
    }
  }
});

test('near-extremal ISCO and clock approach the derived leading and first-order limits', () => {
  const delta = 1e-14;
  const t = Math.cbrt(4 * delta);
  relative(horizonOffset(delta), Math.sqrt(2 * delta), 1e-12);
  relative(iscoOffset(delta), t, 1e-4);
  // The ISCO polynomial gives x = t + 7t^2/8 + O(t^3), t = (4delta)^(1/3).
  // D = 3x^2/4 - x^3/4 - 2delta + O(x^4), so u^t = 4/(sqrt(3)t)
  // times (1 - 3t/8 + O(t^2)); multiplying by delta^(1/3) gives C = 2^(4/3)/sqrt(3).
  const coefficient = 2 ** (4 / 3) / Math.sqrt(3);
  for (const radius of [iscoRadius(delta), { offset: iscoOffset(delta) }]) {
    const scaledClock = circularOrbit(radius, delta).dtdtau * Math.cbrt(delta);
    relative(scaledClock, coefficient, 1e-4);
    relative(scaledClock, coefficient * (1 - 3 * t / 8), 1e-8);
  }
});

function orderedOffsets(delta) {
  const values = [horizonOffset(delta), photonOffset(delta), iscoOffset(delta)];
  assert.ok(values[0] > 0 && values[0] < values[1] && values[1] < values[2],
    `horizon < photon < ISCO at delta=${delta}: ${values}`);
  assert.ok(horizonRadius(delta) < photonOrbitRadius(delta)
    && photonOrbitRadius(delta) < iscoRadius(delta));
  return values;
}

test('all characteristic radii decrease strictly on the a=0,0.001,...,0.999 grid', () => {
  let previous = orderedOffsets(1);
  for (let i = 1; i <= 999; i++) {
    const values = orderedOffsets(1 - i / 1000);
    values.forEach((value, j) => assert.ok(value < previous[j], `spin index=${i}, radius=${j}`));
    previous = values;
  }
});

test('all characteristic offsets increase strictly on the full 10^0.001 delta grid', () => {
  let previous = orderedOffsets(1e-14);
  for (let i = 1; i <= 14000; i++) {
    const delta = 10 ** (-14 + i / 1000);
    const values = orderedOffsets(delta);
    values.forEach((value, j) => assert.ok(value > previous[j], `delta=${delta}, radius=${j}`));
    previous = values;
  }
});

test('orbital dt/dtau decreases strictly from the ISCO to r=1000 for several spins', () => {
  for (const delta of [1, 0.999, 0.5, 1e-2, 1e-8, 1e-14]) {
    const inner = iscoOffset(delta);
    for (const wrap of [offset => ({ offset }), offset => 1 + offset]) {
      let previous = circularOrbit(wrap(inner), delta).dtdtau;
      for (let i = 1; i <= 256; i++) {
        const offset = i === 256 ? 999 : inner * (999 / inner) ** (i / 256);
        const orbit = circularOrbit(wrap(offset), delta);
        assert.ok(orbit.stable && orbit.dtdtau < previous, `delta=${delta}, offset=${offset}`);
        previous = orbit.dtdtau;
      }
    }
  }
});

test('invalid spin, radius and mass inputs fail with RangeError', () => {
  for (const delta of [0, -1e-14, 1.001, NaN, Infinity, -Infinity, '0.1', null, undefined]) {
    for (const calculate of [spinFromDelta, horizonOffset, horizonRadius, photonOffset,
      photonOrbitRadius, iscoOffset, iscoRadius]) {
      assert.throws(() => calculate(delta), RangeError);
    }
    assert.throws(() => circularOrbit(10, delta), RangeError);
    assert.throws(() => orbitPeriod({ offset: 9 }, delta), RangeError);
  }
  for (const radius of [0, -1, 0.5, 1, NaN, Infinity, -Infinity, '10', null, undefined,
    {}, [], { offset: NaN }, { offset: Infinity }, { offset: '5' }, { offset: 0 }, { offset: -1 },
    1e308, { offset: 1e308 }]) {
    assert.throws(() => circularOrbit(radius, 1e-14), RangeError);
    assert.throws(() => orbitPeriod(radius, 1e-14), RangeError);
  }
  for (const radius of [-1, NaN, Infinity, '6', null, {}, { offset: -2 }, { offset: NaN }]) {
    assert.throws(() => mToRs(radius), RangeError);
    assert.throws(() => rsToM(radius), RangeError);
  }
  for (const mass of [-1, NaN, Infinity, -Infinity, '1', null, undefined]) {
    assert.throws(() => secondsPerUnit(mass), RangeError);
  }
});

test('print illustrative ISCO clock values without a film-derived target', () => {
  const yearHours = 365.25 * 24;
  console.log(`Leading coefficient C = ${2 ** (4 / 3) / Math.sqrt(3)}`);
  console.log('| delta | a (display) | r_+ (M) | r_isco (M) | r_isco - 1 (M) | dt/dtau at ISCO | distant years / local hour |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const delta of [1, 1e-2, 1e-4, 1e-8, 1e-12, 1.3e-14, 1e-14]) {
    const offset = iscoOffset(delta);
    const { dtdtau } = circularOrbit({ offset }, delta);
    const values = [delta, spinFromDelta(delta), horizonRadius(delta), iscoRadius(delta),
      offset, dtdtau, dtdtau / yearHours];
    console.log(`| ${values.map(value => value.toPrecision(16)).join(' | ')} |`);
  }
});
