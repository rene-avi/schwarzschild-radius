import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { circularOrbit, iscoOffset } from '../../../src/kerr.js';
import { formatDuration, formatFactor } from '../../../src/ledger.js';

const DELTA = 1.3e-14;
const brinkFactor = circularOrbit({ offset: iscoOffset(DELTA) }, DELTA).dtdtau;
const shipFactor = circularOrbit(400, DELTA).dtdtau;
const state = page => page.evaluate(() => window.eventHorizon.getState());
const twoFrames = async page => {
  const start = (await state(page)).renderedFrames;
  await page.waitForFunction(start => window.eventHorizon.getState().renderedFrames >= start + 2, start);
};
const panelState = (page, open) => page.waitForFunction(open => {
  const panel = document.querySelector('.mission-panel');
  return window.eventHorizon.getState().mission.open === open && panel.inert === !open
    && getComputedStyle(panel).opacity === (open ? '1' : '0')
    && document.querySelector('[data-action="mission"]').getAttribute('aria-expanded') === String(open);
}, open);

async function oneHourAtBrink(page) {
  assert.deepEqual((await state(page)).mission, { open: false, running: false });
  assert.equal(await page.locator('.mission-panel').evaluate(element => element.inert), true);
  if (await page.locator('.control-panel').evaluate(element => element.inert)) {
    await page.locator('.panel-toggle').click();
    await page.waitForFunction(() => !document.querySelector('.control-panel').inert
      && getComputedStyle(document.querySelector('.control-panel')).opacity === '1');
  }
  await page.locator('[data-preset="deep"]').click();
  await page.waitForFunction(() => window.eventHorizon.getState().settings.spinDelta === 1.3e-14);
  await page.keyboard.press('KeyM');
  await panelState(page, true);
  await page.locator('[data-action="mission-reset"]').click();
  await page.waitForFunction(() => {
    const current = window.eventHorizon.getState();
    return current.ledger.location === 'ship' && current.ledger.crewSeconds === 0 && !current.mission.running
      && document.querySelector('[data-location="ship"]').getAttribute('aria-pressed') === 'true'
      && document.querySelector('[data-ledger="crew"]').textContent === '0 s';
  });
  await page.locator('[data-location="brink"]').click();
  await page.waitForFunction(() => window.eventHorizon.getState().ledger.location === 'brink'
    && document.querySelector('[data-location="brink"]').getAttribute('aria-pressed') === 'true');
  await page.evaluate(() => window.eventHorizon.debug.advanceCrew(3600));
  const homeSeconds = 3600 * brinkFactor;
  const expected = {
    crew: formatDuration(3600), home: formatDuration(homeSeconds), brink: formatDuration(3600),
    lantern: formatDuration(homeSeconds / circularOrbit(12, DELTA).dtdtau),
    farShore: formatDuration(homeSeconds / circularOrbit(120, DELTA).dtdtau),
    ship: formatDuration(homeSeconds / shipFactor),
  };
  await page.waitForFunction(({ expected, factor, cost, ship }) => Object.entries(expected).every(([id, text]) =>
    document.querySelector(`[data-ledger="${id}"]`).textContent === text)
    && document.querySelector('[data-location="brink"] [data-factor]').textContent === factor
    && document.querySelector('[data-location="brink"] [data-hour-cost]').textContent === cost
    && document.querySelector('[data-location="ship"] [data-factor]').textContent === ship, {
    expected, factor: formatFactor(brinkFactor), cost: `1 h here = ${formatDuration(homeSeconds)}`, ship: formatFactor(shipFactor),
  });
  return expected;
}

