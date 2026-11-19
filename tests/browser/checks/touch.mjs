import assert from 'node:assert/strict';
import { afterRender } from '../pixels.mjs';

const point = (id, x, y = 400) => ({ id, x, y, radiusX: 5, radiusY: 5, force: 1 });

async function touchInput(page, engine) {
  if (engine === 'webkit') {
    // Playwright 1.63 exposes only taps publicly; its bundled WebKit protocol supports native multi-touch.
    const session = page._connection?.toImpl?.(page)?._delegate?._pageProxySession;
    assert.ok(session?.send, 'Playwright WebKit native touch session is unavailable');
    return {
      dispatch: (type, points) => session.send('Input.dispatchTouchEvent', {
        type, modifiers: 0, touchPoints: points.map(({ id, x, y }) => ({ id, x, y })),
      }),
      close: async () => {},
    };
  }
  const session = await page.context().newCDPSession(page);
  return {
    dispatch: (type, touchPoints) => session.send('Input.dispatchTouchEvent', { type, touchPoints }),
    close: () => session.detach(),
  };
}

export const checks = [{
  name: 'real two-finger pinch zoom and fly free look',
  path: '/?debug=1',
  viewport: { width: 500, height: 800 },
  contextOptions: { hasTouch: true, deviceScaleFactor: 1 },
  uiOnly: true,
  async run({ page, engine = 'chromium', measure = (_name, operation) => operation() }) {
    await page.keyboard.press('KeyH');
    await page.waitForFunction(() => document.body.classList.contains('hud-hidden'));
    const input = await touchInput(page, engine);
    const dispatch = (type, points) => measure(`native touch ${type}: ${JSON.stringify(points)}`, () => input.dispatch(type, points));
    try {
      const before = await page.evaluate(() => window.eventHorizon.getState().camera);
      assert.ok(Math.abs(before.radius - 23) <= 1e-6);
      await dispatch('touchStart', [point(1, 210), point(2, 290)]);
      await dispatch('touchMove', [point(1, 100), point(2, 400)]);
      await dispatch('touchEnd', []);
      const expected = 23 * 80 / 300;
      await page.waitForFunction(expected => Math.abs(window.eventHorizon.getState().camera.radius - expected) < 0.02, expected, { timeout: 45000 });
      const pinched = await page.evaluate(() => window.eventHorizon.getState().camera);
      assert.ok(Math.abs(pinched.radius - expected) < 0.02);
      assert.ok(Math.abs(pinched.theta - before.theta) <= 1e-6, 'pinch does not orbit');
      assert.ok(Math.abs(pinched.elevation - before.elevation) <= 1e-6, 'pinch does not tilt');

      await dispatch('touchStart', [point(3, 250)]);
      await dispatch('touchMove', [point(3, 290, 420)]);
      await dispatch('touchEnd', []);
      await page.waitForFunction(theta => Math.abs(window.eventHorizon.getState().camera.theta - theta) > 0.03, pinched.theta);
      await page.keyboard.press('KeyF');
      await page.waitForFunction(() => window.eventHorizon.getState().camera.mode === 'fly');
      const fly = await page.evaluate(() => window.eventHorizon.getState().camera);
      await dispatch('touchStart', [point(4, 250)]);
      await dispatch('touchMove', [point(4, 310, 430)]);
      await dispatch('touchEnd', []);
      await page.waitForFunction(yaw => Math.abs(window.eventHorizon.getState().camera.gazeYaw - yaw) > 0.1, fly.gazeYaw);
      const looked = await page.evaluate(() => window.eventHorizon.getState().camera);
      assert.equal(looked.mode, 'fly', 'one finger keeps descent active');
      await afterRender(page, {});
      assert.ok(Math.abs((await page.evaluate(() => window.eventHorizon.getState().camera)).gazeYaw - looked.gazeYaw) <= 1e-6, 'free look persists');
      await page.keyboard.press('KeyF');
      await page.waitForFunction(() => window.eventHorizon.getState().camera.mode === 'orbit');
      const stopped = await page.evaluate(() => window.eventHorizon.getState().camera);
      await afterRender(page, {});
      assert.ok(Math.abs((await page.evaluate(() => window.eventHorizon.getState().camera)).radius - stopped.radius) <= 1e-6);
      await page.keyboard.press('KeyR');
      await page.waitForFunction(() => {
        const c = window.eventHorizon.getState().camera;
        return Math.abs(c.radius - 23) <= 1e-6 && Math.abs(c.gazeYaw) <= 1e-6 && Math.abs(c.gazePitch) <= 1e-6;
      });
    } finally {
      await dispatch('touchCancel', []).catch(() => {});
      await input.close();
    }
  },
}];
