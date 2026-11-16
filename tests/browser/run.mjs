import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outDir = join(root, 'tmp/browser-out');
// Only rendered-pixel assertions require hardware GL.
const gpuChecks = new Set([
  'observer shadow measured on pixels at eight azimuths',
  'observer photon sphere boundary is a centre line',
  'picture round stars and retained default star brightness',
  'picture compressed hover sky retains dense compact stars',
  'picture luminous structured highlights in every preset and hot disk',
  'picture top view and resolved Einstein source references',
  'probe retarded clock signal colour visibility and loss',
  'probe pixel pulses stretch with the received onboard clock',
  'probe hull stays bounded from hover and up close',
]);
let output;
let server;
let browser;
let passed = 0;
let failed = 0;
let skipped = 0;

try {
  await mkdir(join(root, 'tmp'), { recursive: true });
  await mkdir(outDir, { recursive: true });
  output = await mkdtemp(join(root, 'tmp/browser-build-'));
  await build({ root, logLevel: 'silent', build: { outDir: output, emptyOutDir: true } });
  assert.deepEqual(await readdir(output), ['index.html']);
  const html = await readFile(join(output, 'index.html'));
  server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (path !== '/' && path !== '/index.html') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, args: process.env.EH_FORCE_SOFTWARE !== '1' && process.platform === 'darwin'
    ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [] });
  const detector = await browser.newPage();
  let renderer;
  try {
    renderer = await detector.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) throw new Error('WebGL 2 is unavailable');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      if (!info) throw new Error('WEBGL_debug_renderer_info is unavailable');
      const name = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return name;
    });
    assert.ok(typeof renderer === 'string' && renderer.length > 0, 'WebGL renderer name is unavailable');
  } finally {
    await detector.close();
  }
  const softwareRenderer = /swiftshader|llvmpipe/i.test(renderer);
  console.log(`Renderer: ${renderer}`);
  const modules = (await readdir(new URL('./checks/', import.meta.url))).filter(name => name.endsWith('.mjs')).sort();
  for (const name of modules) {
    const { checks } = await import(new URL(`./checks/${name}`, import.meta.url));
    for (const definition of checks) {
      const check = { gpu: gpuChecks.has(definition.name), ...definition };
      if (softwareRenderer && check.gpu) {
        skipped++;
        console.log(`skip ${check.name} (software renderer)`);
        continue;
      }
      const context = await browser.newContext({ viewport: check.viewport || { width: 1440, height: 900 }, ...check.contextOptions });
      const page = await context.newPage();
      page.setDefaultTimeout(softwareRenderer ? 60000 : 15000);
      const audit = { consoleErrors: [], foreignRequests: [] };
      await page.route('**/*', route => new URL(route.request().url()).origin === url
        ? route.continue() : route.abort('blockedbyclient'));
      page.on('console', message => { if (message.type() === 'error') audit.consoleErrors.push(message.text()); });
      page.on('pageerror', error => audit.consoleErrors.push(error.stack || error.message));
      page.on('request', request => {
        const address = new URL(request.url());
        if (address.origin !== url) audit.foreignRequests.push(request.url());
      });
      try {
        await page.goto(url + (check.path || ''), { waitUntil: 'load' });
        await page.waitForFunction(() => window.eventHorizon?.getState().clock > 0);
        await check.run({ page, url, outDir, audit });
        assert.deepEqual(audit.consoleErrors, [], 'console or page errors');
        assert.deepEqual(audit.foreignRequests, [], 'foreign-origin requests');
        passed++;
        console.log(`ok ${check.name}`);
      } catch (error) {
        failed++;
        const screenshot = join(outDir, `${check.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
        await page.screenshot({ path: screenshot }).catch(() => {});
        console.error(`FAIL ${check.name}: ${error.stack || error}\nScreenshot: ${screenshot}`);
      } finally {
        await page.close();
        await context.close();
      }
    }
  }
} catch (error) {
  failed++;
  console.error(`FAIL browser setup: ${error.stack || error}`);
} finally {
  try { await browser?.close(); } catch (error) { failed++; console.error(`FAIL browser cleanup: ${error}`); }
  try { if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  catch (error) { failed++; console.error(`FAIL server cleanup: ${error}`); }
  try { if (output) await rm(output, { recursive: true, force: true }); }
  catch (error) { failed++; console.error(`FAIL build cleanup: ${error}`); }
}
if (passed + failed === 0) {
  failed++;
  console.error('FAIL no browser checks executed');
}
console.log(`TOTAL ${passed + failed + skipped} pass ${passed} fail ${failed} skip ${skipped}`);
process.exitCode = failed > 0 || passed === 0 ? 1 : 0;
