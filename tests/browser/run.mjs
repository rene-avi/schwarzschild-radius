import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'vite';
import { chromium, webkit } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const outDir = join(root, 'tmp/browser-out');
const SOFTWARE_DEVICE_SCALE_FACTOR = 0.25;
const profile = process.env.EH_BROWSER_TIMING === '1';
const engine = process.argv.find(arg => arg.startsWith('--engine='))?.slice('--engine='.length)
  || process.env.EH_BROWSER_ENGINE || 'chromium';
const timings = [];
let activeTiming;
let reusable;

async function timed(kind, name, operation) {
  const start = performance.now();
  let status = 'ok';
  try { return await operation(); }
  catch (error) { status = 'fail'; throw error; }
  finally {
    if (profile && activeTiming) {
      const event = { kind, name, ms: +(performance.now() - start).toFixed(2), status };
      activeTiming.events.push(event);
      console.log(`TIMING ${JSON.stringify({ check: activeTiming.name, ...event })}`);
    }
  }
}

function instrumentPage(page) {
  const label = value => String(value ?? '').replace(/\s+/g, ' ').slice(0, 240);
  for (const method of ['goto', 'waitForFunction', 'waitForTimeout', 'evaluate', 'screenshot', 'setViewportSize']) {
    const original = page[method].bind(page);
    page[method] = (...args) => timed(method.startsWith('wait') ? 'wait' : 'action',
      `${method}: ${label(args[0])}`, () => original(...args));
  }
  for (const device of [page.keyboard, page.mouse, page.touchscreen]) {
    for (const method of ['press', 'type', 'down', 'up', 'move', 'click', 'wheel', 'tap']) {
      if (typeof device[method] !== 'function') continue;
      const original = device[method].bind(device);
      device[method] = (...args) => timed('action', `${device === page.keyboard ? 'keyboard' : device === page.mouse ? 'mouse' : 'touch'}.${method}: ${label(args)}`, () => original(...args));
    }
  }
  const factories = new Set(['locator', 'getByRole', 'getByText', 'getByLabel', 'getByTestId', 'filter', 'first', 'last', 'nth']);
  const actions = new Set(['click', 'focus', 'press', 'fill', 'evaluate', 'evaluateAll', 'screenshot', 'waitFor', 'scrollIntoViewIfNeeded']);
  const wrapLocator = (locator, description) => new Proxy(locator, { get(target, property) {
    const value = target[property];
    if (typeof value !== 'function') return value;
    if (factories.has(property)) return (...args) => wrapLocator(value.apply(target, args), `${description}.${property}(${label(args)})`);
    if (actions.has(property)) return (...args) => timed(property === 'waitFor' ? 'wait' : 'action', `${description}.${property}`, () => value.apply(target, args));
    return value.bind(target);
  } });
  for (const method of ['locator', 'getByRole', 'getByText', 'getByLabel', 'getByTestId']) {
    const original = page[method].bind(page);
    page[method] = (...args) => wrapLocator(original(...args), `${method}(${label(args)})`);
  }
}

async function resetPage(page, viewport) {
  await page.setViewportSize(viewport);
  await page.evaluate(() => {
    const app = window.eventHorizon;
    const click = selector => document.querySelector(selector).click();
    document.querySelector('dialog').close();
    document.body.classList.remove('hud-hidden');
    app.debug.setPaused(false);
    app.debug.setLayers({ disk: true, sky: true, ring: true, probe: true, worlds: true });
    click('[data-preset="gargantua"]');
    click('[data-quality="auto"]');
    click('[data-action="mission-reset"]');
    click('[data-mission-view="clocks"]');
    if (app.getState().mission.open) click('[data-action="mission"]');
    const controls = document.querySelector('.control-panel');
    if (controls.inert !== (innerWidth <= 760)) click('.panel-toggle');
    for (const panel of document.querySelectorAll('.control-panel, .mission-panel')) panel.scrollTop = 0;
    document.querySelector('#universe').focus();
  });
  await page.waitForFunction(() => {
    const s = window.eventHorizon.getState();
    const controls = document.querySelector('.control-panel');
    return s.clock > 0 && !s.paused && s.camera.mode === 'orbit' && s.camera.radius === 23 && s.probe === null
      && s.settings.name === 'Gargantua' && s.qualityMode === 'auto' && s.renderScale === 1
      && !s.mission.open && !s.mission.running && s.ledger.crewSeconds === 0 && s.ledger.location === 'ship'
      && document.querySelector('[data-ledger="crew"]').textContent === '0 s'
      && document.querySelector('[data-mission-view="clocks"]').getAttribute('aria-pressed') === 'true'
      && controls.inert === (innerWidth <= 760)
      && getComputedStyle(controls).opacity === (innerWidth <= 760 ? '0' : '1')
      && getComputedStyle(document.querySelector('.mission-panel')).opacity === '0';
  });
}

