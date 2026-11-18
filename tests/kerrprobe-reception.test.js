import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { integrateProbe, probeImage, createKerrProbe, packKerrProbe, probeDropRefusal, assertReceptionOrder, unpackKerrProbe } from '../src/kerrprobe.js';

const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const close = (a, b, tolerance, label) => assert.ok(Math.abs(a - b) <= tolerance,
  `${label}: ${a} vs ${b}, error ${Math.abs(a - b)}, tolerance ${tolerance}`);
const evidence = { schwarzschild: [], kerr: [] };
const release = elevation => [Math.sin(25 * Math.PI / 180), Math.max(.18, Math.cos(25 * Math.PI / 180) * Math.sin(elevation)), Math.cos(25 * Math.PI / 180) * Math.cos(elevation)];

function integral(f, a, b, tolerance = 2e-11) {
  if (a === b) return 0;
  const recurse = (l, r, fl, fm, fr, whole, tol, depth) => {
    const mid = (l + r) / 2, lm = f((l + mid) / 2), rm = f((mid + r) / 2);
    const left = (mid - l) * (fl + 4 * lm + fm) / 6, right = (r - mid) * (fm + 4 * rm + fr) / 6;
    const error = left + right - whole;
    if (depth === 0 || Math.abs(error) <= 15 * tol) return left + right + error / 15;
    return recurse(l, mid, fl, lm, fm, left, tol / 2, depth - 1)
      + recurse(mid, r, fm, rm, fr, right, tol / 2, depth - 1);
  };
  const fa = f(a), fb = f(b), fm = f((a + b) / 2);
  return recurse(a, b, fa, fm, fb, (b - a) * (fa + 4 * fm + fb) / 6, tolerance, 22);
}

// Independent planar Schwarzschild shooting on b, with a square-root endpoint substitution.
function schwarzschildReception(position, event) {
  const rc = Math.hypot(...position), re = Math.hypot(...event.x), low = Math.min(rc, re), high = Math.max(rc, re);
  const cameraKS = [position[2], position[0], position[1]];
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(cameraKS, event.x) / (rc * re))));
  const f = r => 1 - 1 / r;
  const radial = (b, l, h, time, turn = false) => {
    if (l === h) return 0;
    const span = h - l;
    return integral(u => {
      const r = l + span * u * u;
      // At a turning point use the factored cubic to avoid subtracting nearly equal numbers.
      const W = turn ? (r - l) * (r * r + l * r - l * l / (l - 1)) / r ** 3 : 1 - b * b * f(r) / (r * r);
      const numerator = time ? 1 / f(r) : b / (r * r);
      if (u === 0 && turn) return 2 * Math.sqrt(span / ((2 * l - 3) / (l * (l - 1)))) * numerator;
      return 2 * span * u * numerator / Math.sqrt(Math.max(1e-300, W));
    }, 0, 1);
  };
  const bottleneck = Math.max(low, Math.min(high, 1.5)), limit = bottleneck / Math.sqrt(f(bottleneck));
  const maximum = radial(limit * (1 - 1e-10), low, high, false);
  let b, delay, sign;
  if (angle < maximum) {
    let lo = 0, hi = limit * (1 - 1e-12);
    for (let i = 0; i < 54; i++) {
      const mid = (lo + hi) / 2;
      if (radial(mid, low, high, false) < angle) lo = mid; else hi = mid;
    }
    b = (lo + hi) / 2; delay = radial(b, low, high, true); sign = Math.sign(rc - re);
  } else {
    assert.ok(low > 1.5, 'turning primary is outside the photon sphere');
    let lo = 1.5 + 1e-7, hi = low;
    for (let i = 0; i < 54; i++) {
      const turn = (lo + hi) / 2, impact = turn / Math.sqrt(f(turn));
      const phi = radial(impact, turn, rc, false, true) + radial(impact, turn, re, false, true);
      if (phi > angle) lo = turn; else hi = turn;
    }
    const turn = (lo + hi) / 2; b = turn / Math.sqrt(f(turn));
    delay = radial(b, turn, rc, true, true) + radial(b, turn, re, true, true); sign = -1;
  }
  const E = Math.sqrt(6 / 7), ur = -Math.sqrt(Math.max(0, E * E - f(re)));
  const g = f(re) / (Math.sqrt(f(rc)) * (E - sign * ur * Math.sqrt(Math.max(0, 1 - b * b * f(re) / (re * re)))));
  return { delay: delay - Math.log(rc - 1) + Math.log(re - 1), g, sign, b };
}

