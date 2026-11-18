import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createKerrProbe, packKerrProbe, unpackKerrProbe, updateKerrProbe } from '../src/kerrprobe.js';
import { KERR_RAY } from '../src/kerrray.js';

function drop(radius, elevation, spin, theta = 0) {
  const c = Math.cos(25 * Math.PI / 180), s = Math.sin(25 * Math.PI / 180);
  const radial = [Math.sin(theta) * Math.cos(elevation), Math.sin(elevation), Math.cos(theta) * Math.cos(elevation)];
  const right = [Math.cos(theta), 0, -Math.sin(theta)];
  const direction = radial.map((v, i) => v * c + right[i] * s);
  direction[1] = Math.max(.18, direction[1]);
  return { position: radial.map(v => radius * v), direction, spin };
}

test('every camera/spin grid drop has strictly increasing arrivals and a loss event', () => {
  const measurements = [], gridStart = performance.now();
  for (const spin of [0, .9, .998]) for (const elevation of [0, .23, .8, 1.45]) for (const radius of [KERR_RAY.minimumCamera, 1.25, 1.5, 2, 3, 5, 6.9, 7, 7.5, 12, 23, 60]) {
    const start = performance.now(), probe = createKerrProbe(drop(radius, elevation, spin));
    measurements.push({ radius, elevation, spin, ms: performance.now() - start, state: probe.state });
    {
      assert.equal(probe.state, 'falling'); assert.ok(Number.isFinite(probe.lostTime) && probe.lostTime > 0);
      const rows = packKerrProbe(probe).data.timeline;
      assert.ok(rows.every((row, i) => !i || (row.t > rows[i - 1].t && row.arrival > rows[i - 1].arrival)), JSON.stringify({ radius, elevation, spin }));
      assert.ok(rows.at(-1).signal <= .02, 'every fall has a solved loss event');
      assert.ok(rows.some(row => row.signal < .25 && row.signal > .02), 'fading before loss');
      assert.ok(probe.flashEvents.every((e, i, rows) => !i || e.receptionTime > rows[i - 1].receptionTime));
      let previous = 0, fading = false;
      for (let i = 0; i <= 256; i++) {
        updateKerrProbe(probe, probe.lostTime / 256);
        assert.ok(probe.properElapsed >= previous, `${JSON.stringify({ radius, elevation, spin })}: causal onboard clock`);
        previous = probe.properElapsed; fading ||= probe.state === 'fading';
      }
      assert.equal(probe.state, 'lost'); assert.ok(fading, 'fading precedes loss');
    }
  }
  mkdirSync(new URL('../tmp/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../tmp/kerr-probe-grid.json', import.meta.url), JSON.stringify({ elapsedMs: performance.now() - gridStart, measurements }, null, 2));
});

test('real probe worker computes check-g off thread and returns a compact usable packet', async () => {
  const start = performance.now();
  const worker = new Worker(new URL('./kerrprobe-worker.mjs', import.meta.url));
  const dispatchMs = performance.now() - start;
  try {
    const received = once(worker, 'message');
    worker.postMessage(drop(23, .23, .998));
    const [result] = await received;
    assert.equal(result.notice, undefined);
    const decode = performance.now(), probe = unpackKerrProbe(result.packet);
    const unpackMs = performance.now() - decode;
    assert.equal(probe.state, 'falling'); assert.ok(probe.arrivalDelay > 0);
    assert.ok(result.packet.data.history.length < 600);
    updateKerrProbe(probe, probe.flashEvents[27].receptionTime + 1e-4);
    assert.equal(probe.flashCount, 28); assert.ok(probe.pulse > .95);
    writeFileSync(new URL('../tmp/kerr-probe-worker.json', import.meta.url), JSON.stringify({
      computeMs: result.computeMs, totalMs: performance.now() - start, dispatchMs, unpackMs,
      packetBytes: JSON.stringify(result.packet).length,
    }, null, 2));
  } finally { await worker.terminate(); }
});
