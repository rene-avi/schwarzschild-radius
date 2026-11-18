import { PROBE_INITIAL_RADIUS, PROBE_FADE_SIGNAL, PROBE_LOST_SIGNAL, probePulse } from './physics.js';
import { blRadius, horizon, observerFrame, lowerVector, kerrStep, kerrVelocity } from './kerrray.js';
import { directEventImage } from './kerrworlds.js';

export const KERR_PROBE_KNOTS = 48;
const timing = new WeakMap();
let cachedFall;
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
function finite(value) { if (!Number.isFinite(value)) throw new RangeError('Probe input must be finite.'); }

export function probeDropRefusal(position, spin, direction) {
  const receiver = observerFrame(position, spin);
  if (direction !== undefined) {
    if (!Array.isArray(direction) || direction.length !== 3 || !direction.every(Number.isFinite)
      || !(Math.hypot(...direction) > 0) || !Number.isFinite(Math.hypot(...direction))) throw new RangeError('Invalid probe start.');
    const release = observerFrame(direction.map(v => PROBE_INITIAL_RADIUS * v / Math.hypot(...direction)), spin);
    // The largest KS hull/wing semiaxis is 0.15; a point receiver inside that size is undefined.
    if (Math.hypot(...release.position.map((v, i) => v - receiver.position[i])) <= .15) {
      return 'Probe not released: the release point is within the probe hull size (0.15 r_s) of the camera.';
    }
  }
  return null;
}

function historySample(history, fraction) {
  if (fraction >= 1) return history.at(-1);
  const start = history[0].t, end = history.at(-1).t;
  return historyAt(history, Math.max(start, Math.min(end, start + (end - start) * fraction)));
}

/** Arrival order is checked in emission order; sorting by arrival would conceal a wrong image. */
export function assertReceptionOrder(rows) {
  for (let i = 0; i < rows.length; i++) {
    if (!Number.isFinite(rows[i].arrival) || !Number.isFinite(rows[i].t)
      || (i && (!(rows[i].t > rows[i - 1].t) || !(rows[i].arrival > rows[i - 1].arrival)))) {
      throw new RangeError('Direct probe reception must be causal.');
    }
  }
}

export function probeInvariants(state, spin) {
  const u = kerrVelocity(state, spin), r = blRadius(state.x, spin), a = spin / 2, E = -state.pt;
  const [X, Y, Z] = state.x, Lz = X * state.p[1] - Y * state.p[0];
  const ct = Z / r, st = Math.sqrt(Math.max(0, 1 - ct * ct)), phi = Math.atan2(Y, X);
  const ptheta = Math.sqrt(r * r + a * a) * ct * (Math.cos(phi) * state.p[0] + Math.sin(phi) * state.p[1]) - r * st * state.p[2];
  const Q = ptheta * ptheta + ct * ct * (a * a * (1 - E * E) + (st > 1e-10 ? Lz * Lz / (st * st) : 0));
  return { E, Lz, Q, H: 0.5 * (state.pt * u[0] + dot(state.p, u.slice(1))) };
}

