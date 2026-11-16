export const CREW_SECONDS_PER_REAL_SECOND = 900;

/** dt is clamped by the caller, before applying time scale. */
export function crewStep(dt, timeScale, running, paused) {
  return running && !paused ? CREW_SECONDS_PER_REAL_SECOND * (dt * timeScale) : 0;
}