async function assertPlacement(page) {
  const layout = await page.evaluate(() => {
    const panel = document.querySelector('.mission-panel');
    const box = panel.getBoundingClientRect();
    const controls = document.querySelector('.control-panel').getBoundingClientRect();
    return {
      gap: controls.left - box.right, topDifference: box.top - controls.top, width: box.width,
      inside: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
      overlaps: ['.control-panel', '.telemetry', '.object-label', '.simulation-time', '.camera-dock', '.notice'].filter(selector => {
        const element = document.querySelector(selector);
        if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        const other = element.getBoundingClientRect();
        return box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
      }),
    };
  });
  assert.equal(layout.gap, 16);
  assert.equal(layout.topDifference, 0);
  assert.equal(layout.width, 250);
  assert.equal(layout.inside, true);
  assert.deepEqual(layout.overlaps, []);
}

async function assertDesktopPanelsFit(page) {
  const panels = await page.evaluate(() => ['.control-panel', '.mission-panel'].map(selector => {
    const panel = document.querySelector(selector);
    const box = panel.getBoundingClientRect();
    const heading = panel.querySelector('.panel-heading').getBoundingClientRect();
    return {
      selector, visible: panel.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight, height: box.height,
      scrollWidth: panel.scrollWidth, clientWidth: panel.clientWidth, scrollTop: panel.scrollTop,
      headingInside: heading.top >= box.top + panel.clientTop && heading.bottom <= box.top + panel.clientTop + panel.clientHeight,
    };
  }));
  for (const panel of panels) {
    const context = JSON.stringify(panel);
    assert.equal(panel.visible, true, context);
    assert.ok(panel.scrollHeight <= panel.clientHeight, context);
    assert.ok(panel.scrollWidth <= panel.clientWidth, context);
    assert.equal(panel.scrollTop, 0, context);
    assert.equal(panel.headingInside, true, context);
  }
  const cards = await page.locator('[data-location]').evaluateAll(buttons => buttons.map(button => {
    const name = button.querySelector('.location-name').getBoundingClientRect();
    const radius = button.querySelector('[data-radius]').getBoundingClientRect();
    const factor = button.querySelector('[data-factor]').getBoundingClientRect();
    const cost = button.querySelector('[data-hour-cost]').getBoundingClientRect();
    return {
      location: button.dataset.location, headingAligned: name.top === radius.top,
      readoutsAligned: factor.top === cost.top, separateRows: factor.top >= name.bottom,
      fits: button.scrollWidth <= button.clientWidth,
    };
  }));
  assert.ok(cards.every(card => card.headingAligned && card.readoutsAligned && card.separateRows && card.fits), JSON.stringify(cards));
  return panels;
}

async function scrollMissionToEnd(page) {
  await page.locator('.mission-panel').evaluate(panel => { panel.scrollTop = panel.scrollHeight; });
  await page.waitForFunction(() => {
    const panel = document.querySelector('.mission-panel');
    return Math.abs(panel.scrollTop - (panel.scrollHeight - panel.clientHeight)) <= 1;
  });
  await twoFrames(page);
}

async function assertNarrowHeadingVisible(page) {
  const heading = await page.locator('.mission-panel').evaluate(panel => {
    const box = panel.getBoundingClientRect();
    const element = panel.querySelector('.panel-heading');
    const visibleTop = box.top + panel.clientTop;
    const visibleBottom = visibleTop + panel.clientHeight;
    const bounds = element.getBoundingClientRect();
    return {
      scrollTop: panel.scrollTop, end: panel.scrollHeight - panel.clientHeight,
      sticky: getComputedStyle(element).position === 'sticky',
      inside: bounds.top >= visibleTop && bounds.bottom <= visibleBottom,
      labelsInside: [...element.children].every(label => {
        const bounds = label.getBoundingClientRect();
        return bounds.top >= visibleTop && bounds.bottom <= visibleBottom && bounds.left >= box.left && bounds.right <= box.right;
      }),
    };
  });
  assert.ok(heading.scrollTop > 0, JSON.stringify(heading));
  assert.ok(Math.abs(heading.scrollTop - heading.end) <= 1, JSON.stringify(heading));
  assert.equal(heading.sticky, true, JSON.stringify(heading));
  assert.equal(heading.inside, true, JSON.stringify(heading));
  assert.equal(heading.labelsInside, true, JSON.stringify(heading));
}

