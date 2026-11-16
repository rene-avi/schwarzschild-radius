import { worlds } from './worlds.js';

const locations = ['ship', 'brink', 'lantern', 'farShore'];
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365.25 * DAY;

function nonnegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative.`);
}

function validLocation(location) {
  if (!locations.includes(location)) throw new RangeError('Unknown crew location.');
}

function addSeconds(total, correction, increment) {
  const adjusted = increment - correction;
  const value = total + adjusted;
  return [value, (value - total) - adjusted];
}

/** All accumulated clocks are SI seconds; transitions return independent state. */
export function reset() {
  const bodySeconds = Object.fromEntries(locations.map(id => [id, 0]));
  return {
    location: 'ship',
    homeSeconds: 0,
    crewSeconds: 0,
    bodySeconds,
    compensation: { homeSeconds: 0, crewSeconds: 0, bodySeconds: { ...bodySeconds } },
  };
}

export function travel(state, location) {
  validLocation(location);
  return {
    ...state, location, bodySeconds: { ...state.bodySeconds },
    compensation: { ...state.compensation, bodySeconds: { ...state.compensation.bodySeconds } },
  };
}

/** Transfers cost no time; changing spin cannot reinterpret accumulated clocks. */
export function advance(state, dCrewSeconds, delta) {
  nonnegative(dCrewSeconds, 'Crew duration');
  validLocation(state.location);
  const bodies = worlds(delta);
  if (dCrewSeconds === 0) return travel(state, state.location);
  const factor = bodies.find(body => body.id === state.location).dtdtau;
  const dHomeSeconds = dCrewSeconds * factor;
  // Compensated sums retain small frame increments after long visits.
  const [homeSeconds, homeCorrection] = addSeconds(state.homeSeconds, state.compensation.homeSeconds, dHomeSeconds);
  const [crewSeconds, crewCorrection] = addSeconds(state.crewSeconds, state.compensation.crewSeconds, dCrewSeconds);
  const bodySeconds = {};
  const bodyCorrections = {};
  for (const body of bodies) {
    [bodySeconds[body.id], bodyCorrections[body.id]] = addSeconds(
      state.bodySeconds[body.id], state.compensation.bodySeconds[body.id], dHomeSeconds / body.dtdtau,
    );
  }
  return {
    location: state.location,
    homeSeconds,
    crewSeconds,
    bodySeconds,
    compensation: { homeSeconds: homeCorrection, crewSeconds: crewCorrection, bodySeconds: bodyCorrections },
  };
}

export function formatDuration(seconds) {
  nonnegative(seconds, 'Duration');
  const rounded = Math.round(seconds);
  if (rounded < MINUTE) return `${rounded} s`;
  if (rounded < HOUR) return `${Math.floor(rounded / MINUTE)} min ${rounded % MINUTE} s`;
  if (rounded < 48 * HOUR) {
    return `${Math.floor(rounded / HOUR)} h ${Math.floor(rounded % HOUR / MINUTE)} min ${rounded % MINUTE} s`;
  }
  const days = Math.round(rounded / DAY * 10) / 10;
  if (days < 365.25) return `${days.toFixed(1)} days`;
  const years = Math.round(rounded / YEAR * 100) / 100;
  if (years < 1000) return `${years.toFixed(2)} years`;
  const thousands = Math.round(rounded / YEAR / 1000 * 100) / 100;
  if (thousands < 1000) return `${thousands.toFixed(2)} thousand years`;
  return `${(rounded / YEAR / 1e6).toFixed(2)} million years`;
}

const factorFormat = new Intl.NumberFormat('en-US', {
  minimumSignificantDigits: 3,
  maximumSignificantDigits: 3,
  useGrouping: true,
});

export function formatFactor(factor) {
  nonnegative(factor, 'Clock factor');
  return factor < 10 ? factor.toFixed(4) : factorFormat.format(factor);
}