/** Future timelike outgoing-KS Hamiltonian, affine parameter equal to proper time. */
export function integrateProbe({ direction = [0, 0, 1], radius = PROBE_INITIAL_RADIUS, spin, step = 0.002, endUt = 120 } = {}) {
  finite(radius); finite(step); finite(endUt);
  if (!Array.isArray(direction) || direction.length !== 3 || !direction.every(Number.isFinite)
    || !(Math.hypot(...direction) > 0) || !Number.isFinite(Math.hypot(...direction)) || step <= 0 || step > 0.01 || endUt < 120 || endUt > 1024) throw new RangeError('Invalid probe start.');
  const n = direction.map(v => v / Math.hypot(...direction)), a = spin / 2;
  const ergosphere = 0.5 + Math.sqrt(0.25 - a * a * n[1] * n[1]);
  if (radius <= ergosphere) throw new RangeError('Probe must start outside the ergosphere.');
  const frame = observerFrame(n.map(v => radius * v), spin), cov = lowerVector(frame.position, spin, frame.u);
  let state = { t: 0, x: frame.position, p: cov.slice(1), pt: cov[0] }, tau = 0;
  const history = [];
  for (let i = 0; i < 200000; i++) {
    const r = blRadius(state.x, spin), u = kerrVelocity(state, spin);
    history.push({ ...state, x: [...state.x], p: [...state.p], u, tau, radius: r });
    if (u[0] > endUt) return history;
    const h = Math.min(step, 0.0001 * (r - horizon(spin)));
    state = kerrStep(state, spin, h);
    if (u[0] > 80) {
      // Correct radial roundoff on the mass shell without changing E, Lz or p_theta.
      const radius = blRadius(state.x, spin), D = 2 * radius * radius - dot(state.x, state.x) + a * a;
      const gradient = [radius * state.x[0] / D, radius * state.x[1] / D, state.x[2] * (radius * radius + a * a) / (radius * D)];
      const velocity = kerrVelocity(state, spin), H = .5 * (state.pt * velocity[0] + dot(state.p, velocity.slice(1)));
      const correction = (H + .5) / dot(gradient, velocity.slice(1));
      state.p = state.p.map((v, j) => v - correction * gradient[j]);
    }
    tau += h;
  }
  throw new RangeError('Probe integration budget exhausted.');
}

/** Cubic Hermite uses dx/dt = u^i/u^t; exact knot queries preserve stored events. */
export function historyAt(history, time) {
  finite(time);
  if (!Array.isArray(history) || history.length < 2 || time < history[0].t || time > history.at(-1).t) throw new RangeError('Event is outside probe history.');
  let lo = 0, hi = history.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (history[mid].t <= time) lo = mid; else hi = mid; }
  const a = history[lo], b = history[hi];
  if (time === a.t) return a;
  if (time === b.t) return b;
  const dt = b.t - a.t, s = (time - a.t) / dt;
  const x = a.x.map((v, i) => (2 * s ** 3 - 3 * s * s + 1) * v + (s ** 3 - 2 * s * s + s) * dt * a.u[i + 1] / a.u[0]
    + (-2 * s ** 3 + 3 * s * s) * b.x[i] + (s ** 3 - s * s) * dt * b.u[i + 1] / b.u[0]);
  const dTau = b.tau - a.tau;
  const tau = a.tau + s * dTau + s * (1 - s) * ((1 - s) * (dt / a.u[0] - dTau) - s * (dt / b.u[0] - dTau));
  return { t: time, x, u: a.u.map((v, i) => v + s * (b.u[i] - v)), tau,
    p: a.p.map((v, i) => v + s * (b.p[i] - v)), pt: a.pt, radius: a.radius + s * (b.radius - a.radius) };
}

export function probeImage(position, spin, event, initialDirection, imageSeeds) {
  if (!event || !Array.isArray(event.u) || event.u.length !== 4 || !event.u.every(Number.isFinite)) throw new RangeError('Invalid probe four-velocity.');
  let image;
  try {
    image = directEventImage({ position, spin, eventAt: () => event, initialDirection, primary: true, imageSeeds, stepScale: .6 });
  } catch (error) {
    throw new RangeError(`${error.message} (emission r=${blRadius(event.x, spin)}, t=${event.t}).`);
  }
  const g = 1 / (image.pt * event.u[0] + dot(image.p, event.u.slice(1)));
  if (!(g > 0) || !Number.isFinite(g) || !(image.delay > 0) || !Number.isFinite(image.delay)) {
    throw new RangeError('Probe reception must have positive frequency and delay.');
  }
  return { ...image, g };
}

