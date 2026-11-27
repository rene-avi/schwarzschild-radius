import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ObservatoryCamera } from '../src/camera.js';
import * as physics from '../src/physics.js';
import * as kerr from '../src/kerr.js';
import * as kerrray from '../src/kerrray.js';
import * as kerrworlds from '../src/kerrworlds.js';
import * as worldview from '../src/worldview.js';
import * as kerrprobe from '../src/kerrprobe.js';
import { reset as resetLedger, advance as advanceLedger, travel as travelLedger } from '../src/ledger.js';
import { crewStep } from '../src/mission.js';
import { QualityController } from '../src/quality.js';
import * as shortcuts from '../src/shortcuts.js';
import { assertInputState } from './browser/checks/controls.mjs';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replaceAll('import.meta.hot', 'false');

// Run the real loop and public telemetry with only DOM, GPU and worker boundaries stubbed.
function withObservatory(metric, run) {
  const previousWindow = globalThis.window;
  const window = globalThis.window = new EventTarget();
  window.location = { search: `?debug=1&metric=${metric}` };
  const canvas = new EventTarget(), document = new EventTarget();
  document.querySelector = selector => {
    assert.equal(selector, '#universe');
    return canvas;
  };
  let nextFrame, uiOptions, camera;
  const ui = { missionOpen: false, setMode() {}, setNotice() {}, setPreset() {}, update() {} };
  try {
    runInNewContext(main, {
      ...physics, ...kerr, ...kerrray, ...kerrworlds, ...worldview, ...kerrprobe, ...shortcuts,
      resetLedger, advanceLedger, travelLedger, crewStep, QualityController,
      window, document, URLSearchParams, AbortController,
      requestAnimationFrame(callback) { nextFrame = callback; return 1; },
      cancelAnimationFrame() {},
      ObservatoryCamera: class extends ObservatoryCamera {
        constructor(...args) { super(...args); camera = this; }
      },
      createUI(options) { uiOptions = options; return ui; },
      BlackHoleScene: class {
        quality = 'high'; scale = 1; meter = { exposure: 1 };
        setWorlds() {} render() {} setScale() {}
      },
      KerrProbeWorker: class { constructor() { throw new Error('Unexpected worker'); } },
    }, { filename: 'src/main.js' });
    const api = window.eventHorizon;
    api.debug.setPaused(true);
    api.debug.setQualityPinned(true);
    let now = 0;
    const frame = dt => { now += dt * 1000; nextFrame(now); };
    const snapshot = () => {
      const { fps, renderedFrames, exposure, ...state } = api.getState();
      return structuredClone(state);
    };
    frame(0);
    run({ api, frame, snapshot, camera, ui, uiOptions });
  } finally {
    camera?.destroy();
    globalThis.window = previousWindow;
  }
}

for (const metric of ['schwarzschild', 'kerr']) {
  test(`${metric}: paused getState stays bitwise equal across varying idle frame intervals`, () => withObservatory(metric, ({ api, frame, snapshot, ui }) => {
    for (const open of [false, true]) {
      ui.missionOpen = open;
      api.debug.setCamera({ radius: 23, theta: .05, elevation: .23 });
      frame(.01);
      const before = snapshot();
      assert.deepEqual(snapshot(), before, 'consecutive getState calls');
      for (let i = 1; i <= 100; i++) {
        frame(i / 1000);
        assert.deepEqual(snapshot(), before, `idle frame ${i}, Mission ${open}`);
      }
      const copy = snapshot();
      if (copy.worlds[0].center) copy.worlds[0].center[0] = 999;
      copy.settings.mass = 1;
      assert.deepEqual(snapshot(), before, 'telemetry stays copied');
    }
  }));

  test(`${metric}: D4 rejects real input and simulation changes`, () => withObservatory(metric, ({ api, frame, snapshot, camera, ui, uiOptions }) => {
    ui.missionOpen = true;
    frame(.01);
    const before = snapshot();
    assert.doesNotThrow(() => assertInputState(snapshot(), before, 'unchanged'));
    for (const [name, change] of [
      ['probe dropped', state => { state.probe = { elapsed: 0, state: 'falling' }; }],
      ['paused toggled', state => { state.paused = !state.paused; }],
      ['camera mode changed', state => { state.camera.mode = 'fly'; }],
      ['preset changed', state => { state.settings = { ...physics.PRESETS.quiet }; }],
    ]) {
      const changed = structuredClone(before);
      change(changed);
      assert.throws(() => assertInputState(changed, before, name), assert.AssertionError, name);
    }
    const noisy = structuredClone(before);
    assert.ok(noisy.worlds[0].center, 'direct image has a centre');
    const exact = structuredClone(noisy);
    noisy.worlds[0].center[0] += 1e-15;
    assert.notEqual(noisy.worlds[0].center[0], exact.worlds[0].center[0]);
    assert.throws(() => assertInputState(noisy, exact, 'telemetry noise'), assert.AssertionError);

    api.debug.setWorldPhases({ lantern: worldview.START_PHASES.lantern + 1e-6 });
    frame(.006);
    assert.throws(() => assertInputState(snapshot(), before, 'world phase +1e-6'), assert.AssertionError);
    if (metric === 'kerr') assert.equal(snapshot().worlds[0].phase, worldview.START_PHASES.lantern + 1e-6);
    else assert.notDeepEqual(snapshot().worlds[0].center, before.worlds[0].center);
    api.debug.setWorldPhases(worldview.START_PHASES);
    camera.reset();
    frame(.006);
    uiOptions.onPreset('quiet');
    assert.throws(() => assertInputState(snapshot(), before, 'actual preset selection'), assert.AssertionError);
  }));
}
