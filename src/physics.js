/** SI constants; distances in the renderer are expressed in Schwarzschild radii. */
export const G = 6.67430e-11;
export const C = 299_792_458;
export const SOLAR_MASS = 1.98847e30;

function finite(value, name) {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}

/** Event-horizon radius of a nonrotating black hole, in meters. */
export function schwarzschildRadius(massSolar) {
  finite(massSolar, 'Mass');
  if (massSolar < 0) throw new RangeError('Mass must be nonnegative.');
  return (2 * G * SOLAR_MASS / (C * C)) * massSolar;
}

/**
 * dτ/dt for a stationary clock relative to a clock at infinity.
 * A stationary clock cannot exist at or inside the horizon; return zero there
 * as the visual limiting value rather than an imaginary number.
 */
export function timeDilation(radius, rs = 1) {
  finite(rs, 'Schwarzschild radius');
  if (rs < 0) throw new RangeError('Schwarzschild radius must be nonnegative.');
  if (radius === Infinity) return 1;
  finite(radius, 'Radius');
  if (radius <= rs) return 0;
  return Math.sqrt(1 - rs / radius);
}

/**
 * Temperature and spin are visual disk parameters, not a Kerr metric solution.
 * The mass sets the physical scale, while normalized geometry remains stable.
 */
export const PRESETS = Object.freeze({
  gargantua: Object.freeze({
    name: 'Gargantua',
    mass: 100_000_000,
    spin: 0.85,
    temperature: 7500,
    tilt: 8,
    lensing: 1,
    timeScale: 1,
  }),
  sagittarius: Object.freeze({
    name: 'Sagittarius A*',
    mass: 4_300_000,
    spin: 0.55,
    temperature: 11_000,
    tilt: 18,
    lensing: 1.15,
    timeScale: 0.8,
  }),
  quiet: Object.freeze({
    name: 'Quiet',
    mass: 10,
    spin: 0.08,
    temperature: 3500,
    tilt: 4,
    lensing: 0.85,
    timeScale: 0.25,
  }),
});

export const PROBE_INITIAL_RADIUS = 7;
export const PROBE_FADE_SIGNAL = 0.25;
export const PROBE_LOST_SIGNAL = 0.02;

function releaseRadius(r0) {
  finite(r0, 'Release radius');
  if (r0 <= 1) throw new RangeError('Release must be outside the horizon.');
}

function fallRadius(radius, r0, minimum = 0) {
  releaseRadius(r0);
  finite(radius, 'Emitter radius');
  if (radius < minimum || radius > r0) throw new RangeError('Emitter radius is outside the fall.');
}

function observerLapse(radius) {
  if (radius === Infinity) return 1;
  finite(radius, 'Observer radius');
  if (radius <= 1) throw new RangeError('A static observer must be outside the horizon.');
  return Math.sqrt(1 - 1 / radius);
}

/** Exact radial timelike geodesic from rest; r_s = c = 1. */
export function probeCycloid(eta, r0 = PROBE_INITIAL_RADIUS) {
  releaseRadius(r0);
  finite(eta, 'Cycloid angle');
  if (eta < 0 || eta > Math.PI) throw new RangeError('Cycloid angle must be in [0, pi].');
  return {
    radius: r0 * Math.cos(eta / 2) ** 2,
    properElapsed: r0 ** 1.5 / 2 * (eta + Math.sin(eta)),
  };
}

export function probeProperTime(radius, r0 = PROBE_INITIAL_RADIUS) {
  fallRadius(radius, r0);
  return probeCycloid(2 * Math.acos(Math.sqrt(radius / r0)), r0).properElapsed;
}

