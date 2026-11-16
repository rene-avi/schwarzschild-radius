import { horizonOffset, photonOffset, iscoOffset } from './kerr.js';
import { worlds } from './worlds.js';
import { formatFactor } from './ledger.js';

/** Subtract offsets, never rounded radii, to retain near-horizon heights in M. */
export function heightAboveHorizon(radius, delta) {
  const offset = typeof radius === 'number' ? radius - 1 : radius.offset;
  return offset - horizonOffset(delta);
}

/** One decade separates the clamped horizon disc from the prograde photon ring. */
export function radialScale(delta, width) {
  if (!Number.isFinite(width) || width < 188) throw new RangeError('Map width must be at least 188 px.');
  const hMin = heightAboveHorizon({ offset: photonOffset(delta) }, delta) / 10;
  const hMax = heightAboveHorizon(worlds(delta).find(body => body.id === 'ship').radius, delta);
  const rho0 = 10;
  const rhoMax = width / 2 - 8;
  return { hMin, hMax, rho0, rhoMax, k: (rhoMax - rho0) / Math.log10(hMax / hMin) };
}

export function mapHeight(h, scale) {
  return h <= scale.hMin ? scale.rho0 : scale.rho0 + scale.k * Math.log10(h / scale.hMin);
}

/** The clamped disc has no unique inverse; its boundary returns hMin. */
export function unmapRadius(rho, scale) {
  return scale.hMin * 10 ** (Math.max(0, rho - scale.rho0) / scale.k);
}

const placements = {
  ship: { angle: -125, side: 'start', y: 16 },
  farShore: { angle: -35, side: 'end', y: 48 },
  lantern: { angle: 170, side: 'start', y: 80 },
  horizon: { angle: 0, side: 'end', y: 112 },
  brink: { angle: 45, side: 'end', y: 160 },
  photon: { angle: 110, side: 'start', y: 208 },
};

/** Fixed label lanes reserve 5.6 px/character and 11 px height for 9 px mono. */
export function mapModel(delta, width) {
  const scale = radialScale(delta, width);
  const center = { x: width / 2, y: 112 };
  const allWorlds = worlds(delta);
  const bodies = ['ship', 'farShore', 'lantern', 'brink'].map(id => {
    const body = allWorlds.find(body => body.id === id);
    const factor = formatFactor(body.dtdtau);
    return {
      id, h: heightAboveHorizon(body.radius, delta), factor,
      label: `${body.name} ${factor}${id === 'brink' ? ' · ISCO' : ''}`,
    };
  });
  const rings = [
    { id: 'horizon', h: 0 },
    { id: 'photon', h: heightAboveHorizon({ offset: photonOffset(delta) }, delta) },
    { id: 'isco', h: heightAboveHorizon({ offset: iscoOffset(delta) }, delta) },
    ...bodies.map(({ id, h }) => ({ id, h })),
  ].map(ring => ({ ...ring, rho: mapHeight(ring.h, scale) }));
  const labels = [
    ...bodies,
    { id: 'photon', h: rings.find(ring => ring.id === 'photon').h, label: 'photon orbit' },
    { id: 'horizon', h: 0, label: 'horizon' },
  ].map(item => {
    const { angle, side, y } = placements[item.id];
    const rho = mapHeight(item.h, scale);
    const radians = angle * Math.PI / 180;
    const point = { x: center.x + rho * Math.cos(radians), y: center.y + rho * Math.sin(radians) };
    const anchor = { x: side === 'start' ? 6 : width - 6, y };
    const boxWidth = item.label.length * 5.6;
    const box = { x: anchor.x - (side === 'end' ? boxWidth : 0), y: y - 5.5, width: boxWidth, height: 11 };
    return { ...item, rho, angle, point, anchor, side, box };
  });
  return { width, height: 224, center, scale, rings, labels, bodies: labels.filter(item => item.factor !== undefined) };
}
