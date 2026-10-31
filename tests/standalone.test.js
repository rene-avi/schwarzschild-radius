import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script } from 'node:vm';
import { build } from 'vite';

test('production build is one relocatable HTML file with classic JavaScript and embedded CSS', async () => {
  const output = await mkdtemp(join(tmpdir(), 'event-horizon-standalone-'));
  try {
    await build({ logLevel: 'silent', build: { outDir: output, emptyOutDir: true } });
    assert.deepEqual(await readdir(output), ['index.html']);
    const html = await readFile(join(output, 'index.html'), 'utf8');
    assert.match(html, /<style>[\s\S]+<\/style>/);
    assert.match(html, /id="boot-status"/);
    assert.match(html, /JavaScript is disabled/);
    const guard = html.match(/<script data-boot-guard>([\s\S]*?)<\/script>/);
    assert.ok(guard, 'startup diagnostics load independently of the application bundle');
    assert.doesNotThrow(() => new Script(guard[1]));
    assert.doesNotMatch(html, /<script\b[^>]*\b(?:src=|type=["']module)/i);
    assert.doesNotMatch(html, /<link\b[^>]*\brel=["'](?:stylesheet|modulepreload)/i);
    assert.doesNotMatch(html, /data-local-launcher|\/src\/main\.js|location\.replace/);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length, 1);
    assert.ok(html.indexOf('<canvas') < html.indexOf('<script>'), 'DOM exists before the classic entry runs');
    assert.doesNotThrow(() => new Script(scripts[0][1]), 'file:// entry has no import/export/import.meta syntax');
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