async function assertNoticeClear(page, text, lines, missionOpen) {
  await page.waitForFunction(text => {
    const notice = document.querySelector('.notice');
    return notice.textContent === text && notice.classList.contains('visible')
      && notice.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      && getComputedStyle(notice).opacity === '1' && getComputedStyle(notice).transform === 'none';
  }, text);
  const layout = await page.evaluate(() => {
    const notice = document.querySelector('.notice');
    const box = notice.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(notice);
    return {
      showing: notice.classList.contains('visible'), lines: range.getClientRects().length,
      inside: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
      overlaps: ['.telemetry', '.simulation-time', '.object-label', '.control-panel', '.mission-panel', '.camera-dock'].filter(selector => {
        const element = document.querySelector(selector);
        if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        const other = element.getBoundingClientRect();
        return box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
      }),
    };
  });
  const context = `Mission ${missionOpen ? 'open' : 'closed'}, ${lines}-line notice: ${text}`;
  assert.equal(layout.showing, true, context);
  assert.equal(layout.lines, lines, context);
  assert.equal(layout.inside, true, context);
  assert.deepEqual(layout.overlaps, [], context);
}

async function assertDesktopNotices(page, viewport) {
  for (const open of [true, false]) {
    if ((await state(page)).mission.open !== open) await page.keyboard.press('KeyM');
    await panelState(page, open);
    if (!open && viewport.width === 1000) {
      const controls = await page.locator('.control-panel').evaluate(panel => ({
        visible: panel.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        scrollHeight: panel.scrollHeight, clientHeight: panel.clientHeight,
      }));
      assert.equal(controls.visible, true);
      assert.ok(controls.scrollHeight <= controls.clientHeight, JSON.stringify(controls));
    }
    await page.keyboard.press('KeyR');
    await assertNoticeClear(page, 'OBSERVATION POINT RESTORED', 1, open);
    if (open && viewport.width === 1000) {
      await page.locator('[data-preset="deep"]').click();
      await assertNoticeClear(page, 'DEEP ORBIT · Observation parameters loaded', 2, open);
    } else {
      await page.keyboard.press('KeyE');
      await assertNoticeClear(page, 'STELLAR ALIGNMENT · A background star forms an Einstein ring', 2, open);
    }
  }
  await page.keyboard.press('KeyM');
  await panelState(page, true);
}

