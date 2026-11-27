import { iscoRadius } from './kerr.js';
import { escapeAngle } from './geodesic.js';

// Outgoing Kerr-Schild coordinates, r_s = 1, M = 1/2; no weak-field bypass.
export const KERR_RAY = Object.freeze({
  mass: 0.5, epsilon: 0.0005, outerRadius: 256, minimumCamera: 1.1,
  highSteps: 3072, balancedSteps: 2304, performanceSteps: 1536,
  highC: 0.06, balancedC: 0.09, performanceC: 0.14, stepBound: 8,
});

function spinValue(spin) {
  if (!Number.isFinite(spin) || spin < 0 || spin > 0.998) throw new RangeError('Picture spin must be in [0, 0.998].');
  return spin * KERR_RAY.mass;
}
function vector(value) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)
    || !Number.isFinite(Math.hypot(...value))) throw new RangeError('Expected a finite three-vector.');
  return value;
}
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const norm = v => v.map(x => x / Math.hypot(...v));
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
export function horizon(spin) { const a = spinValue(spin); return 0.5 + Math.sqrt(0.25 - a * a); }
export function diskInnerRadius(spin) { spinValue(spin); return iscoRadius(1 - spin) / 2; }
export function pictureSpin(delta) {
  if (!Number.isFinite(delta) || delta <= 0 || delta > 1) throw new RangeError('Spin delta must be in (0, 1].');
  return 1 - Math.max(delta, 0.002);
}

/** ZAMO dτ/dt at a scene BL position in r_s units, using the full clock spin. */
export function zamoClockRate(position, delta) {
  vector(position);
  if (!Number.isFinite(delta) || delta <= 0 || delta > 1) throw new RangeError('Spin delta must be in (0, 1].');
  const r = Math.hypot(...position), a = (1 - delta) / 2;
  const Delta = (r - 0.5) ** 2 - 0.25 * delta * (2 - delta);
  if (r <= 0.5 || Delta <= 0) throw new RangeError('Clock must be outside the horizon.');
  const ct = position[1] / r, sigma = r * r + a * a * ct * ct;
  const A = (r * r + a * a) ** 2 - a * a * Delta * (1 - ct * ct);
  return Math.sqrt(Delta * sigma / A);
}

function radiusAt(x, a) {
  const q = dot(x, x) - a * a;
  return Math.sqrt((q + Math.sqrt(q * q + 4 * a * a * x[2] * x[2])) / 2);
}
export function blRadius(position, spin) { return radiusAt(vector(position), spinValue(spin)); }

function geometry(x, a) {
  const r = radiusAt(x, a), s = r * r + a * a;
  const d = 2 * r * r - dot(x, x) + a * a;
  const dr = [r * x[0] / d, r * x[1] / d, x[2] * s / (r * d)];
  const l = [1, -(r * x[0] - a * x[1]) / s, -(r * x[1] + a * x[0]) / s, -x[2] / r];
  const f = r * r * r / (r ** 4 + a * a * x[2] * x[2]);
  const inner = (u, v) => -u[0] * v[0] + dot(u.slice(1), v.slice(1)) + f * dot(l, u) * dot(l, v);
  const lower = v => [-v[0], ...v.slice(1)].map((t, i) => t + f * l[i] * dot(l, v));
  const raiseGradient = grad => {
    const q = dot(l.slice(1), grad);
    return [f * q, ...grad.map((v, i) => v - f * l[i + 1] * q)];
  };
  return { r, s, dr, l, f, inner, lower, raiseGradient };
}