test('close zero-spin reception matches independent planar b quadrature across the camera radius', () => {
  for (const elevation of [0, .8]) {
    const history = integrateProbe({ spin: 0, direction: release(elevation) });
    for (const radius of [3, 1.5]) {
      const position = [0, radius * Math.sin(elevation), radius * Math.cos(elevation)];
      for (const target of [7, (7 + radius) / 2, radius * 1.01, radius * .99, (radius + 1) / 2, 1.04]) {
        const event = history.reduce((a, b) => Math.abs(a.radius - target) < Math.abs(b.radius - target) ? a : b);
        const expected = schwarzschildReception(position, event), image = probeImage(position, 0, event);
        const row = { radius, elevation, emissionRadius: event.radius, timeError: image.delay - expected.delay, gError: image.g - expected.g, sign: expected.sign };
        evidence.schwarzschild.push(row);
        close(event.t + image.delay, event.t + expected.delay, 1e-4, JSON.stringify(row));
        close(image.g, expected.g, 1e-5, JSON.stringify(row));
      }
    }
  }
});

test('every close camera is admitted and its actual fixed ZAMO sees the release blueshift', () => {
  for (const radius of [1.1, 1.5, 3, 5, 6.9, 7]) for (const spin of [0, .9, .998]) {
    assert.equal(probeDropRefusal([0, 0, radius], spin), null);
  }
  const probe = createKerrProbe({ position: [0, 0, 3], direction: release(0), spin: 0 });
  assert.equal(probe.state, 'falling');
  close(probe.signal, Math.sqrt((1 - 1 / 7) / (1 - 1 / 3)), 1e-10, 'unclamped release blueshift');
  const rows = packKerrProbe(probe).data.timeline;
  assert.ok(rows.every((row, i) => !i || (row.t > rows[i - 1].t && row.arrival > rows[i - 1].arrival)));
});

test('a later image that reverses arrival order is a solve error, including at the worker boundary', () => {
  const rows = [{ t: 0, arrival: 5 }, { t: 1, arrival: 4 }];
  assert.throws(() => assertReceptionOrder(rows), /reception must be causal/);
  assert.throws(() => unpackKerrProbe({ probe: {}, data: { timeline: rows } }), /reception must be causal/);
  assert.throws(() => assertReceptionOrder([{ t: 0, arrival: 2 }, { t: 1, arrival: 2 }]), RangeError);
  assert.doesNotThrow(() => assertReceptionOrder([{ t: 0, arrival: 2 }, { t: 1, arrival: 3 }]));
});

test('only a release within the finite KS hull size refuses a geometrically overlapping receiver', () => {
  for (const spin of [0, .9, .998]) {
    const result = createKerrProbe({ position: [0, 0, 7], direction: [0, 0, 1], spin });
    assert.equal(result.state, 'refused'); assert.match(result.notice, /hull size/);
    assert.equal(probeDropRefusal([0, 0, 7.1], spin, [0, 0, 1])?.includes('hull size'), true);
    assert.equal(probeDropRefusal([0, 0, 7.2], spin, [0, 0, 1]), null);
  }
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => probeDropRefusal([0, 0, 3], .9, [value, 0, 1]), RangeError);
    assert.throws(() => createKerrProbe({ position: [0, value, 3], spin: .9 }), RangeError);
  }
});

