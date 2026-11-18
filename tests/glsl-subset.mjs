import assert from 'node:assert/strict';

// Only arithmetic expressions used by the Kerr contracts; never execute source as JS.
const binary = (a, b, fn) => Array.isArray(a) ? a.map((v, i) => fn(v, Array.isArray(b) ? b[i] : b))
  : Array.isArray(b) ? b.map(v => fn(a, v)) : fn(a, b);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const builtins = {
  sqrt: Math.sqrt, inversesqrt: x => 1 / Math.sqrt(x), pow: Math.pow, abs: Math.abs, sin: Math.sin, cos: Math.cos, atan: Math.atan2,
  min: Math.min, max: Math.max, mod: (a, b) => a - b * Math.floor(a / b),
  clamp: (x, a, b) => Math.max(a, Math.min(b, x)), fract: x => x - Math.floor(x),
  smoothstep: (a, b, x) => { const s = Math.max(0, Math.min(1, (x - a) / (b - a))); return s * s * (3 - 2 * s); },
  length: a => Math.hypot(...a), normalize: a => a.map(v => v / Math.hypot(...a)), dot,
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  vec2: (...v) => v.length === 1 && !Array.isArray(v[0]) ? [v[0], v[0]] : v.flat(),
  vec3: (...v) => v.length === 1 && !Array.isArray(v[0]) ? [v[0], v[0], v[0]] : v.flat(),
  vec4: (...v) => v.flat(),
  mix: (a, b, t) => binary(binary(a, 1 - t, (x, y) => x * y), binary(b, t, (x, y) => x * y), (x, y) => x + y),
};
const precedence = { '<': 1, '>': 1, '<=': 1, '>=': 1, '+': 2, '-': 2, '*': 3, '/': 3 };
const operations = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b,
  '/': (a, b) => a / b, '<': (a, b) => a < b, '>': (a, b) => a > b,
  '<=': (a, b) => a <= b, '>=': (a, b) => a >= b };

export function evaluate(expression, values = {}, functions = {}) {
  const tokens = [];
  const lexer = /\s*(\d+(?:\.\d*)?(?:e[+-]?\d+)?|[A-Za-z_]\w*|<=|>=|[+*/().,<>?:-])/gy;
  let offset = 0;
  while (expression.slice(offset).trim()) {
    lexer.lastIndex = offset;
    const match = lexer.exec(expression);
    assert.ok(match, `Unsupported GLSL near ${expression.slice(offset)}`);
    tokens.push(match[1]); offset = lexer.lastIndex;
  }
  let cursor = 0;
  const take = token => assert.equal(tokens[cursor++], token);
  function parse(minimum = 0) {
    let value, token = tokens[cursor++];
    if (token === '-' || token === '+') value = binary(0, parse(4), operations[token]);
    else if (token === '(') { value = parse(); take(')'); }
    else if (/^\d/.test(token)) value = Number(token);
    else if (tokens[cursor] === '(') {
      cursor++;
      const args = [];
      if (tokens[cursor] !== ')') {
        do { args.push(parse()); } while (tokens[cursor] === ',' && ++cursor);
      }
      take(')');
      const fn = functions[token] ?? builtins[token];
      assert.equal(typeof fn, 'function', `Known GLSL function ${token}`);
      value = fn(...args);
    } else {
      assert.ok(Object.hasOwn(values, token), `Known GLSL variable ${token}`);
      value = values[token];
    }
    while (tokens[cursor] === '.') {
      cursor++;
      const fields = tokens[cursor++].split('').map(c => 'xyzw'.indexOf(c));
      assert.ok(Array.isArray(value) && fields.every(i => i >= 0 && i < value.length), 'valid swizzle');
      value = fields.length === 1 ? value[fields[0]] : fields.map(i => value[i]);
    }
    while (Object.hasOwn(precedence, tokens[cursor]) && precedence[tokens[cursor]] >= minimum) {
      const operator = tokens[cursor++];
      value = binary(value, parse(precedence[operator] + 1), operations[operator]);
    }
    if (minimum === 0 && tokens[cursor] === '?') {
      cursor++;
      const yes = parse(); take(':'); const no = parse();
      value = value ? yes : no;
    }
    return value;
  }
  const result = parse();
  assert.equal(cursor, tokens.length, 'entire GLSL expression evaluated');
  return result;
}

export function functionBody(source, name) {
  const signature = source.indexOf(` ${name}(`);
  assert.ok(signature >= 0, `GLSL function ${name}`);
  const start = source.indexOf('{', signature);
  assert.ok(start >= 0, `GLSL function ${name}`);
  let depth = 1, end = start + 1;
  for (; end < source.length && depth; end++) depth += Number(source[end] === '{') - Number(source[end] === '}');
  assert.equal(depth, 0);
  return source.slice(start + 1, end - 1).replace(/\/\/[^\n]*/g, '');
}

export function assignment(source, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*`).exec(source);
  assert.ok(match, `GLSL assignment ${name}`);
  const start = match.index + match[0].length;
  let depth = 0, end = start;
  for (; end < source.length; end++) {
    const token = source[end];
    if (depth === 0 && (token === ',' || token === ';')) break;
    if (token === '(' || token === '[') depth++;
    if (token === ')' || token === ']') depth--;
  }
  return source.slice(start, end);
}

export function lastReturn(source) {
  const returns = [...source.matchAll(/\breturn\s+([^;]+);/g)];
  assert.ok(returns.length);
  return returns.at(-1)[1];
}