/** Scene spherical position is a BL point; local directions are (outward r, increasing theta, increasing phi). */
export function observerFrame(position, spin) {
  vector(position);
  const a = spinValue(spin), r = Math.hypot(...position);
  if (!(r > horizon(spin) + KERR_RAY.epsilon)) throw new RangeError('Camera must be outside the past horizon.');
  const ct = position[1] / r, st = Math.hypot(position[0], position[2]) / r;
  const phi = Math.atan2(position[0], position[2]), cp = Math.cos(phi), sp = Math.sin(phi);
  const x = [Math.sqrt(r * r + a * a) * st * cp, Math.sqrt(r * r + a * a) * st * sp, r * ct];
  const g = geometry(x, a);
  const axial = [0, -x[1], x[0], 0];
  const omega = st > 1e-10 ? -g.inner([1, 0, 0, 0], axial) / g.inner(axial, axial) : 0;
  let u = [1, -omega * x[1], omega * x[0], 0];
  u = u.map(v => v / Math.sqrt(-g.inner(u, u)));
  let er = g.raiseGradient(g.dr);
  er = er.map(v => v / Math.sqrt(g.inner(er, er)));
  let et = st > 1e-10 ? g.raiseGradient(g.dr.map((v, i) => (ct * v - Number(i === 2)) / (r * st)))
    : [0, ct * cp, ct * sp, 0];
  const projection = g.inner(et, er);
  et = et.map((v, i) => v - projection * er[i]);
  et = et.map(v => v / Math.sqrt(g.inner(et, et)));
  let ep = st > 1e-10 ? axial : [0, -sp, cp, 0];
  ep = ep.map(v => v / Math.sqrt(g.inner(ep, ep)));
  return { position: x, u, er, et, ep, covectors: [u, er, et, ep].map(g.lower), omega, ut: u[0],
    sceneBasis: [norm(position), [ct * sp, -st, ct * cp], [cp, 0, -sp]] };
}

// A scalar instruction graph emits both GLSL and the double/float32 arithmetic kernels.
const graph = [];
function op(kind, a, b) { const id = `k${graph.length}`; graph.push({ id, kind, a, b }); return id; }
const add = (a, b) => op('+', a, b), sub = (a, b) => op('-', a, b);
const mul = (a, b) => op('*', a, b), div = (a, b) => op('/', a, b), sqrt = a => op('sqrt', a);
const sum = terms => terms.reduce(add), sq = x => mul(x, x);
function makeFlow() {
  const x = ['x.x', 'x.y', 'x.z'], p = ['p.x', 'p.y', 'p.z'];
  const a2 = sq('a'), z2 = sq(x[2]);
  const q = sub(sum(x.map(sq)), a2), D = sqrt(add(sq(q), mul(mul(4, a2), z2)));
  const r2 = mul(0.5, add(q, D)), r = sqrt(r2), s = add(r2, a2);
  const dr = [div(mul(r, x[0]), D), div(mul(r, x[1]), D), div(mul(x[2], s), mul(r, D))];
  const numer = [sub(mul(r, x[0]), mul('a', x[1])), add(mul(r, x[1]), mul('a', x[0]))];
  const l = [div(sub(0, numer[0]), s), div(sub(0, numer[1]), s), div(sub(0, x[2]), r)];
  const den = add(sq(r2), mul(a2, z2)), f = div(mul(r2, r), den);
  const lp = sub(sum(l.map((v, i) => mul(v, p[i]))), 'pt');
  const dx = p.map((v, i) => sub(v, mul(mul(f, l[i]), lp)));
  const dp = dr.map((d, axis) => {
    const dn = [sub(add(mul(d, x[0]), mul(r, Number(axis === 0))), mul('a', Number(axis === 1))),
      add(add(mul(d, x[1]), mul(r, Number(axis === 1))), mul('a', Number(axis === 0)))];
    const dl = dn.map((v, i) => add(div(sub(0, v), s), div(mul(mul(numer[i], mul(2, r)), d), sq(s))));
    dl.push(add(div(-Number(axis === 2), r), div(mul(x[2], d), r2)));
    const df = mul(f, sub(div(mul(3, d), r), div(add(mul(mul(4, mul(r2, r)), d), mul(mul(2, a2), mul(x[2], Number(axis === 2)))), den)));
    return add(mul(mul(0.5, df), sq(lp)), mul(mul(f, lp), sum(dl.map((v, i) => mul(v, p[i])))));
  });
  return { dx, dp, dt: add(sub(0, 'pt'), mul(f, lp)) };
}
const outputs = makeFlow();
const expression = (row, ref = v => v) => row.kind === 'sqrt' ? `sqrt(${ref(row.a)})` : `${ref(row.a)} ${row.kind} ${ref(row.b)}`;
const jsSource = rounded => {
  const ref = v => String(v);
  const rows = graph.map(row => `const ${row.id} = ${rounded ? `F(${expression(row, ref)})` : expression(row, ref)};`).join('\n');
  return `const sqrt = ${rounded ? 'v => F(Math.sqrt(v))' : 'Math.sqrt'};\n${rows}\nreturn {dx:[${outputs.dx}],dp:[${outputs.dp}],dt:${outputs.dt}};`;
};
let flow64, flow32;
const named = v => ({ x: v[0], y: v[1], z: v[2] });
function flow(state, a, f32) {
  // The default picture imports this module without compiling any dynamic code.
  if (f32) flow32 ??= new Function('x', 'p', 'pt', 'a', 'F', jsSource(true));
  else flow64 ??= new Function('x', 'p', 'pt', 'a', jsSource(false));
  return f32 ? flow32(named(state.x), named(state.p), state.pt, a, Math.fround)
    : flow64(named(state.x), named(state.p), state.pt, a);
}

