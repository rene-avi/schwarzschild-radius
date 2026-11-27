import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const originals = new Map(['src/kerrprobe.js', 'src/kerrray.js'].map(path => [path, readFileSync(join(root, path), 'utf8')]));
const output = new URL('../tmp/k5-mutations/', import.meta.url);
mkdirSync(output, { recursive: true });
const replace = (text, from, to) => { assert.ok(text.includes(from), `Mutation anchor: ${from}`); return text.replace(from, to); };
const mutations = [
  { name: 'outward-only', path: 'src/kerrray.js', edit: text => replace(text, 'if (root && (!best || root.t > best.t))',
    'if (root && dot(root.x, flow(root, a, false).dx) < 0 && (!best || root.t > best.t))') },
  { name: 'later-root-no-order-check', path: 'src/kerrray.js', edit: text => replace(text, 'root.t > best.t', 'root.t < best.t'),
    extra: text => replace(text, 'export function assertReceptionOrder(rows) {', 'export function assertReceptionOrder(rows) { return;') },
  { name: 'receiver-clamped-to-seven', path: 'src/kerrprobe.js', edit: text => replace(text,
    'export function probeImage(position, spin, event, initialDirection, imageSeeds) {',
    'export function probeImage(position, spin, event, initialDirection, imageSeeds) {\n  position = position.map(v => v * Math.max(7, Math.hypot(...position)) / Math.hypot(...position));') },
  { name: 'old-inner-refusal', path: 'src/kerrprobe.js', edit: text => replace(text, 'const receiver = observerFrame(position, spin);',
    'const receiver = observerFrame(position, spin);\n  if (Math.hypot(...position) <= 7 * (1 + 4 * Number.EPSILON)) return "Probe not released: camera must be outside the release radius.";') },
  { name: 'M1-backward-continuation-disabled', path: 'src/kerrprobe.js', test: 'tests/kerrprobe-accuracy.test.js', edit: text => replace(text,
    'const additions = refine(timeline[i], timeline[i + 1]);', 'continue;\n    const additions = refine(timeline[i], timeline[i + 1]);') },
  { name: 'M2-timeline-signal-scaled', path: 'src/kerrprobe.js', edit: text => replace(text,
    "  const probe = { metric: 'kerr', spin, direction:",
    "  for (const row of timeline.slice(1)) row.signal *= 1.001;\n  const probe = { metric: 'kerr', spin, direction:") },
];
const results = [];
for (const mutation of mutations) {
  const directory = mkdtempSync(join(tmpdir(), 'event-horizon-kerr-mutant-'));
  try {
    for (const path of ['src', 'tests', 'package.json']) cpSync(join(root, path), join(directory, path), { recursive: true });
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    writeFileSync(join(directory, mutation.path), mutation.edit(originals.get(mutation.path)));
    if (mutation.extra) writeFileSync(join(directory, 'src/kerrprobe.js'), mutation.extra(originals.get('src/kerrprobe.js')));
    const test = mutation.test ?? 'tests/kerrprobe-reception.test.js';
    const result = spawnSync(process.execPath, [test], { cwd: directory, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(new URL(`${mutation.name}.log`, output), result.stdout + result.stderr);
    results.push({ mutation: mutation.name, command: `node ${test}`, exit: result.status });
    writeFileSync(new URL('results.json', output), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results.at(-1)));
    assert.equal(result.status, 1, 'the mutation must fail a unit assertion');
    if (mutation.name.startsWith('M')) assert.match(result.stdout, /AssertionError/, 'a failed assertion must kill the mutant');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
for (const [path, original] of originals) assert.equal(readFileSync(join(root, path), 'utf8'), original, `${path} stays untouched`);
const restored = spawnSync(process.execPath, ['tests/kerrprobe-reception.test.js'], { cwd: root, encoding: 'utf8' });
writeFileSync(new URL('restored.log', output), restored.stdout + restored.stderr);
results.push({ mutation: 'unmodified-worktree', command: 'node tests/kerrprobe-reception.test.js', exit: restored.status });
writeFileSync(new URL('results.json', output), JSON.stringify(results, null, 2));
assert.equal(restored.status, 0, restored.stdout + restored.stderr);
console.log(JSON.stringify(results.at(-1)));
