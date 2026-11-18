import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { unpackKerrProbe, updateKerrProbe } from '../src/kerrprobe.js';
import { KERR_RAY } from '../src/kerrray.js';

const elevation = .23, c = Math.cos(25 * Math.PI / 180), s = Math.sin(25 * Math.PI / 180);
const measurements = [];
const scratch = fileURLToPath(new URL('../tmp/', import.meta.url));
mkdirSync(scratch, { recursive: true });
const instrumented = mkdtempSync(join(scratch, 'kerr-cost-'));
for (const path of ['src', 'package.json']) cpSync(new URL('../' + path, import.meta.url), join(instrumented, path), { recursive: true });
const ray = join(instrumented, 'src/kerrray.js'), workerSource = join(instrumented, 'src/kerrprobe-worker.js');
writeFileSync(ray, readFileSync(ray, 'utf8').replace('function rkStep(state, a, h, f32) {',
  'function rkStep(state, a, h, f32) { globalThis.kerrProbeRKSteps = (globalThis.kerrProbeRKSteps ?? 0) + 1;'));
writeFileSync(workerSource, readFileSync(workerSource, 'utf8').replace('...result, computeMs:', '...result, rkSteps: globalThis.kerrProbeRKSteps, computeMs:'));
mkdirSync(join(instrumented, 'tests'));
cpSync(new URL('./kerrprobe-worker.mjs', import.meta.url), join(instrumented, 'tests/kerrprobe-worker.mjs'));
try {
  for (const radius of [23, 3, 1.5, KERR_RAY.minimumCamera]) {
    const start = performance.now();
    const worker = new Worker(pathToFileURL(join(instrumented, 'tests/kerrprobe-worker.mjs')));
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
      measurements.push({ radius, rkSteps: result.rkSteps, computeMs: result.computeMs, totalMs: performance.now() - start, dispatchMs, unpackMs,
        maximumUpdateMs, signal, lostTime: probe.lostTime, packetBytes: JSON.stringify(result.packet).length });
    } finally { await worker.terminate(); }
  }
} finally { rmSync(instrumented, { recursive: true, force: true }); }
for (const row of measurements) { row.rkRatio = row.rkSteps / measurements[0].rkSteps; row.wallRatio = row.computeMs / measurements[0].computeMs; }
writeFileSync(new URL('../tmp/kerr-probe-cost.json', import.meta.url), JSON.stringify(measurements, null, 2));
console.log(JSON.stringify(measurements, null, 2));