function rkStep(state, a, h, f32) {
  const F = f32 ? Math.fround : v => v;
  const advance = (v, d, step) => v.map((t, i) => F(t + F(d[i] * step)));
  const stage = (d, step) => ({ x: advance(state.x, d.dx, step), p: advance(state.p, d.dp, step), pt: state.pt });
  const d1 = flow(state, a, f32), half = F(h * 0.5);
  const d2 = flow(stage(d1, half), a, f32), d3 = flow(stage(d2, half), a, f32), d4 = flow(stage(d3, h), a, f32);
  const finish = (v, key) => v.map((t, i) => F(t + F(F(h / 6) * F(F(F(d1[key][i] + F(2 * d2[key][i])) + F(2 * d3[key][i])) + d4[key][i]))));
  const t = F((state.t ?? 0) + F(F(h / 6) * F(F(F(d1.dt + F(2 * d2.dt)) + F(2 * d3.dt)) + d4.dt)));
  return { x: finish(state.x, 'dx'), p: finish(state.p, 'dp'), pt: state.pt, t };
}

export function kerrVelocity(state, spin) {
  vector(state.x); vector(state.p);
  if (!Number.isFinite(state.pt)) throw new RangeError('Momentum must be finite.');
  const d = flow(state, spinValue(spin), false);
  return [d.dt, ...d.dx];
}

export function kerrStep(state, spin, h) {
  kerrVelocity(state, spin);
  if (!Number.isFinite(h) || !Number.isFinite(state.t) || h <= 0) throw new RangeError('Invalid Hamiltonian step.');
  return rkStep(state, spinValue(spin), h, false);
}