// Separated BL Hamiltonian; no KS metric, ray step, frame or momentum from production.
function blReception(position, spin, event) {
  const a = spin / 2, rp = .5 + Math.sqrt(.25 - a * a), rm = 1 - rp;
  const rc = Math.hypot(...position), re = event.radius, theta = Math.acos(position[1] / rc);
  const offset = r => a / (rp - rm) * Math.log((r - rp) / (r - rm)) + Math.atan(a / r);
  const T = r => (rp * Math.log(r - rp) - rm * Math.log(r - rm)) / (rp - rm);
  const phi = Math.atan2(position[0], position[2]) + offset(rc);
  const targetTheta = Math.acos(event.x[2] / re), targetPhi = Math.atan2(event.x[1], event.x[0]) + offset(re);
  const Sigma = rc * rc + a * a * Math.cos(theta) ** 2, Delta = rc * rc - rc + a * a;
  const A = (rc * rc + a * a) ** 2 - a * a * Delta * Math.sin(theta) ** 2;
  const alpha = Math.sqrt(Sigma * Delta / A), omega = a * rc / A;
  const wrap = v => Math.atan2(Math.sin(v), Math.cos(v));
  const unit = v => v.map(q => q / Math.hypot(...v));
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const flow = (s, pt, L) => {
    const [, r, th, , pr, pth] = s, st = Math.sin(th), ct = Math.cos(th);
    const D = r * r - r + a * a, S = r * r + a * a * ct * ct;
    const P = (r * r + a * a) * pt + a * L, B = L / st + a * pt * st;
    const H = (D * pr * pr + pth * pth - P * P / D + B * B) / (2 * S);
    return [(-P * (r * r + a * a) / D + a * st * B) / S, D * pr / S, pth / S,
      (-a * P / D + B / st) / S,
      -((2 * r - 1) * pr * pr - 4 * r * pt * P / D + P * P * (2 * r - 1) / (D * D)) / (2 * S) + 2 * r * H / S,
      -B * (-L * ct / (st * st) + a * pt * ct) / S - 2 * a * a * ct * st * H / S];
  };
  const trace = (n, length) => {
    const L = Math.sqrt(A / Sigma) * Math.sin(theta) * n[2], pt = alpha - omega * L;
    let s = [0, rc, theta, phi, Math.sqrt(Sigma / Delta) * n[0], Math.sqrt(Sigma) * n[1]], affine = 0;
    for (let i = 0; i < 20000 && affine < length; i++) {
      if (s[1] <= rp + 1e-7) return null;
      const h = Math.min(length - affine, .006 * (s[1] - rp));
      const stage = (v, scale) => s.map((q, j) => q + scale * v[j]);
      const k1 = flow(s, pt, L), k2 = flow(stage(k1, h / 2), pt, L), k3 = flow(stage(k2, h / 2), pt, L), k4 = flow(stage(k3, h), pt, L);
      s = s.map((q, j) => q + h / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])); affine += h;
    }
    return { s, pt, L };
  };
  const residual = ray => [ray.s[1] - re, re * (ray.s[2] - targetTheta), re * Math.sin(targetTheta) * wrap(ray.s[3] - targetPhi)];
  const dphi = wrap(targetPhi - phi);
  let n = unit([re * Math.cos(theta) * Math.cos(targetTheta) + re * Math.sin(theta) * Math.sin(targetTheta) * Math.cos(dphi) - rc,
    re * (Math.cos(theta) * Math.sin(targetTheta) * Math.cos(dphi) - Math.sin(theta) * Math.cos(targetTheta)), re * Math.sin(targetTheta) * Math.sin(dphi)]);
  let length = Math.hypot(...event.x.map((v, i) => v - [position[2], position[0], position[1]][i]));
  let ray;
  for (let iteration = 0; iteration < 16; iteration++) {
    ray = trace(n, length); assert.ok(ray, 'BL ray reaches the endpoint');
    const f = residual(ray), error = Math.hypot(...f);
    if (error < 1e-9) break;
    const e1 = unit(Math.abs(n[0]) > .7 ? [-n[1], n[0], 0] : [0, -n[2], n[1]]), e2 = cross(n, e1), eps = 1e-6;
    const jacobian = [e1, e2].map(e => residual(trace(unit(n.map((v, j) => v + eps * e[j])), length)).map((v, j) => (v - f[j]) / eps));
    jacobian.push(residual(trace(n, length + eps)).map((v, j) => (v - f[j]) / eps));
    const [u, v, w] = jacobian, det = dot(u, cross(v, w));
    const step = [dot(f, cross(v, w)), dot(u, cross(f, w)), dot(u, cross(v, f))].map(q => q / det);
    let accepted = false;
    for (let damping = 1; damping > 1 / 1024; damping /= 2) {
      const nextN = unit(n.map((q, j) => q - damping * (step[0] * e1[j] + step[1] * e2[j]))), nextL = length - damping * step[2];
      const candidate = nextL > 0 && trace(nextN, nextL);
      if (candidate && Math.hypot(...residual(candidate)) < error) { n = nextN; length = nextL; accepted = true; break; }
    }
    assert.ok(accepted, `independent BL shooting converges: ${error}`);
  }
  assert.ok(Math.hypot(...residual(ray)) < 1e-8, 'independent BL spatial endpoint');
  const x = event.x, u = event.u, D = 2 * re * re - dot(x, x) + a * a;
  const ur = dot([re * x[0] / D, re * x[1] / D, x[2] * (re * re + a * a) / (re * D)], u.slice(1));
  const deltaE = re * re - re + a * a;
  const ut = u[0] + re / deltaE * ur;
  const uth = (Math.cos(targetTheta) * ur - u[3]) / (re * Math.sin(targetTheta));
  const uphi = (x[0] * u[2] - x[1] * u[1]) / (x[0] ** 2 + x[1] ** 2) + (a / deltaE - a / (re * re + a * a)) * ur;
  return { delay: -ray.s[0] + T(re) - T(rc), g: 1 / (ray.pt * ut + ray.s[4] * ur + ray.s[5] * uth + ray.L * uphi) };
}