/** Schwarzschild coordinate time since release, with a stable horizon logarithm. */
export function probeCoordinateTime(radius, r0 = PROBE_INITIAL_RADIUS) {
  fallRadius(radius, r0, 1);
  if (radius === 1) return Infinity;
  if (radius === r0) return 0;
  const eta = 2 * Math.acos(Math.sqrt(radius / r0));
  const x = Math.sqrt((r0 - radius) / (radius * (r0 - 1)));
  return Math.sqrt(r0 - 1) * ((r0 / 2 + 1) * eta + r0 / 2 * Math.sin(eta))
    + 2 * Math.log1p(x) - Math.log(r0 * (radius - 1) / (radius * (r0 - 1)));
}

export function tortoiseRadius(radius) {
  finite(radius, 'Tortoise radius');
  if (radius <= 1) throw new RangeError('Tortoise radius must be outside the horizon.');
  return radius + Math.log(radius - 1);
}

/** Outgoing radial photon: -k.u_e = omega_inf (E + sqrt(E²-f))/f. */
export function probeSignal(radius, observerRadius = 23, r0 = PROBE_INITIAL_RADIUS) {
  fallRadius(radius, r0, 1);
  const lapse = observerLapse(observerRadius);
  const energy = Math.sqrt(1 - 1 / r0);
  const f = (radius - 1) / radius;
  // -k.u_obs = omega_inf/sqrt(f_obs); the quotient includes gravitational and Doppler shifts.
  return f / (energy + Math.sqrt(Math.max(0, 1 / radius - 1 / r0))) / lapse;
}

export function probeArrivalTime(radius, observerRadius = 23, r0 = PROBE_INITIAL_RADIUS) {
  fallRadius(radius, r0, 1);
  observerLapse(observerRadius);
  if (!Number.isFinite(observerRadius) || observerRadius < r0) {
    throw new RangeError('The radial receiver must be at or beyond release.');
  }
  return radius === 1 ? Infinity
    : probeCoordinateTime(radius, r0) + tortoiseRadius(observerRadius) - tortoiseRadius(radius);
}

function invertFall(time, r0, timeAtRadius) {
  let low = 0;
  let high = 2 * Math.acos(1 / Math.sqrt(r0));
  for (let i = 0; i < 60; i++) {
    const eta = (low + high) / 2;
    const radius = Math.max(1, probeCycloid(eta, r0).radius);
    if (timeAtRadius(radius) < time) low = eta;
    else high = eta;
  }
  return Math.max(1, probeCycloid((low + high) / 2, r0).radius);
}

export function probeRadiusAtCoordinateTime(time, r0 = PROBE_INITIAL_RADIUS) {
  releaseRadius(r0);
  finite(time, 'Coordinate time');
  if (time < 0) throw new RangeError('Time must be nonnegative.');
  return time === 0 ? r0 : invertFall(time, r0, radius => probeCoordinateTime(radius, r0));
}

/** Reception origin is the arrival of the release signal; absolute delay is retained separately. */
export function probeReceptionTime(radius, observerRadius = 23, r0 = PROBE_INITIAL_RADIUS) {
  return probeArrivalTime(radius, observerRadius, r0) - probeArrivalTime(r0, observerRadius, r0);
}

export function probeObservedEvent(time, observerRadius = 23, r0 = PROBE_INITIAL_RADIUS) {
  finite(time, 'Reception time');
  if (time < 0) throw new RangeError('Time must be nonnegative.');
  probeArrivalTime(r0, observerRadius, r0);
  const radius = time === 0 ? r0
    : invertFall(time, r0, r => probeReceptionTime(r, observerRadius, r0));
  return {
    radius,
    signal: probeSignal(radius, observerRadius, r0),
    properElapsed: probeProperTime(radius, r0),
    emissionTime: probeCoordinateTime(radius, r0),
  };
}

/** One short flash at each whole onboard second, independent of frame rate and pause. */
export function probePulse(properElapsed) {
  finite(properElapsed, 'Proper time');
  if (properElapsed < 0) throw new RangeError('Proper time must be nonnegative.');
  const phase = properElapsed - Math.floor(properElapsed);
  const x = Math.min(1, phase / 0.22);
  return 1 - x * x * (3 - 2 * x);
}