/** Null boundary solve in affine length, avoiding a singular shooting chart at a radial turn. */
export function receptionImage({ position, spin, eventAt, initialDirection, imageSeeds, stepScale = 0.1 }) {
  const frame = observerFrame(position, spin), a = spinValue(spin), surface = horizon(spin) + KERR_RAY.epsilon;
  const rp = horizon(spin);
  const coarseScale = Math.max(.8, stepScale);
  if (!Number.isFinite(stepScale) || stepScale <= 0 || stepScale > 1) throw new RangeError('Invalid reception step.');
  const target = eventAt(0).x;
  vector(target);
  const delta = target.map((v, i) => v - frame.position[i]), distance = Math.hypot(...delta);
  if (!(distance > 0)) throw new RangeError('Receiver coincides with the emission event.');
  const initial = norm(frame.covectors.slice(1).map(cov => dot(cov.slice(1), delta)));
  const trace = (n, length, scale) => {
    const cov = frame.covectors[0].map((v, i) => -v + n[0] * frame.covectors[1][i]
      + n[1] * frame.covectors[2][i] + n[2] * frame.covectors[3][i]);
    let state = { x: frame.position, p: cov.slice(1), pt: cov[0], t: 0 }, affine = 0;
    for (let i = 0; i < 12000; i++) {
      const r = radiusAt(state.x, a);
      if (r <= surface || r > 512) return null;
      if (affine >= length) return { ...state, affine: length };
      const h = Math.min(length - affine, scale * Math.min(0.06 * (r - rp), 8));
      state = rkStep(state, a, h, false); affine += h;
    }
    return null;
  };
  const solve = (seed, scale) => {
    let n = norm(seed.direction ?? seed), length = seed.affine ?? distance;
    let state;
    for (let i = 0; i < 18; i++) {
      state = trace(n, length, scale);
      if (!state) return null;
      const center = eventAt(state.t).x, residual = state.x.map((v, j) => v - center[j]);
      const error = Math.hypot(...residual);
      if (error < 2e-9) return { ...state, direction: n, stepScale: scale };
      const e1 = norm(Math.abs(n[0]) > .7 ? [-n[1], n[0], 0] : [0, -n[2], n[1]]);
      const e2 = cross(n, e1), eps = 1e-6;
      const derivatives = [e1, e2].map(e => {
        const ray = trace(norm(n.map((v, j) => v + eps * e[j])), length, scale);
        if (!ray) return null;
        const c = eventAt(ray.t).x;
        return ray.x.map((v, j) => (v - c[j] - residual[j]) / eps);
      });
      if (derivatives.some(v => !v)) return null;
      const velocity = flow(state, a, false), future = eventAt(state.t + 1e-5).x;
      const v = velocity.dx.map((q, j) => q - (future[j] - center[j]) / 1e-5 * velocity.dt);
      const [u, w] = derivatives, determinant = dot(u, cross(w, v));
      if (Math.abs(determinant) < 1e-12) return null;
      const du = dot(residual, cross(w, v)) / determinant;
      const dw = dot(u, cross(residual, v)) / determinant;
      const dl = dot(u, cross(w, residual)) / determinant;
      let accepted = false;
      for (let damping = 1; damping >= 1 / 1024; damping /= 2) {
        const candidate = norm(n.map((q, j) => q - damping * (du * e1[j] + dw * e2[j])));
        const l = length - damping * dl;
        if (!(l > 0)) continue;
        const ray = trace(candidate, l, scale);
        if (ray && Math.hypot(...ray.x.map((q, j) => q - eventAt(ray.t).x[j])) < error) {
          n = candidate; length = l; accepted = true; break;
        }
      }
      if (!accepted) return null;
    }
    return null;
  };
  let best;
  const retain = root => { if (root && (!best || root.t > best.t)) best = root; };
  for (const seed of imageSeeds ?? []) retain(solve(seed, seed.affine ? stepScale : coarseScale));
  if (!best) retain(solve(initialDirection ?? initial, coarseScale));
  if (!best || radiusAt(target, a) < 2) retain(solve(initial, coarseScale));
  if (!best) {
    for (const radial of [-.99, -.9, -.5, 0, .5, .8, .95, .995]) {
      const transverse = Math.hypot(initial[1], initial[2]);
      const factor = Math.sqrt(1 - radial * radial);
      retain(solve([radial, factor * (transverse ? initial[1] / transverse : 0), factor * (transverse ? initial[2] / transverse : 1)], coarseScale));
    }
  }
  if (!best) throw new RangeError('Direct image did not converge.');
  if (best.stepScale !== stepScale) best = solve(best, stepScale);
  if (!best) throw new RangeError('Direct image refinement did not converge.');
  const n = best.direction;
  return { ...best, delay: -best.t, radius: radiusAt(best.x, a),
    imageSeeds: [{ direction: n, affine: best.affine }],
    sceneDirection: frame.sceneBasis[0].map((_, j) => dot(n, frame.sceneBasis.map(v => v[j]))) };
}

export function metricProduct(x, spin, u, v) {
  vector(x);
  if (![u, v].every(w => Array.isArray(w) && w.length === 4 && w.every(Number.isFinite))) throw new RangeError('Expected finite four-vectors.');
  return geometry(x, spinValue(spin)).inner(u, v);
}

export function lowerVector(x, spin, u) {
  metricProduct(x, spin, u, u);
  return geometry(x, spinValue(spin)).lower(u);
}

export const kerrFlowGLSL = `
void kerrFlow(vec3 x, vec3 p, float pt, float a, out vec3 dx, out vec3 dp) {
${graph.map(row => `  float ${row.id} = ${expression(row, v => typeof v === 'number' ? v.toFixed(1) : v)};`).join('\n')}
  dx = vec3(${outputs.dx}); dp = vec3(${outputs.dp});
}
float kerrTime(vec3 x, vec3 p, float pt, float a) {
  float q = dot(x, x) - a * a;
  float r = sqrt(0.5 * (q + sqrt(q * q + 4.0 * a * a * x.z * x.z)));
  vec3 l = -vec3(r * x.x - a * x.y, r * x.y + a * x.x, x.z * (r * r + a * a) / r) / (r * r + a * a);
  float f = r * r * r / (pow(r, 4.0) + a * a * x.z * x.z);
  return -pt + f * (dot(l, p) - pt);
}
void kerrStep(inout vec3 x, inout vec3 p, inout float time, float pt, float a, float h) {
  vec3 x1, p1, x2, p2, x3, p3, x4, p4;
  kerrFlow(x, p, pt, a, x1, p1);
  float halfStep = h * 0.5;
  kerrFlow(x + x1 * halfStep, p + p1 * halfStep, pt, a, x2, p2);
  kerrFlow(x + x2 * halfStep, p + p2 * halfStep, pt, a, x3, p3);
  kerrFlow(x + x3 * h, p + p3 * h, pt, a, x4, p4);
  float t1 = kerrTime(x, p, pt, a);
  float t2 = kerrTime(x + x1 * halfStep, p + p1 * halfStep, pt, a);
  float t3 = kerrTime(x + x2 * halfStep, p + p2 * halfStep, pt, a);
  float t4 = kerrTime(x + x3 * h, p + p3 * h, pt, a);
  time += (h / 6.0) * (((t1 + 2.0 * t2) + 2.0 * t3) + t4);
  x += (h / 6.0) * (((x1 + 2.0 * x2) + 2.0 * x3) + x4);
  p += (h / 6.0) * (((p1 + 2.0 * p2) + 2.0 * p3) + p4);
}
`;