async function saveTimings() {
  await writeFile(join(outDir, 'timings.json'), `${JSON.stringify({ engine, checks: timings }, null, 2)}\n`);
  const rows = [...timings].sort((a, b) => b.ms - a.ms).slice(0, 10)
    .map(t => `| ${t.name} | ${(t.ms / 1000).toFixed(2)} | ${t.status} |`);
  await writeFile(join(outDir, 'slowest-checks.md'), `### Slowest browser checks (${engine})\n\n| Check | Seconds | Result |\n| --- | ---: | --- |\n${rows.join('\n')}\n`);
}

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
  'spheres mission gate and localized image changes',
  'spheres default images clear visible panels',
  'spheres direct images across weak field boundary',
  'spheres disk crossing order retains foreground light',
  'spheres reference lensing gate',
]);
let output;
let server;
let browser;
let passed = 0;
let failed = 0;
let skipped = 0;
let checkLoopStarted;
let checkLoopElapsed = 0;

try {
  await mkdir(join(root, 'tmp'), { recursive: true });
  await mkdir(outDir, { recursive: true });
  await saveTimings();
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
  assert.ok(['chromium', 'webkit'].includes(engine), `Unknown browser engine: ${engine}`);
  browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true,
    ...(engine === 'chromium' ? { args: process.env.EH_FORCE_SOFTWARE === '1'
      ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
      : process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [] } : {}),
  });
  const detector = await browser.newPage();
  let renderer;
  try {
    renderer = await detector.evaluate(engine => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) throw new Error('WebGL 2 is unavailable');
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      if (!info && engine !== 'webkit') throw new Error('WEBGL_debug_renderer_info is unavailable');
      const name = gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      const vendor = gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return { name, vendor };
    }, engine);
    assert.ok(typeof renderer.name === 'string' && renderer.name.length > 0, 'WebGL renderer name is unavailable');
  } finally {
    await detector.close();
  }
  const softwareRenderer = /swiftshader|llvmpipe|softpipe|software|swrast|lavapipe|microsoft basic render/i.test(renderer.name);
  // WebKit pixel checks require positive hardware identification, including generic Apple GL names.
  const hardwareRenderer = !softwareRenderer && /apple|intel|nvidia|amd|radeon|geforce|adreno|mali|powervr/i.test(`${renderer.name} ${renderer.vendor}`);
  const skipPixels = softwareRenderer || (engine === 'webkit' && !hardwareRenderer);
  const pixelSkipReason = softwareRenderer ? 'software renderer' : 'WebKit renderer does not report hardware GL';
  console.log(`Engine: ${engine}\nRenderer: ${renderer.name}`);
  if (softwareRenderer) console.log(`Software renderer: device pixel ratio ${SOFTWARE_DEVICE_SCALE_FACTOR} for all checks`);
  const modules = (await readdir(new URL('./checks/', import.meta.url))).filter(name => name.endsWith('.mjs')).sort();
  checkLoopStarted = performance.now();
  for (const name of modules) {
    const { checks } = await import(new URL(`./checks/${name}`, import.meta.url));
    for (const definition of checks) {
      const check = { gpu: gpuChecks.has(definition.name), ...definition };
      if (skipPixels && check.gpu) {
        skipped++;
        console.log(`skip ${check.name} (${pixelSkipReason})`);
        continue;
      }
      const checkStarted = performance.now();
      activeTiming = { name: check.name, status: 'fail', ...(profile ? { events: [] } : {}) };
      let current;
      const share = softwareRenderer && check.reuse === true;
      try {
        if (!share && reusable) {
          await timed('cleanup', 'close reusable context', () => reusable.context.close());
          reusable = undefined;
        }
        if (share && reusable) {
          current = reusable;
          await timed('setup', 'reuse and reset page', () => resetPage(current.page, check.viewport || { width: 1440, height: 900 }));
        } else {
          current = await timed('setup', 'context and page creation', async () => {
            const context = await browser.newContext({
              viewport: check.viewport || { width: 1440, height: 900 },
              ...check.contextOptions,
              ...(softwareRenderer ? { deviceScaleFactor: SOFTWARE_DEVICE_SCALE_FACTOR } : {}),
            });
            try { return { context, page: await context.newPage(), audit: { consoleErrors: [], foreignRequests: [] } }; }
            catch (error) { await context.close(); throw error; }
          });
          const { page, audit } = current;
          page.setDefaultTimeout(softwareRenderer ? 60000 : 15000);
          if (profile) instrumentPage(page);
          await page.route('**/*', route => new URL(route.request().url()).origin === url
            ? route.continue() : route.abort('blockedbyclient'));
          page.on('console', message => { if (message.type() === 'error') audit.consoleErrors.push(message.text()); });
          page.on('pageerror', error => audit.consoleErrors.push(error.stack || error.message));
          page.on('request', request => {
            const address = new URL(request.url());
            if (address.origin !== url) audit.foreignRequests.push(request.url());
          });
          const path = softwareRenderer && check.uiOnly ? '/?debug=1' : check.path || '';
          await timed('setup', 'page load', () => page.goto(url + path, { waitUntil: 'load' }));
          if (softwareRenderer && check.uiOnly) {
            await timed('setup', 'software UI render budget', () => page.waitForFunction(() => {
              if (!window.eventHorizon?.debug) return false;
              window.eventHorizon.debug.setRenderBudget(4096);
              return true;
            }));
          }
          await timed('setup', 'boot: observer clock advances', () => page.waitForFunction(() => window.eventHorizon?.getState().clock > 0));
          if (share) reusable = current;
        }
        const { page, audit } = current;
        await timed('check', 'assertions and actions', () => check.run({ page, url, outDir, audit, engine,
          measure: (name, operation) => timed('action', name, operation),
        }));
        assert.deepEqual(audit.consoleErrors, [], 'console or page errors');
        assert.deepEqual(audit.foreignRequests, [], 'foreign-origin requests');
        passed++;
        activeTiming.status = 'pass';
        console.log(`ok ${check.name} (${((performance.now() - checkStarted) / 1000).toFixed(1)} s)`);
      } catch (error) {
        failed++;
        const screenshot = join(outDir, `${check.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`);
        await current?.page.screenshot({ path: screenshot }).catch(() => {});
        console.error(`FAIL ${check.name} (${((performance.now() - checkStarted) / 1000).toFixed(1)} s): ${error.stack || error}\nScreenshot: ${screenshot}`);
      } finally {
        if (current && (!share || activeTiming.status !== 'pass')) {
          if (current === reusable) reusable = undefined;
          await timed('cleanup', 'close context', () => current.context.close());
        }
        activeTiming.ms = +(performance.now() - checkStarted).toFixed(2);
        timings.push(activeTiming);
        activeTiming = undefined;
        await saveTimings();
      }
    }
  }
} catch (error) {
  failed++;
  console.error(`FAIL browser setup: ${error.stack || error}`);
} finally {
  if (checkLoopStarted !== undefined) checkLoopElapsed = (performance.now() - checkLoopStarted) / 1000;
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
console.log(`Elapsed ${checkLoopElapsed.toFixed(1)} s`);
console.log(`TOTAL ${passed + failed + skipped} pass ${passed} fail ${failed} skip ${skipped}`);
process.exitCode = failed > 0 || passed === 0 ? 1 : 0;
