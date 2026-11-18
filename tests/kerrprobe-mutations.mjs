import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const probe = new URL('../src/kerrprobe.js', import.meta.url), ray = new URL('../src/kerrray.js', import.meta.url);
const originals = new Map([probe, ray].map(path => [path, readFileSync(path, 'utf8')]));
const output = new URL('../tmp/k5-mutations/', import.meta.url);
mkdirSync(output, { recursive: true });
const replace = (text, from, to) => { assert.ok(text.includes(from), `Mutation anchor: ${from}`); return text.replace(from, to); };
const mutations = [
  { name: 'outward-only', path: ray, edit: text => replace(text, 'if (root && (!best || root.t > best.t))',
    'if (root && dot(root.x, flow(root, a, false).dx) < 0 && (!best || root.t > best.t))') },
  { name: 'later-root-no-order-check', path: ray, edit: text => replace(text, 'root.t > best.t', 'root.t < best.t'),
    extra: text => replace(text, 'export function assertReceptionOrder(rows) {', 'export function assertReceptionOrder(rows) { return;') },
  { name: 'receiver-clamped-to-seven', path: probe, edit: text => replace(text,
    'export function probeImage(position, spin, event, initialDirection, imageSeeds) {',
    'export function probeImage(position, spin, event, initialDirection, imageSeeds) {\n  position = position.map(v => v * Math.max(7, Math.hypot(...position)) / Math.hypot(...position));') },
  { name: 'old-inner-refusal', path: probe, edit: text => replace(text, 'const receiver = observerFrame(position, spin);',
    'const receiver = observerFrame(position, spin);\n  if (Math.hypot(...position) <= 7 * (1 + 4 * Number.EPSILON)) return "Probe not released: camera must be outside the release radius.";') },
];
const results = [];
const restore = () => { for (const [path, text] of originals) writeFileSync(path, text); };
try {
  for (const mutation of mutations) {
    restore();
    writeFileSync(mutation.path, mutation.edit(originals.get(mutation.path)));
    if (mutation.extra) writeFileSync(probe, mutation.extra(originals.get(probe)));
    const result = spawnSync(process.execPath, ['tests/kerrprobe-reception.test.js'], { encoding: 'utf8' });
    writeFileSync(new URL(`${mutation.name}.log`, output), result.stdout + result.stderr);
    results.push({ mutation: mutation.name, command: 'node tests/kerrprobe-reception.test.js', exit: result.status });
    console.log(JSON.stringify(results.at(-1)));
    assert.equal(result.status, 1, 'the mutation must fail a unit assertion');
  }
} finally { restore(); }
const restored = spawnSync(process.execPath, ['tests/kerrprobe-reception.test.js'], { encoding: 'utf8' });
writeFileSync(new URL('restored.log', output), restored.stdout + restored.stderr);
results.push({ mutation: 'restored', command: 'node tests/kerrprobe-reception.test.js', exit: restored.status });
writeFileSync(new URL('results.json', output), JSON.stringify(results, null, 2));
assert.equal(restored.status, 0, restored.stdout + restored.stderr);
console.log(JSON.stringify(results.at(-1)));