export function invariants(state, spin) {
  vector(state.x); vector(state.p);
  if (!Number.isFinite(state.pt)) throw new RangeError('Momentum must be finite.');
  const a = spinValue(spin), { r, l, f } = geometry(state.x, a), E = -state.pt;
  const Lz = state.x[0] * state.p[1] - state.x[1] * state.p[0];
  const ct = state.x[2] / r, st = Math.sqrt(Math.max(0, 1 - ct * ct));
  const phi = Math.atan2(state.x[1], state.x[0]);
  const ptheta = Math.sqrt(r * r + a * a) * ct * (Math.cos(phi) * state.p[0] + Math.sin(phi) * state.p[1]) - r * st * state.p[2];
  return { E, H: 0.5 * (-(state.pt ** 2) + dot(state.p, state.p) - f * (-state.pt + dot(l.slice(1), state.p)) ** 2), Lz,
    Q: ptheta * ptheta + ct * ct * (-a * a * E * E + (st > 1e-10 ? Lz * Lz / (st * st) : 0)) };
}

export function emitterShift(r, spin, pt, Lz, observerProduct = 1) {
  const a = spinValue(spin), rootM = Math.sqrt(0.5);
  if (![r, pt, Lz, observerProduct].every(Number.isFinite) || r <= horizon(spin)) throw new RangeError('Invalid circular emitter.');
  const omega = rootM / (r ** 1.5 + a * rootM);
  const ut = (r ** 1.5 + a * rootM) / (r ** 0.75 * Math.sqrt(r ** 1.5 - 1.5 * Math.sqrt(r) + 2 * a * rootM));
  return observerProduct / (ut * (pt + omega * Lz));
}

function farTail(state, a) {
  const rho = Math.hypot(...state.x), radial = norm(state.x);
  const velocity = flow(state, a, false).dx;
  const tangent = norm(velocity.map((v, i) => v - dot(velocity, radial) * radial[i]));
  const b = Math.hypot(...cross(state.x, state.p)) / Math.abs(state.pt);
  if (b < 1e-10) return radial;
  const angle = escapeAngle(1 / rho, b, 1);
  return norm(radial.map((v, i) => v * Math.cos(angle) + tangent[i] * Math.sin(angle)));
}