export function createKerrProbe({ position, direction = [0, 0, 1], spin } = {}) {
  const refusal = probeDropRefusal(position, spin, direction);
  if (refusal) return { metric: 'kerr', state: 'refused', notice: refusal };
  const receiver = observerFrame(position, spin), key = JSON.stringify([direction, spin]);
  if (cachedFall?.key !== key) cachedFall = { key, history: integrateProbe({ direction, spin, endUt: 512 }) };
  const history = cachedFall.history;
  const timeline = [];
  let previous, initialDirection, imageSeeds;
  const continueImage = (event, seed) => {
    try { return probeImage(position, spin, event, seed?.direction, seed?.imageSeeds); }
    catch (error) {
      if (!seed || Math.abs(event.t - seed.t) <= .025) throw error;
      const middle = historyAt(history, (event.t + seed.t) / 2), image = continueImage(middle, seed);
      return continueImage(event, { ...image, t: middle.t });
    }
  };
  // Reception is computed once for the fixed drop ZAMO; moving the camera changes only the picture.
  for (let i = 0; i <= 32; i++) {
    const event = historySample(history, i / 32), image = continueImage(event, timeline.at(-1));
    const arrival = event.t + image.delay;
    const row = { ...event, signal: image.g, direction: image.direction, imageSeeds: image.imageSeeds, arrival, receptionTime: 0 };
    if (i === 0) row.receptionTime = 0;
    else row.receptionTime = arrival - timeline[0].arrival;
    timeline.push(row);
    if (i && image.g < PROBE_LOST_SIGNAL) break;
  }
  // A missed primary branch is continued backwards in small emission-time steps.
  for (let i = timeline.length - 2; i >= 0; i--) {
    const row = timeline[i], next = timeline[i + 1];
    if (row.arrival < next.arrival) continue;
    let image, t = next.t;
    initialDirection = next.direction;
    imageSeeds = next.imageSeeds;
    while (t > row.t) {
      t = Math.max(row.t, t - 0.05);
      image = probeImage(position, spin, historyAt(history, t), initialDirection, imageSeeds);
      initialDirection = image.direction; imageSeeds = image.imageSeeds;
    }
    if (image.delay < row.arrival - row.t) {
      row.arrival = row.t + image.delay; row.signal = image.g; row.direction = image.direction;
      row.imageSeeds = image.imageSeeds;
    }
  }
  const origin = timeline[0].arrival;
  for (let i = 0; i < timeline.length; i++) {
    timeline[i].receptionTime = timeline[i].arrival - origin;
  }
  assertReceptionOrder(timeline);
  const lossIndex = timeline.findIndex(row => row.signal < PROBE_LOST_SIGNAL);
  if (lossIndex <= 0) throw new RangeError('Probe signal did not reach loss.');
  timeline.splice(lossIndex + 1);
  previous = timeline[lossIndex - 1]; initialDirection = timeline[lossIndex].direction;
  imageSeeds = [...previous.imageSeeds, ...timeline[lossIndex].imageSeeds];
  let low = previous.t, high = timeline.at(-1).t;
  for (let i = 0; i < 20; i++) {
    const t = (low + high) / 2, event = historyAt(history, t);
    const image = probeImage(position, spin, event, initialDirection, imageSeeds);
    initialDirection = image.direction;
    imageSeeds = image.imageSeeds;
    if (image.g >= PROBE_LOST_SIGNAL) low = t; else high = t;
  }
  const lost = historyAt(history, high), lostImage = probeImage(position, spin, lost, initialDirection, imageSeeds);
  timeline[timeline.length - 1] = { ...lost, signal: lostImage.g, direction: lostImage.direction, imageSeeds: lostImage.imageSeeds, arrival: high + lostImage.delay,
    receptionTime: high + lostImage.delay - timeline[0].arrival };
  const flashEvents = [];
  for (let tau = 1; tau <= Math.floor(lost.tau); tau++) {
    let lo = 0, hi = history.length - 1;
    while (hi - lo > 1) { const mid = (hi + lo) >> 1; if (history[mid].tau <= tau) lo = mid; else hi = mid; }
    const a = history[lo], b = history[hi], t = a.t + (tau - a.tau) / (b.tau - a.tau) * (b.t - a.t);
    const seed = timeline.reduce((a, b) => Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b);
    const event = historyAt(history, t), image = continueImage(event, seed);
    flashEvents.push({ properElapsed: tau, receptionTime: t + image.delay - timeline[0].arrival, signal: image.g });
    timeline.push({ ...event, signal: image.g, direction: image.direction, imageSeeds: image.imageSeeds, arrival: t + image.delay,
      receptionTime: t + image.delay - timeline[0].arrival });
  }
  timeline.sort((a, b) => a.t - b.t);
  assertReceptionOrder(timeline);
  const probe = { metric: 'kerr', spin, direction: [...direction], elapsed: 0, observerElapsed: 0,
    arrivalDelay: timeline[0].arrival, lostTime: timeline.at(-1).receptionTime, state: 'falling', trail: [],
    flashEvents, flashTotal: flashEvents.length, flashCount: 0, pulse: 1 };
  timing.set(probe, { history, timeline, lapse: 1 / receiver.ut });
  updateKerrProbe(probe, 0);
  return probe;
}

