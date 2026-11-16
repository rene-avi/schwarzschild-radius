import test from 'node:test';
import assert from 'node:assert/strict';
import { fragmentShader } from '../src/shaders/blackhole.js';

function body(name) {
  const start = fragmentShader.indexOf(` ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const open = fragmentShader.indexOf('{', start);
  let depth = 1, end = open + 1;
  while (depth && end < fragmentShader.length) {
    if (fragmentShader[end] === '{') depth++;
    if (fragmentShader[end] === '}') depth--;
    end++;
  }
  assert.equal(depth, 0, `${name} has a complete body`);
  return fragmentShader.slice(open + 1, end - 1).replace(/\/\/[^\n]*/g, '');
}

const stars = body('starFace'), sky = body('skyColor'), noise = body('skyNoise');
const calls = (source, name) => [...source.matchAll(new RegExp(`\\b${name}\\(`, 'g'))].length;

function onlyHelpers(name, helpers) {
  const builtins = new Set(['if', 'for', 'return', 'float', 'vec2', 'vec3', 'abs', 'any', 'clamp', 'cross', 'dFdx', 'dFdy',
    'dot', 'exp', 'floor', 'fract', 'greaterThan', 'length', 'max', 'min', 'mix', 'mod', 'normalize', 'pow', 'sign',
    'smoothstep', 'sqrt', 'step']);
  for (const [, call] of body(name).matchAll(/\b(\w+)\s*\(/g)) {
    assert.ok(builtins.has(call) || helpers.includes(call), `${name}: unbudgeted helper ${call}`);
  }
}

function cellBudget() {
  const loops = [...stars.matchAll(/for \(int ([xy]) = (-?\d+); \1 <= (-?\d+); \1\+\+\)/g)];
  assert.equal(loops.length, 2);
  assert.equal((stars.match(/\b(?:for|while|do)\b/g) || []).length, 2, 'no compression-dependent catalogue search');
  assert.equal(calls(stars, 'hash31') > 0, true);
  assert.equal((stars.match(/hash31\(key\)/g) || []).length, 1, 'one catalogue identity per candidate');
  return loops.reduce((count, [, , start, end]) => count * (Number(end) - Number(start) + 1), 1);
}

function noiseBudget(footprint) {
  const octaves = [...sky.matchAll(/if \(footprint \* ([\d.]+) < ([\d.]+)\) \w+ = skyNoise\(ray \* \1 [^;]+;/g)];
  assert.equal(calls(sky, 'skyNoise'), octaves.length, 'every octave is guarded before evaluation');
  assert.doesNotMatch(sky + noise + body('skyGradient'), /\b(?:for|while|do)\b/);
  assert.equal(calls(noise, 'skyGradient'), 8);
  assert.equal(calls(body('skyGradient'), 'hash31'), 1);
  assert.match(noise.trimStart(), /^if \(footprint >= 0\.65\) return 0\.5;/);
  return octaves.filter(([, scale, cutoff]) => footprint * Number(scale) < Number(cutoff)).length;
}

test('sky work is bounded at default and near-horizon radii, including cube corners', () => {
  for (const [name, helpers] of [
    ['observedSky', ['skyColor']], ['skyColor', ['starFace', 'skyNoise']], ['starFace', ['hash31', 'blackbody']],
    ['skyNoise', ['skyGradient']], ['skyGradient', ['hash31']], ['hash31', []], ['blackbody', []],
  ]) onlyHelpers(name, helpers);
  assert.equal(calls(body('observedSky'), 'skyColor'), 1);
  assert.equal(calls(stars, 'hash31'), 5, 'bounded identity, selection, jitter and temperature hashes');
  const faces = [...sky.matchAll(/if \(ar\.([xyz]) >= major - overlap\) skyLight \+= starFace\(/g)];
  assert.deepEqual(faces.map(([, axis]) => axis), ['x', 'y', 'z']);
  assert.equal(calls(sky, 'starFace'), faces.length);
  assert.doesNotMatch(sky, /\b(?:for|while|do)\b/);
  assert.equal(cellBudget(), 9, 'nine bounded support tests per face');
  assert.match(stars, /if \(stable <= 0\.0\) return vec3\(0\.0\);[\s\S]*for \(/);
  assert.ok(stars.indexOf('greaterThan(nearest, reach)') < stars.indexOf('hash31(key)'), 'support rejection precedes hashing');
  for (const radius of [23, 1.4]) {
    // Radius and lens compression cannot increase either fixed search budget.
    assert.equal(cellBudget() * faces.length, 27, `r=${radius}: maximum candidates across three faces`);
    assert.deepEqual([0, 0.005, 0.025, 0.08].map(noiseBudget), [2, 2, 1, 0], `r=${radius}: resolved octaves`);
    assert.equal(noiseBudget(0) * calls(noise, 'skyGradient'), 16, `r=${radius}: maximum gradients/hashes`);
  }
  assert.equal(noiseBudget(0.65 / 27), 1, 'fine octave stops at its cutoff');
  assert.equal(noiseBudget(0.65 / 9), 0, 'coarse octave stops at its cutoff');
  assert.match(body('observedSky').trimStart(), /^if \(uLayers\.y < 0\.5\) return vec3\(0\.0\);/,
    'disabled sky returns before all sky work');
});

test('pre-hash cell rejection conservatively contains every original five-pixel profile', () => {
  assert.match(stars, /vec2 reach = sqrt\(jx \* jx \+ jy \* jy\) \* cells \* 0\.5 \* uPixelRatio \* 5\.0;/);
  assert.match(stars, /vec2 nearest = max\(max\(id \+ 0\.12 - grid, grid - id - 0\.88\), vec2\(0\.0\)\);/);
  assert.match(stars, /vec2 jitter = 0\.12 \+ 0\.76 \*/);
  assert.match(stars, /if \(dot\(offset, offset\) > 25\.0\) continue;/);
  assert.match(stars, /vec2 cell = floor\(grid\);/);
  // Cauchy-Schwarz bounds each projected axis, including rotated and sheared rays.
  for (const [jx, jy] of [[[0.03, 0], [0, 0.03]], [[0.25, 0.2], [-0.1, 0.07]], [[0.001, 0.6], [0.02, -0.4]]]) {
    for (let i = 0; i < 128; i++) {
      const angle = i / 128 * Math.PI * 2;
      const offset = [5 * Math.cos(angle), 5 * Math.sin(angle)];
      for (let axis = 0; axis < 2; axis++) {
        const delta = jx[axis] * offset[0] + jy[axis] * offset[1];
        assert.ok(Math.abs(delta) <= Math.hypot(jx[axis], jy[axis]) * 5 + 1e-12);
      }
    }
  }
});

const mix = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function scalar(name, args) {
  const expression = stars.match(new RegExp(`float ${name} = ([^;]+);`));
  assert.ok(expression, `${name} is a scalar profile expression`);
  return new Function(...args, 'mix', 'pow', 'smoothstep', `return ${expression[1]};`);
}

test('compressed stars are mostly faint pixel cores with a few percent bright round sources', () => {
  const magnitude = scalar('magnitude', ['population', 'compression']);
  const radius = scalar('radius', ['population', 'compression', 'rare']);
  const rare = scalar('rare', ['population']);
  const compression = scalar('compression', ['uLensing', 'uCameraPosition', 'length']);
  assert.equal(compression(1, 23, x => x, mix, Math.pow, smoothstep), 0);
  assert.equal(compression(1, 1.03, x => x, mix, Math.pow, smoothstep), 1);
  let faint = 0, small = 0, bright = 0;
  const samples = 10000;
  for (let i = 0; i < samples; i++) {
    const p = (i + 0.5) / samples, r = rare(p, mix, Math.pow, smoothstep);
    const flux = magnitude(p, 1, mix, Math.pow, smoothstep);
    const size = radius(p, 1, r, mix, Math.pow, smoothstep);
    if (flux < 0.04) faint++;
    if (size < 0.6) small++;
    if (flux >= 0.7) bright++;
    assert.equal(magnitude(p, 0, mix, Math.pow, smoothstep), 0.045 + 1.35 * p ** 7,
      'default catalogue brightness is preserved');
    assert.equal(radius(p, 0, r, mix, Math.pow, smoothstep), 1.35 + 0.2 * r,
      'default core radius is preserved');
    assert.ok(size <= 1.55 && flux <= 1.354);
  }
  assert.ok(faint / samples > 0.8, `${faint / samples} of hover stars have faint flux`);
  assert.ok(small / samples > 0.75, `${small / samples} of hover cores have radius <0.6 px`);
  assert.ok(bright / samples >= 0.02 && bright / samples <= 0.05, `${bright / samples} bright fraction`);
});