/** Past-directed rays, p_t fixed; onStep sees the actual states, including float32 rounding. */
export function traceRay({ position, direction, spin, quality = 'high', stepScale = 1, float32 = false,
  outerRadius = KERR_RAY.outerRadius, maxSteps, onStep, onChord } = {}) {
  vector(direction);
  if (!(Math.hypot(...direction) > 0)) throw new RangeError('Ray direction must be nonzero.');
  const frame = observerFrame(position, spin), a = spinValue(spin), surface = horizon(spin) + KERR_RAY.epsilon;
  const c = KERR_RAY[`${quality}C`], budget = KERR_RAY[`${quality}Steps`];
  if (!c || !Number.isFinite(stepScale) || stepScale <= 0 || stepScale > 1
    || (maxSteps !== undefined && (!Number.isSafeInteger(maxSteps) || maxSteps <= 0))
    || !Number.isFinite(outerRadius) || outerRadius < KERR_RAY.outerRadius) throw new RangeError('Invalid ray budget.');
  const n = norm(direction), cov = frame.covectors;
  const p = cov[0].map((v, i) => -v + n[0] * cov[1][i] + n[1] * cov[2][i] + n[2] * cov[3][i]);
  const F = float32 ? Math.fround : v => v;
  let state = { x: frame.position.map(F), p: p.slice(1).map(F), pt: F(p[0]), t: 0 };
  const diskHits = [], inner = diskInnerRadius(spin), maximum = maxSteps
    ?? Math.ceil(budget / stepScale + Math.max(0, outerRadius - KERR_RAY.outerRadius) / (KERR_RAY.stepBound * stepScale));
  onStep?.(state);
  for (let i = 0; i < maximum; i++) {
    const r = radiusAt(state.x, a), velocity = flow(state, F(a), float32).dx;
    if (r < surface) return { fate: 'captured', direction: null, diskHits, steps: i, state };
    if (r > outerRadius && dot(state.x, velocity) > 0) {
      const d = farTail(state, a);
      return { fate: 'escaped', direction: [d[1], d[2], d[0]], diskHits, steps: i, state };
    }
    const h = F(stepScale * Math.min(c * (r - horizon(spin)), KERR_RAY.stepBound));
    const next = rkStep(state, F(a), h, float32);
    const hit = onChord?.(state, next);
    if (hit) return { fate: 'hit', hit, diskHits, steps: i + 1, state: next };
    if (state.x[2] * next.x[2] < 0 && diskHits.length < 3) {
      const t = state.x[2] / (state.x[2] - next.x[2]);
      const x = state.x.map((v, j) => v + t * (next.x[j] - v));
      const momentum = state.p.map((v, j) => v + t * (next.p[j] - v));
      const radius = radiusAt(x, a), Lz = x[0] * momentum[1] - x[1] * momentum[0];
      if (radius >= inner && radius <= 8.6) diskHits.push({ r: radius, phi: Math.atan2(x[1], x[0]),
        g: emitterShift(radius, spin, state.pt, Lz), order: diskHits.length, xi: -Lz / state.pt });
    }
    state = next;
    onStep?.(state);
  }
  return { fate: 'budget', direction: null, diskHits, steps: maximum, state };
}

/** Finite-distance ZAMO critical curve in gnomonic screen coordinates, +x toward increasing phi. */
export function criticalCurve(position, spin, samples = 4096) {
  const frame = observerFrame(position, spin), a = spinValue(spin), ro = Math.hypot(...position);
  const ct = position[1] / ro, st = Math.sqrt(1 - ct * ct);
  if (!(a > 0) || st < 1e-8 || !Number.isSafeInteger(samples) || samples < 4) throw new RangeError('Critical-curve sampling requires finite samples, nonzero spin and an off-axis observer.');
  const sigma = ro * ro + a * a * ct * ct;
  const gphi = st * st * (ro * ro + a * a + ro * a * a * st * st / sigma);
  const points = [];
  for (let i = 0; i <= samples; i++) {
    const r = horizon(spin) + 1e-7 + (2.1 - horizon(spin)) * i / samples;
    const xi = (r * r * (r - 1.5) + a * a * (r + 0.5)) / (a * (0.5 - r));
    const eta = r ** 3 * (2 * a * a - r * (r - 1.5) ** 2) / (a * a * (0.5 - r) ** 2);
    const theta = eta + a * a * ct * ct - xi * xi * ct * ct / (st * st);
    if (theta < 0) continue;
    const energy = frame.ut * (1 - frame.omega * xi);
    const pp = -xi / Math.sqrt(gphi), pt = Math.sqrt(theta / sigma);
    const pr = Math.sqrt(energy * energy - pp * pp - pt * pt);
    points.push({ x: pp / pr, y: pt / pr, orbit: r });
  }
  return [...points, ...points.slice().reverse().map(p => ({ ...p, y: -p.y }))];
}

export function curveRadius(curve, angle) {
  const dx = Math.cos(angle), dy = Math.sin(angle), hits = [];
  for (let i = 0; i < curve.length; i++) {
    const p = curve[i], q = curve[(i + 1) % curve.length];
    const ex = q.x - p.x, ey = q.y - p.y, den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-14) continue;
    const t = (p.x * ey - p.y * ex) / den, u = (p.x * dy - p.y * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) hits.push(t);
  }
  if (!hits.length) throw new RangeError('Screen direction misses the sampled critical curve.');
  return Math.max(...hits);
}