export const checks = [
  {
    name: 'Mission Kerr clocks locations and formatted ledger',
    path: '/?debug=1',
    async run({ page }) {
      await oneHourAtBrink(page);
      const current = await state(page);
      assert.equal(current.ledger.location, 'brink');
      assert.equal(current.ledger.crewSeconds, 3600);
      assert.ok(Math.abs(current.ledger.homeSeconds / current.ledger.crewSeconds - brinkFactor) <= 1e-9);
      assert.ok(3600 * brinkFactor >= 7 * 365.25 * 86400);
      assert.equal(await page.locator('[data-location="brink"] [data-factor]').textContent(), formatFactor(brinkFactor));
      assert.equal(formatFactor(brinkFactor), '61,900');
      assert.equal(await page.locator('[data-location="brink"] [data-hour-cost]').textContent(), `1 h here = ${formatDuration(3600 * brinkFactor)}`);
      assert.equal(await page.locator('[data-location="brink"] [data-radius]').textContent(), '1.0000373 M');
      assert.equal(await page.locator('[data-location="ship"] [data-factor]').textContent(), formatFactor(shipFactor));
      assert.equal(formatFactor(shipFactor), '1.0038');
      assert.deepEqual(await page.locator('[data-location]').evaluateAll(buttons => buttons.map(button => button.dataset.location)), ['ship', 'farShore', 'lantern', 'brink']);
      assert.deepEqual(await page.locator('[data-ledger]').evaluateAll(rows => rows.map(row => row.dataset.ledger)), ['crew', 'home', 'brink', 'lantern', 'farShore', 'ship']);
      await page.locator('[data-location="ship"]').click();
      await page.waitForFunction(() => window.eventHorizon.getState().ledger.location === 'ship'
        && document.querySelector('[data-location="ship"]').getAttribute('aria-pressed') === 'true'
        && document.querySelector('[data-location="brink"]').getAttribute('aria-pressed') === 'false');
      assert.deepEqual((await state(page)).ledger, { ...current.ledger, location: 'ship' });
      assert.equal(await page.locator('[data-action="mission"]').getAttribute('data-mode'), null);
    },
  },
  {
    name: 'Mission clock start pause closed-panel run stop and reset',
    path: '/?debug=1',
    async run({ page }) {
      await oneHourAtBrink(page);
      const start = page.locator('[data-action="mission-start"]');
      assert.equal(await start.textContent(), 'Start');
      await start.click();
      await page.waitForFunction(() => window.eventHorizon.getState().ledger.crewSeconds > 3600
        && window.eventHorizon.getState().mission.running
        && document.querySelector('[data-action="mission-start"]').textContent === 'Stop'
        && document.querySelector('[data-action="mission-start"]').getAttribute('aria-pressed') === 'true');
      await page.locator('#universe').focus();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.eventHorizon.getState().paused);
      const paused = (await state(page)).ledger;
      await twoFrames(page);
      assert.deepEqual((await state(page)).ledger, paused);
      assert.equal((await state(page)).mission.running, true);
      await page.keyboard.press('Space');
      await page.waitForFunction(seconds => !window.eventHorizon.getState().paused
        && window.eventHorizon.getState().ledger.crewSeconds > seconds, paused.crewSeconds);
      await page.keyboard.press('KeyM');
      await panelState(page, false);
      const closed = (await state(page)).ledger.crewSeconds;
      await page.waitForFunction(seconds => window.eventHorizon.getState().ledger.crewSeconds > seconds, closed);
      await page.keyboard.press('KeyM');
      await panelState(page, true);
      await start.click();
      await page.waitForFunction(() => !window.eventHorizon.getState().mission.running
        && document.querySelector('[data-action="mission-start"]').textContent === 'Start'
        && document.querySelector('[data-action="mission-start"]').getAttribute('aria-pressed') === 'false');
      const stopped = (await state(page)).ledger;
      await twoFrames(page);
      assert.deepEqual((await state(page)).ledger, stopped);
      await start.click();
      await page.waitForFunction(seconds => window.eventHorizon.getState().ledger.crewSeconds > seconds, stopped.crewSeconds);
      await page.locator('[data-action="mission-reset"]').click();
      await page.waitForFunction(() => {
        const current = window.eventHorizon.getState();
        return !current.mission.running && current.ledger.location === 'ship' && current.ledger.crewSeconds === 0
          && document.querySelector('[data-action="mission-start"]').textContent === 'Start'
          && [...document.querySelectorAll('[data-ledger]')].every(element => element.textContent === '0 s');
      });
      await twoFrames(page);
      assert.equal((await state(page)).ledger.homeSeconds, 0);
      assert.equal((await state(page)).ledger.crewSeconds, 0);
    },
  },
  {
    name: 'Mission preserves history on reset preset and spin changes',
    path: '/?debug=1',
    async run({ page }) {
      await oneHourAtBrink(page);
      const before = (await state(page)).ledger;
      await page.keyboard.press('KeyR');
      await twoFrames(page);
      assert.deepEqual((await state(page)).ledger, before);
      await page.locator('[data-preset="quiet"]').click();
      const delta = (await state(page)).settings.spinDelta;
      const quietFactor = circularOrbit({ offset: iscoOffset(delta) }, delta).dtdtau;
      await page.waitForFunction(({ factor, cost }) =>
        document.querySelector('[data-location="brink"] [data-factor]').textContent === factor
        && document.querySelector('[data-location="brink"] [data-hour-cost]').textContent === cost,
      { factor: formatFactor(quietFactor), cost: `1 h here = ${formatDuration(3600 * quietFactor)}` });
      assert.deepEqual((await state(page)).ledger, before);
      const spin = page.locator('#param-spinDelta');
      await spin.focus();
      await page.keyboard.press('Home');
      const zeroSpinFactor = circularOrbit({ offset: iscoOffset(1) }, 1).dtdtau;
      await page.waitForFunction(({ factor, cost }) => window.eventHorizon.getState().settings.spinDelta === 1
        && document.querySelector('[data-location="brink"] [data-factor]').textContent === factor
        && document.querySelector('[data-location="brink"] [data-hour-cost]').textContent === cost,
      { factor: formatFactor(zeroSpinFactor), cost: `1 h here = ${formatDuration(3600 * zeroSpinFactor)}` });
      assert.deepEqual((await state(page)).ledger, before);
      await page.evaluate(() => window.eventHorizon.debug.advanceCrew(60));
      await page.waitForFunction(() => window.eventHorizon.getState().ledger.crewSeconds === 3660
        && document.querySelector('[data-ledger="crew"]').textContent === '1 h 1 min 0 s');
      assert.ok(Math.abs((await state(page)).ledger.homeSeconds - before.homeSeconds - 60 * zeroSpinFactor) < 1e-7);
      const scale = page.locator('#param-timeScale');
      await scale.focus();
      await page.keyboard.press('Home');
      await page.waitForFunction(() => window.eventHorizon.getState().settings.timeScale === 0);
      await page.locator('[data-action="mission-start"]').click();
      await page.waitForFunction(() => window.eventHorizon.getState().mission.running);
      const frozen = (await state(page)).ledger;
      await twoFrames(page);
      assert.deepEqual((await state(page)).ledger, frozen);
      await page.locator('#universe').focus();
      await page.keyboard.press('Space');
      await page.waitForFunction(() => window.eventHorizon.getState().paused);
      await page.keyboard.press('KeyR');
      await page.locator('[data-preset="deep"]').click();
      await page.waitForFunction(() => document.querySelector('[data-location="brink"] [data-factor]').textContent === '61,900');
      assert.equal((await state(page)).mission.running, true);
      assert.deepEqual((await state(page)).ledger, frozen);
    },
  },
  ...[{ width: 1440, height: 900 }, { width: 1000, height: 800 }, { width: 375, height: 812 }].map(viewport => ({
    name: `Mission layout and one-hour Brink reference at ${viewport.width}px`,
    path: '/?debug=1', viewport,
    async run({ page, outDir }) {
      await oneHourAtBrink(page);
      assert.equal(await page.locator('.mission-panel > .panel-heading:first-child > .eyebrow').textContent(), 'MISSION');
      assert.equal(await page.locator('.mission-panel > .panel-heading:first-child > .panel-number').textContent(), '02 / CLOCKS');
      for (const selector of ['.eyebrow', '.panel-number']) {
        const styles = await page.evaluate(selector => ['.control-panel', '.mission-panel'].map(panel => {
          const style = getComputedStyle(document.querySelector(`${panel} > .panel-heading > ${selector}`));
          return [style.fontFamily, style.fontSize, style.letterSpacing, style.color];
        }), selector);
        assert.deepEqual(styles[0], styles[1], selector);
      }
      await page.keyboard.press('KeyE');
      await page.waitForFunction(() => document.querySelector('.notice').classList.contains('visible'));
      if (viewport.width > 760) {
        const panels = await assertDesktopPanelsFit(page);
        await writeFile(join(outDir, `mission-layout-${viewport.width}.json`), `${JSON.stringify({ viewport, panels }, null, 2)}\n`);
        await assertDesktopNotices(page, viewport);
        await assertPlacement(page);
        await assertDesktopPanelsFit(page);
        const sizes = await page.locator('.mission-panel').evaluate(panel => [...panel.querySelectorAll('*')]
          .filter(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
          .map(element => Number.parseFloat(getComputedStyle(element).fontSize)));
        assert.ok(sizes.every(size => size >= 9), JSON.stringify(sizes));
      } else {
        const layout = await page.evaluate(() => {
          const dock = document.querySelector('.camera-dock').getBoundingClientRect();
          const panel = document.querySelector('.mission-panel').getBoundingClientRect();
          const controls = document.querySelector('.control-panel').getBoundingClientRect();
          const textSizes = [...document.querySelectorAll('.mission-panel *')]
            .filter(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
            .map(element => Number.parseFloat(getComputedStyle(element).fontSize));
          return {
            left: dock.left, right: dock.right, width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
            panelFitsHorizontally: document.querySelector('.mission-panel').scrollWidth <= document.querySelector('.mission-panel').clientWidth,
            sameSlot: getComputedStyle(document.querySelector('.mission-panel')).top === getComputedStyle(document.querySelector('.control-panel')).top
              && getComputedStyle(document.querySelector('.mission-panel')).right === getComputedStyle(document.querySelector('.control-panel')).right
              && panel.width === controls.width,
            controlsInert: document.querySelector('.control-panel').inert, textSizes,
          };
        });
        assert.ok(layout.left >= 12 && layout.right <= layout.width - 12, JSON.stringify(layout));
        assert.ok(layout.scrollWidth <= layout.width, JSON.stringify(layout));
        assert.equal(layout.panelFitsHorizontally, true, JSON.stringify(layout));
        assert.equal(layout.sameSlot, true);
        assert.equal(layout.controlsInert, true);
        assert.ok(layout.textSizes.every(size => size >= 8.5), JSON.stringify(layout.textSizes));
        assert.equal(await page.locator('[data-action="mission"]').getAttribute('aria-label'), 'Mission');
      }
      await page.locator('.mission-panel').evaluate(panel => { panel.scrollTop = 0; });
      await twoFrames(page);
      await page.screenshot({ path: join(outDir, `mission-brink-${viewport.width}.png`), scale: 'css' });
      await scrollMissionToEnd(page);
      if (viewport.width <= 760) await assertNarrowHeadingVisible(page);
      await page.screenshot({ path: join(outDir, `mission-ledger-${viewport.width}.png`), scale: 'css' });
      if (viewport.width > 760) {
        await page.locator('[data-action="mission-start"]').click();
        await page.waitForFunction(() => window.eventHorizon.getState().mission.running
          && document.querySelector('[data-action="mission-start"]').textContent === 'Stop');
        await assertDesktopPanelsFit(page);
        await page.locator('[data-action="mission-start"]').click();
        await page.waitForFunction(() => !window.eventHorizon.getState().mission.running
          && document.querySelector('[data-action="mission-start"]').textContent === 'Start');
        await page.locator('[data-location="ship"]').click();
        await page.waitForFunction(() => window.eventHorizon.getState().ledger.location === 'ship'
          && document.querySelector('[data-location="ship"]').getAttribute('aria-pressed') === 'true');
        await page.locator('[data-location="brink"]').click();
        await page.waitForFunction(() => window.eventHorizon.getState().ledger.location === 'brink'
          && document.querySelector('[data-location="brink"]').getAttribute('aria-pressed') === 'true');
        await assertDesktopPanelsFit(page);
      }
      await page.keyboard.press('Escape');
      assert.equal((await state(page)).mission.open, true);
      if (viewport.width <= 760) {
        await page.locator('.panel-toggle').click();
        await panelState(page, false);
        await page.waitForFunction(() => !document.querySelector('.control-panel').inert);
        await page.locator('[data-action="mission"]').click();
        await panelState(page, true);
        assert.equal(await page.locator('.control-panel').evaluate(panel => panel.inert), true);
        await page.keyboard.press('KeyM');
        await panelState(page, false);
        for (const width of [1440, 375, 1000]) {
          await page.setViewportSize({ width, height: 812 });
          await panelState(page, false);
          await page.waitForFunction(closed => document.querySelector('.control-panel').inert === closed, width <= 760);
        }
      }
    },
  })),
];
