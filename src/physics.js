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
 * Special-relativistic frequency multiplier δ = 1 / [γ (1 − β cos θ)].
 * cos θ = +1 means the emitter moves toward the observer. Specific intensity
 * is beamed by δ³; bolometric intensity would use δ⁴.
 */
export function dopplerFactor(beta, cosTheta) {
  finite(beta, 'Velocity');
  finite(cosTheta, 'Direction cosine');
  if (Math.abs(beta) >= 1) throw new RangeError('Velocity must be slower than light.');
  if (Math.abs(cosTheta) > 1) throw new RangeError('Direction cosine must be between -1 and 1.');
  return Math.sqrt(1 - beta * beta) / (1 - beta * cosTheta);
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

const PROBE_HORIZON_LIMIT = 1.015;
const PROBE_INITIAL_RADIUS = 7;
const PROBE_APPROACH_RATE = 0.23;

/** Create a newly released probe in units of r / rₛ and observer seconds. */
export function createProbe() {
  return {
    radius: PROBE_INITIAL_RADIUS,
    angle: 0,
    elapsed: 0,
    properElapsed: 0,
    dilation: timeDilation(PROBE_INITIAL_RADIUS),
    state: 'falling',
  };
}

/**
 * Observer-facing, illustrative trajectory, not an exact timelike geodesic.
 * The exponential approach depicts Schwarzschild coordinate-time freezing.
 * The proper-time readout uses the local stationary-clock factor for clarity;
 * a freely falling clock would also require velocity-dependent dilation.
 */
export function updateProbe(probe, dt, timeScale = 1) {
  finite(dt, 'Time step');
  finite(timeScale, 'Time scale');
  if (dt < 0 || timeScale < 0) throw new RangeError('Time must advance nonnegatively.');
  if (probe.state === 'idle' || probe.state === 'frozen') return probe;

  const step = dt * timeScale;
  const previousDilation = probe.dilation;
  probe.elapsed += step;
  probe.radius = PROBE_HORIZON_LIMIT
    + (PROBE_INITIAL_RADIUS - PROBE_HORIZON_LIMIT) * Math.exp(-PROBE_APPROACH_RATE * probe.elapsed);
  probe.dilation = timeDilation(probe.radius);
  probe.properElapsed += step * (previousDilation + probe.dilation) * 0.5;
  probe.angle += step * 0.75 / Math.pow(probe.radius, 1.5);
  if (probe.radius - PROBE_HORIZON_LIMIT < 0.003) probe.state = 'frozen';
  return probe;
}
