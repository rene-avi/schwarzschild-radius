import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createKerrProbe, packKerrProbe, unpackKerrProbe, updateKerrProbe, integrateProbe, historyAt, probeImage } from '../src/kerrprobe.js';

test('adaptive received telemetry midpoints and fading onset match direct solves for near and far receivers', () => {
  const measurements = [], elevation = .23, c = Math.cos(25 * Math.PI / 180);
  const direction = [Math.sin(25 * Math.PI / 180), c * Math.sin(elevation), c * Math.cos(elevation)];
  const histories = new Map();
  for (const spin of [0, .998]) for (const radius of [23, 3, 1.1]) {
    const position = [0, radius * Math.sin(elevation), radius * Math.cos(elevation)];
    if (!histories.has(spin)) histories.set(spin, integrateProbe({ spin, direction, endUt: 512 }));
    const history = histories.get(spin), probe = createKerrProbe({ position, spin, direction });
    const packet = packKerrProbe(probe), rows = packet.data.timeline;
    let maxGError = 0, worstRadius;
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i], b = rows[i + 1], event = historyAt(history, (a.t + b.t) / 2);
      const direct = probeImage(position, spin, event, a.direction, a.imageSeeds);
      const received = event.t + direct.delay - probe.arrivalDelay;
      const sample = unpackKerrProbe({ probe: { ...probe, elapsed: 0 }, data: packet.data });
      updateKerrProbe(sample, received);
      const error = Math.abs(sample.signal - direct.g);
      if (error > maxGError) { maxGError = error; worstRadius = event.radius; }
    }
    const i = rows.findIndex(row => row.signal < .25), a = rows[i - 1], b = rows[i];
    const interpolatedFade = a.receptionTime + (.25 - a.signal) / (b.signal - a.signal) * (b.receptionTime - a.receptionTime);
    let lo = a.t, hi = b.t, direct;
    for (let j = 0; j < 24; j++) {
      const event = historyAt(history, (lo + hi) / 2);
      direct = probeImage(position, spin, event);
      if (direct.g >= .25) lo = event.t; else hi = event.t;
    }
    const fadeError = Math.abs(interpolatedFade - ((lo + hi) / 2 + direct.delay - probe.arrivalDelay));
    const measurement = { spin, radius, rows: rows.length, maxGError, worstRadius, fadeError };
    measurements.push(measurement);
    mkdirSync(new URL('../tmp/', import.meta.url), { recursive: true });
    writeFileSync(new URL('../tmp/kerr-probe-accuracy.json', import.meta.url), JSON.stringify(measurements, null, 2));
    assert.ok(maxGError <= .01, JSON.stringify(measurement));
    assert.ok(fadeError <= .005, JSON.stringify(measurement));
  }
});
