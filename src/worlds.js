import { iscoOffset, circularOrbit, orbitPeriod, secondsPerUnit } from './kerr.js';

/** Orbit physics keeps the exact radius; radiusM is for display only. Home is coordinate time. */
export function worlds(delta) {
  return [
    { id: 'brink', name: 'Brink', radius: { offset: iscoOffset(delta) } },
    { id: 'lantern', name: 'Lantern', radius: 12 },
    { id: 'farShore', name: 'Far Shore', radius: 120 },
    { id: 'ship', name: 'Ship', radius: 400 },
  ].map(body => {
    const { dtdtau, stable } = circularOrbit(body.radius, delta);
    return {
      ...body,
      radiusM: typeof body.radius === 'number' ? body.radius : 1 + body.radius.offset,
      dtdtau,
      stable,
      periods: orbitPeriod(body.radius, delta),
    };
  });
}

/** Convert home/local periods from GM/c^3 to SI seconds; mass is in solar masses. */
export function periodsInSeconds(periods, mass) {
  const unit = secondsPerUnit(mass);
  return { home: periods.home * unit, local: periods.local * unit };
}