test('close spinning reception matches an independent BL null Hamiltonian before and after crossing', () => {
  const elevation = .23, position = [0, 3 * Math.sin(elevation), 3 * Math.cos(elevation)];
  for (const spin of [.9, .998]) {
    const history = integrateProbe({ spin, direction: release(elevation) });
    for (const radius of [7, 4, 3.05, 2.5, 1.5]) {
      const event = history.reduce((a, b) => Math.abs(a.radius - radius) < Math.abs(b.radius - radius) ? a : b);
      const expected = blReception(position, spin, event), image = probeImage(position, spin, event);
      const row = { spin, radius: event.radius, timeError: image.delay - expected.delay, gError: image.g - expected.g };
      evidence.kerr.push(row);
      close(image.delay, expected.delay, 1e-4, JSON.stringify(row));
      close(image.g, expected.g, 1e-5, JSON.stringify(row));
    }
  }
});

test('two converged physical image roots select the earliest BL-verified reception', () => {
  const spin = .998, position = [0, 5, 23], history = integrateProbe({ spin, direction: [.4, .23, .9] });
  const event = history.reduce((a, b) => Math.abs(a.radius - 3) < Math.abs(b.radius - 3) ? a : b);
  const expected = blReception(position, spin, event);
  // Seeds for the direct image and a once-winding image of the same emission event.
  const seeds = [{ direction: [-.9971512897, -.0060595038, .0751836945], affine: 21.31184795 },
    { direction: [-.9986849394, -.0050207011, -.0510214101], affine: 28.50899839 }];
  const image = probeImage(position, spin, event, undefined, seeds);
  close(image.delay, expected.delay, 1e-4, 'earliest physical image reception');
  close(image.g, expected.g, 1e-5, 'earliest physical image frequency');
});

test.after(() => {
  mkdirSync(new URL('../tmp/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../tmp/kerr-probe-reception.json', import.meta.url), JSON.stringify(evidence, null, 2));
});