export function updateKerrProbe(probe, dt, timeScale = 1) {
  finite(dt); finite(timeScale);
  const data = timing.get(probe);
  if (!data || dt < 0 || timeScale < 0 || !Number.isFinite(dt * timeScale)) throw new RangeError('Invalid probe update.');
  probe.elapsed = Math.min(probe.lostTime, probe.elapsed + dt * timeScale);
  const rows = data.timeline;
  let i = 0;
  while (i < rows.length - 2 && rows[i + 1].receptionTime < probe.elapsed) i++;
  const a = rows[i], b = rows[i + 1], s = (probe.elapsed - a.receptionTime) / (b.receptionTime - a.receptionTime);
  const event = historyAt(data.history, a.t + s * (b.t - a.t));
  probe.position = [...event.x];
  probe.radius = blRadius(event.x, probe.spin);
  probe.properElapsed = event.tau;
  probe.emissionTime = event.t;
  probe.signal = a.signal + s * (b.signal - a.signal);
  probe.observerElapsed = probe.elapsed * data.lapse;
  probe.state = probe.elapsed >= probe.lostTime ? 'lost' : probe.signal < PROBE_FADE_SIGNAL ? 'fading' : 'falling';
  probe.flashCount = probe.flashEvents.filter(e => e.receptionTime <= probe.elapsed).length;
  probe.pulse = probe.state === 'lost' ? 0 : probePulse(event.tau);
  return probe;
}

/** Refine the worst Hermite segment first; the complete fall includes moved-camera rays. */
export function probeWindow(probe) {
  const data = timing.get(probe);
  if (!data) throw new RangeError('Unknown Kerr probe.');
  if (!data.knots) {
    const segment = (a, b) => {
      const middle = historyAt(data.history, (a.t + b.t) / 2), approximation = historyAt([a, b], middle.t);
      return { a, b, middle, error: Math.hypot(...middle.x.map((v, i) => v - approximation.x[i])) };
    };
    const segments = [segment(data.history[0], data.history.at(-1))];
    while (segments.length < KERR_PROBE_KNOTS - 1) {
      let worst = 0;
      for (let i = 1; i < segments.length; i++) if (segments[i].error > segments[worst].error) worst = i;
      const { a, b, middle } = segments[worst];
      segments.splice(worst, 1, segment(a, middle), segment(middle, b));
    }
    data.knots = [segments[0].a, ...segments.map(s => s.b)];
  }
  return data.knots;
}

/** Only compact telemetry history crosses the worker boundary; render knots stay unchanged. */
export function packKerrProbe(probe) {
  const data = timing.get(probe);
  if (!data) throw new RangeError('Unknown Kerr probe.');
  const history = [...Array.from({ length: 384 }, (_, i) => historySample(data.history, i / 383)), ...data.timeline]
    .sort((a, b) => a.t - b.t).filter((row, i, rows) => !i || row.t > rows[i - 1].t);
  return { probe, data: { ...data, history, knots: probeWindow(probe) } };
}

export function unpackKerrProbe(packet) {
  if (packet.data.timeline) assertReceptionOrder(packet.data.timeline);
  timing.set(packet.probe, packet.data);
  return packet.probe;
}
