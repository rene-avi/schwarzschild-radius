import assert from 'node:assert/strict';

const NativeFunction = globalThis.Function;
let calls = 0;
try {
  globalThis.Function = function () {
    calls++;
    throw new Error('Function construction during default imports');
  };
  const { traceRay, observerFrame } = await import('../src/kerrray.js');
  await import('../src/shaders/blackhole.js');
  const { createRayMaterial } = await import('../src/scene.js');
  const material = createRayMaterial({});
  material.dispose();
  observerFrame([0, 0, 23], 0.9);
  assert.equal(calls, 0, 'default imports/material and observer frame need no unsafe-eval');
  globalThis.Function = function (...args) {
    calls++;
    return new NativeFunction(...args);
  };
  const ray = { position: [0, 0, 23], direction: [-1, 0, 0], spin: 0.9 };
  assert.equal(traceRay(ray).fate, 'captured');
  assert.equal(calls, 1, 'double kernel compiled on first trace');
  traceRay(ray);
  assert.equal(calls, 1, 'compiled double kernel reused');
  traceRay({ ...ray, float32: true });
  assert.equal(calls, 2, 'float32 kernel compiled only when requested');
} finally {
  globalThis.Function = NativeFunction;
}
