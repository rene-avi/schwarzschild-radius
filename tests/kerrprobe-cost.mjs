import { mkdirSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { unpackKerrProbe, updateKerrProbe } from '../src/kerrprobe.js';
import { KERR_RAY } from '../src/kerrray.js';

const elevation = .23, c = Math.cos(25 * Math.PI / 180), s = Math.sin(25 * Math.PI / 180);
const measurements = [];
for (const radius of [23, 3, 1.5, KERR_RAY.minimumCamera]) {
  const start = performance.now();
  const worker = new Worker(new URL('./kerrprobe-worker.mjs', import.meta.url));
  const dispatchMs = performance.now() - start;
  try {
    const received = once(worker, 'message');
    worker.postMessage({ position: [0, radius * Math.sin(elevation), radius * Math.cos(elevation)],
      direction: [s, c * Math.sin(elevation), c * Math.cos(elevation)], spin: .998 });
    const [result] = await received;
    if (result.notice) throw new RangeError(result.notice);
    const decodeStart = performance.now(), probe = unpackKerrProbe(result.packet);
    const unpackMs = performance.now() - decodeStart, signal = probe.signal;
    let maximumUpdateMs = 0;
    for (let i = 0; i < 256; i++) {
      const tick = performance.now(); updateKerrProbe(probe, probe.lostTime / 256);
      maximumUpdateMs = Math.max(maximumUpdateMs, performance.now() - tick);
    }
    measurements.push({ radius, computeMs: result.computeMs, totalMs: performance.now() - start, dispatchMs, unpackMs,
      maximumUpdateMs, signal, lostTime: probe.lostTime, packetBytes: JSON.stringify(result.packet).length });
  } finally { await worker.terminate(); }
}
mkdirSync(new URL('../tmp/', import.meta.url), { recursive: true });
writeFileSync(new URL('../tmp/kerr-probe-cost.json', import.meta.url), JSON.stringify(measurements, null, 2));
console.log(JSON.stringify(measurements, null, 2));
