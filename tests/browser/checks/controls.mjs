import assert from 'node:assert/strict';
import { join } from 'node:path';
import { SHORTCUTS, shortcutNotice } from '../../../src/shortcuts.js';

const state = page => page.evaluate(() => window.eventHorizon.getState());
const renderedFrames = page => page.evaluate(() => new Promise(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
}));
const inputState = async page => {
  // Render diagnostics continue even while simulation and inputs are paused.
  const { fps, renderedFrames, exposure, ...current } = await state(page);
  return current;
};
const assertInputState = (actual, expected, message) => {
  const { camera, ...rest } = actual;
  const { camera: expectedCamera, ...expectedRest } = expected;
  assert.deepEqual(rest, expectedRest, message);
  assert.deepEqual(Object.keys(camera), Object.keys(expectedCamera), message);
  for (const [key, value] of Object.entries(expectedCamera)) {
    if (typeof value === 'number') assert.ok(Math.abs(camera[key] - value) <= 1e-6, `${message}: camera.${key}`);
    else assert.deepEqual(camera[key], value, message);
  }
};
const panelOpen = async page => {
  await page.waitForFunction(() => !document.querySelector('.control-panel').inert
    && getComputedStyle(document.querySelector('.control-panel')).opacity === '1');
};

export const checks = [
  {
    name: 'S0 narrow panels stay clear of HUD and keep pause reachable',
    viewport: { width: 375, height: 812 },
    async run({ page }) {
      await page.locator('.panel-toggle').click();
      await panelOpen(page);
      await page.locator('[data-preset="deep"]').click();
      for (const selector of ['.control-panel', '.mission-panel']) {
        if (selector === '.mission-panel') {
          await page.keyboard.press('KeyM');
          await page.keyboard.press('KeyE');
        }
        await page.waitForFunction(selector => {
          const panel = document.querySelector(selector);
          return !panel.inert && getComputedStyle(panel).opacity === '1'
            && document.querySelector('.notice').classList.contains('visible');
        }, selector);
        const result = await page.evaluate(selector => {
          const panel = document.querySelector(selector).getBoundingClientRect();
          return {
            noticeShowing: document.querySelector('.notice').classList.contains('visible'),
            clockVisible: document.querySelector('.simulation-time').checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
            overlaps: ['.telemetry', '.simulation-time', '.notice'].filter(selector => {
              const element = document.querySelector(selector);
              if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
              const box = element.getBoundingClientRect();
              return box.left < panel.right && box.right > panel.left && box.top < panel.bottom && box.bottom > panel.top;
            }),
          };
        }, selector);
        assert.equal(result.noticeShowing, true);
        assert.equal(result.clockVisible, true, `${selector}: observer clock remains visible`);
        assert.deepEqual(result.overlaps, [], selector);
        await page.locator('.pause-button').click({ trial: true });
      }
    },
  },
  {
    name: 'D1 panel follows viewport in both directions',
    viewport: { width: 375, height: 812 },
    async run({ page, outDir }) {
      const toggle = page.locator('.panel-toggle');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('.control-panel').evaluate(el => el.inert), true);
      await page.screenshot({ path: join(outDir, 'narrow-375.png') });
      await toggle.click();
      await panelOpen(page);
      await page.locator('[data-preset="quiet"]').click();
      assert.equal((await state(page)).settings.name, 'Quiet');
      await toggle.click();
      await page.setViewportSize({ width: 1440, height: 900 });
      await panelOpen(page);
      assert.equal(await toggle.isVisible(), false);
      await page.locator('[data-preset="gargantua"]').click();
      assert.equal((await state(page)).settings.name, 'Gargantua');
      await page.setViewportSize({ width: 760, height: 812 });
      await page.waitForFunction(() => document.querySelector('.control-panel').inert);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      await panelOpen(page);
      await page.setViewportSize({ width: 761, height: 812 });
      await panelOpen(page);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.waitForFunction(() => document.querySelector('.control-panel').inert);
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await toggle.click();
      await panelOpen(page);
      await page.screenshot({ path: join(outDir, 'narrow-quality-panel.png') });
    },
  },
  {
    name: 'D2 shortcuts and native keys on a focused slider',
    async run({ page }) {
      const slider = page.locator('#param-spinDelta');
      await slider.click();
      await page.keyboard.press('KeyP');
      assert.ok((await state(page)).probe);
      await page.keyboard.press('KeyF');
      assert.equal((await state(page)).camera.mode, 'fly');
      await page.keyboard.press('Escape');
      assert.equal((await state(page)).camera.mode, 'orbit');
      await page.keyboard.press('KeyR');
      await page.keyboard.press('Space');
      const before = await state(page);
      const value = Number(await slider.inputValue());
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(previous => Number(document.querySelector('#param-spinDelta').value) > previous, value);
      const after = await state(page);
      assert.ok(Number(await slider.inputValue()) > value);
      assert.equal(after.paused, before.paused);
      assert.equal(after.clock, before.clock);
      assert.deepEqual(after.probe, before.probe);
      assert.equal(after.camera.mode, before.camera.mode);
      for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
        await page.keyboard.press(key);
        const current = await state(page);
        assert.equal(current.paused, true, key);
        assert.equal(current.clock, before.clock, key);
        assert.equal(current.probe, null, key);
        assert.equal(current.camera.mode, 'orbit', key);
      }
      await page.keyboard.down('KeyW');
      try { await page.waitForFunction(radius => window.eventHorizon.getState().camera.radius < radius - 0.2, before.camera.radius); }
      finally { await page.keyboard.up('KeyW'); }
      const inward = (await state(page)).camera.radius;
      await page.keyboard.down('KeyS');
      try { await page.waitForFunction(radius => window.eventHorizon.getState().camera.radius > radius + 0.2, inward); }
      finally { await page.keyboard.up('KeyS'); }
      await page.keyboard.press('Slash');
      assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog').open);
      assert.equal(await page.locator('dialog').evaluate(el => el.open), false);
      await page.locator('[data-preset="quiet"]').focus();
      const paused = (await state(page)).paused;
      await page.keyboard.press('Space');
      assert.equal((await state(page)).settings.name, 'Quiet');
      assert.equal((await state(page)).paused, paused, 'Space must only activate the preset button');
    },
  },
  {
    name: 'D2 text-like editing retains keys',
    async run({ page }) {
      // Exercise text focus even though the shipped panel contains only ranges.
      await page.evaluate(() => {
        const field = document.createElement('input');
        field.id = 'keyboard-test-text';
        field.type = 'text';
        document.body.append(field);
      });
      const field = page.locator('#keyboard-test-text');
      await field.focus();
      const before = await state(page);
      await page.keyboard.type('pfwasd');
      await page.keyboard.press('Space');
      assert.equal(await field.inputValue(), 'pfwasd ');
      const after = await state(page);
      assert.equal(after.probe, null);
      assert.equal(after.camera.mode, before.camera.mode);
      assert.equal(after.paused, before.paused);
      assert.equal(after.camera.radius, before.camera.radius);
      await field.evaluate(el => el.remove());
    },
  },
  {
    name: 'D3 custom parameters and preset restoration',
    async run({ page }) {
      const slider = page.locator('#param-spinDelta');
      await slider.click();
      await page.keyboard.press('Home');
      await page.waitForFunction(() => window.eventHorizon.getState().settings.spinDelta === 1
        && document.querySelector('[data-readout="object-description"]').textContent === 'Custom parameters');
      assert.equal(await page.locator('[data-control-output="spinDelta"]').textContent(), '0.000');
      assert.equal(await page.locator('[data-readout="object-name"]').textContent(), 'Gargantua');
      assert.equal(await page.locator('[data-readout="object-description"]').textContent(), 'Custom parameters');
      assert.equal(await page.locator('[data-preset][aria-pressed="true"]').count(), 0);
      await page.locator('[data-preset="sagittarius"]').click();
      await page.waitForFunction(() => window.eventHorizon.getState().settings.spinDelta === 0.45
        && document.querySelector('[data-preset="sagittarius"]').getAttribute('aria-pressed') === 'true');
      assert.equal(await page.locator('[data-readout="object-name"]').textContent(), 'Sagittarius A*');
      assert.equal(await page.locator('[data-readout="object-description"]').textContent(), 'At the heart of the Milky Way');
      assert.equal(await page.locator('[data-preset="sagittarius"]').getAttribute('aria-pressed'), 'true');
    },
  },
  {
    name: 'D3 Deep orbit spin restores the exact off-grid preset and wraps four buttons',
    async run({ page, outDir }) {
      await page.locator('[data-preset="deep"]').click();
      await page.waitForFunction(() => window.eventHorizon.getState().settings.spinDelta === 1.3e-14
        && document.querySelector('[data-readout="object-description"]').textContent === 'Near-extremal spin'
        && document.querySelector('[data-preset="deep"]').getAttribute('aria-pressed') === 'true');
      const slider = page.locator('#param-spinDelta');
      assert.equal(await slider.getAttribute('min'), '0');
      assert.equal(await slider.getAttribute('max'), '14');
      assert.equal(await slider.getAttribute('step'), '0.01');
      assert.equal(Number(await slider.inputValue()), 13.89);
      assert.equal((await state(page)).settings.spin, 0.99);
      assert.equal(await page.locator('[data-control-output="spinDelta"]').textContent(), '1 − 1.3×10⁻¹⁴');
      await slider.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => window.eventHorizon.getState().settings.spinDelta !== 1.3e-14
        && document.querySelector('[data-readout="object-description"]').textContent === 'Custom parameters'
        && document.querySelectorAll('[data-preset][aria-pressed="true"]').length === 0);
      assert.ok(Math.abs((await state(page)).settings.spinDelta - 1.3e-14) > 1e-9 * 1.3e-14);
      assert.equal(await page.locator('[data-readout="object-description"]').textContent(), 'Custom parameters');
      assert.equal(await page.locator('[data-preset][aria-pressed="true"]').count(), 0);
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(() => window.eventHorizon.getState().settings.spinDelta === 1.3e-14
        && document.querySelector('[data-preset="deep"]').getAttribute('aria-pressed') === 'true'
        && document.querySelector('[data-control-output="spinDelta"]').textContent === '1 − 1.3×10⁻¹⁴');
      assert.equal((await state(page)).settings.spinDelta, 1.3e-14);
      assert.equal(await page.locator('[data-preset="deep"]').getAttribute('aria-pressed'), 'true');
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: width === 1440 ? 900 : 812 });
        if (width === 375) {
          await page.waitForFunction(() => document.querySelector('.control-panel').inert);
          await page.locator('.panel-toggle').click();
        }
        await panelOpen(page);
        const buttons = await page.locator('[data-preset]').evaluateAll(elements => elements.map(element => {
          const { top, left, right, bottom } = element.getBoundingClientRect();
          return { top, left, right, bottom };
        }));
        assert.equal(buttons.length, 4);
        assert.equal(buttons[0].top, buttons[1].top);
        assert.equal(buttons[2].top, buttons[3].top);
        assert.ok(buttons[2].top >= buttons[0].bottom, 'presets wrap into two rows');
        assert.ok(await page.locator('.control-panel').evaluate(element => element.scrollWidth <= element.clientWidth), 'panel fits horizontally');
        assert.equal(await page.locator('[data-control-output="spinDelta"]').textContent(), '1 − 1.3×10⁻¹⁴');
        await page.locator('.control-panel').screenshot({ path: join(outDir, `controls-${width}-deep.png`) });
      }
    },
  },
  {
    name: 'D3 Sagittarius mass restores the exact off-grid preset',
    async run({ page }) {
      await page.locator('[data-preset="sagittarius"]').click();
      await page.waitForFunction(() => window.eventHorizon.getState().settings.mass === 4.3e6
        && document.querySelector('[data-preset="sagittarius"]').getAttribute('aria-pressed') === 'true');
      const slider = page.locator('#param-mass');
      const originalPosition = Number(await slider.inputValue());
      await slider.focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => window.eventHorizon.getState().settings.mass !== 4.3e6
        && document.querySelector('[data-readout="object-description"]').textContent === 'Custom parameters'
        && document.querySelectorAll('[data-preset][aria-pressed="true"]').length === 0);
      assert.ok(Number(await slider.inputValue()) > originalPosition);
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(() => window.eventHorizon.getState().settings.mass === 4.3e6
        && document.querySelector('[data-preset="sagittarius"]').getAttribute('aria-pressed') === 'true'
        && document.querySelector('[data-readout="object-description"]').textContent === 'At the heart of the Milky Way');
      assert.equal((await state(page)).settings.mass, 4.3e6);
      assert.equal(Number(await slider.inputValue()), originalPosition);
      assert.equal(await page.locator('[data-preset="sagittarius"]').getAttribute('aria-pressed'), 'true');
    },
  },
  {
    name: 'D4 complete help, compact reminder and modal shortcut isolation',
    async run({ page }) {
      await page.keyboard.press('Space');
      await page.locator('[data-quality="high"]').click();
      await page.waitForFunction(() => document.querySelector('[data-readout="quality"]').textContent === 'FIXED · HIGH · 100%');
      const before = await inputState(page);
      assert.equal(before.paused, true);
      await page.keyboard.press('Slash');
      assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
      for (const shortcut of SHORTCUTS) {
        const row = page.locator(`[data-shortcut="${shortcut.code}"]`);
        assert.equal(await row.locator('dt').textContent(), shortcut.description);
        assert.equal(await row.locator('kbd').textContent(), shortcut.label);
      }
      assert.equal(await page.locator('.notice').textContent(), shortcutNotice());
      for (const key of ['KeyP', 'KeyF', 'Space']) {
        await page.keyboard.press(key);
        await renderedFrames(page);
        assert.equal(await page.locator('dialog').evaluate(el => el.open), true, key);
        assertInputState(await inputState(page), before, key);
      }
      await page.keyboard.down('KeyW');
      try {
        await renderedFrames(page);
        assertInputState(await inputState(page), before, 'W must not register a camera key while help is open');
        await page.keyboard.press('Slash');
        await page.waitForFunction(() => !document.querySelector('dialog').open);
        await renderedFrames(page);
        assertInputState(await inputState(page), before, 'W must not remain registered after help closes');
      } finally { await page.keyboard.up('KeyW'); }
      await page.keyboard.press('Slash');
      assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog').open);
      assertInputState(await inputState(page), before, 'Escape only closes help');
      await page.keyboard.press('KeyF');
      assert.equal((await state(page)).camera.mode, 'fly');
      await page.locator('.help-button').click();
      assert.equal(await page.locator('dialog').evaluate(el => el.open), true);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog').open);
      assert.equal((await state(page)).camera.mode, 'fly', 'Native Escape must preserve camera mode');
    },
  },
  {
    name: 'D5 fixed quality modes and Auto restoration',
    async run({ page, outDir }) {
      assert.equal((await state(page)).qualityMode, 'auto');
      for (const [mode, scale, label] of [['performance', 0.52, 'PERFORMANCE'], ['balanced', 0.76, 'BALANCED'], ['high', 1, 'HIGH'], ['auto', 1, 'HIGH']]) {
        await page.locator(`[data-quality="${mode}"]`).click();
        await page.waitForFunction(expected => {
          const current = window.eventHorizon.getState();
          return current.qualityMode === expected.mode && Math.abs(current.renderScale - expected.scale) < 1e-9
            && document.querySelector('[data-readout="quality"]').textContent === expected.text;
        }, { mode, scale, text: `${mode === 'auto' ? 'AUTO' : 'FIXED'} · ${label} · ${Math.round(scale * 100)}%` });
        const current = await state(page);
        assert.ok(Math.abs(current.renderScale - scale) < 1e-9);
        assert.equal(current.frameCap, null);
        assert.equal(await page.locator(`[data-quality="${mode}"]`).getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('[data-readout="quality"]').textContent(), `${mode === 'auto' ? 'AUTO' : 'FIXED'} · ${label} · ${Math.round(scale * 100)}%`);
        if (mode === 'balanced') await page.screenshot({ path: join(outDir, 'quality-panel.png') });
      }
    },
  },
  {
    name: 'no console errors or foreign-origin requests',
    async run({ page, audit }) {
      await page.locator('[data-preset="quiet"]').click();
      await page.keyboard.press('KeyP');
      await page.waitForFunction(() => window.eventHorizon.getState().probe?.elapsed > 0);
      assert.deepEqual(audit.consoleErrors, []);
      assert.deepEqual(audit.foreignRequests, []);
    },
  },
];