const probeTiming = new WeakMap();

/** Receiver stays static at its release radius; camera motion only changes the view. */
export function createProbe({ observerRadius = 23, direction = [0, 0, 1] } = {}) {
  const r0 = PROBE_INITIAL_RADIUS;
  const arrivalDelay = probeArrivalTime(r0, observerRadius, r0);
  if (!Array.isArray(direction) || direction.length !== 3 || !direction.every(Number.isFinite)
    || Math.hypot(...direction) === 0) throw new RangeError('Probe direction must be a finite nonzero vector.');
  const length = Math.hypot(...direction);
  if (!Number.isFinite(length)) throw new RangeError('Probe direction magnitude must be finite.');
  const energy = Math.sqrt(1 - 1 / r0);
  const a = PROBE_LOST_SIGNAL * observerLapse(observerRadius);
  let lostRadius = 1 / (1 - 2 * energy * a + a * a);
  // Choose the first representable radius below the strict signal cutoff.
  while (probeSignal(lostRadius, observerRadius) >= PROBE_LOST_SIGNAL) lostRadius -= Number.EPSILON * lostRadius;
  const lostTime = probeReceptionTime(lostRadius, observerRadius, r0);
  const flashEvents = Array.from({ length: Math.floor(probeProperTime(lostRadius)) }, (_, i) => {
    const properElapsed = i + 1;
    const radius = invertFall(properElapsed, r0, r => probeProperTime(r, r0));
    return { radius, properElapsed, signal: probeSignal(radius, observerRadius),
      receptionTime: probeReceptionTime(radius, observerRadius, r0) };
  });
  const probe = {
    ...probeObservedEvent(0, observerRadius),
    observerRadius, direction: direction.map(value => value / length),
    elapsed: 0, observerElapsed: 0, arrivalDelay, lostTime, state: 'falling', trail: [],
    pulse: probePulse(0), flashCount: 0, flashTotal: flashEvents.length,
  };
  probeTiming.set(probe, { remainder: 0, lostRadius, flashEvents });
  return probe;
}

/** Evaluate absolute reception time; no frame-integrated radius, clock or trail. */
export function updateProbe(probe, dt, timeScale = 1) {
  finite(dt, 'Time step');
  finite(timeScale, 'Time scale');
  const step = dt * timeScale;
  if (dt < 0 || timeScale < 0 || !Number.isFinite(step)) throw new RangeError('Time must advance finitely and nonnegatively.');
  const timing = probeTiming.get(probe);
  if (!timing) throw new RangeError('Probe must be created by createProbe.');
  if (probe.state === 'lost' || step === 0) return probe;
  const corrected = step - timing.remainder;
  const next = probe.elapsed + corrected;
  timing.remainder = (next - probe.elapsed) - corrected;
  probe.elapsed = Math.min(next, probe.lostTime);
  const lost = next >= probe.lostTime;
  Object.assign(probe, lost ? {
    radius: timing.lostRadius,
    signal: probeSignal(timing.lostRadius, probe.observerRadius),
    properElapsed: probeProperTime(timing.lostRadius),
    emissionTime: probeCoordinateTime(timing.lostRadius),
  } : probeObservedEvent(probe.elapsed, probe.observerRadius));
  probe.observerElapsed = probe.elapsed * observerLapse(probe.observerRadius);
  probe.state = lost ? 'lost' : probe.signal < PROBE_FADE_SIGNAL ? 'fading' : 'falling';
  probe.flashCount = Math.floor(probe.properElapsed);
  probe.pulse = lost ? 0 : probePulse(probe.properElapsed);
  probe.trail = lost ? [] : timing.flashEvents
    .filter(event => event.properElapsed <= probe.flashCount
      && event.receptionTime < probe.elapsed && probe.elapsed - event.receptionTime < 12)
    .slice(-8).reverse().map(event => ({ ...event, age: probe.elapsed - event.receptionTime }));
  return probe;
}
