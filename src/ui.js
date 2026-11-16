import { SHORTCUTS } from './shortcuts.js';
import { spinFromDelta } from './kerr.js';
import { worlds } from './worlds.js';
import { formatDuration, formatFactor } from './ledger.js';

const icons = {
  orbit: '<ellipse cx="12" cy="12" rx="10" ry="4.5" transform="rotate(-35 12 12)"/><circle cx="12" cy="12" r="3"/>',
  fly: '<path d="m12 3 8 17-8-4-8 4 8-17Z"/><path d="M12 8v8"/>',
  probe: '<path d="m12 3 4 9-4 3-4-3 4-9Z"/><path d="m8 10-4 7 5-2m7-5 4 7-5-2m-5 4 2 3 2-3"/>',
  cinema: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3V9Z"/>',
  reset: '<path d="M4 9a8 8 0 1 1 0 6M4 4v5h5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3v.1"/>',
  sliders: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  mission: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2M3 12h2m14 0h2"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.orbit}</svg>`;
}

const compact = (n, digits = 2) => {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(digits)} B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(digits)} M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(digits)} K`;
  return n.toFixed(digits);
};

const clock = (seconds = 0) => {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600).toString().padStart(2, '0');
  const m = Math.floor(s / 60 % 60).toString().padStart(2, '0');
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  const cs = Math.floor(s * 100 % 100).toString().padStart(2, '0');
  return `${h}:${m}:${sec}.${cs}`;
};

function spinReadout(delta) {
  if (delta >= 1e-3) return spinFromDelta(delta).toFixed(3);
  const [coefficient, exponent] = delta.toExponential(1).split('e');
  const superscripts = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
  return `1 − ${coefficient}×10${String(Number(exponent)).replace(/[-0-9]/g, digit => superscripts[digit])}`;
}

const controls = [
  { key: 'mass', label: 'Mass', min: 1, max: 9, step: .01, unit: 'M☉', from: Math.log10, to: v => 10 ** v, format: v => compact(v, 1) },
  { key: 'spinDelta', label: 'Spin', min: 0, max: 14, step: .01, unit: 'a*', from: v => -Math.log10(v), to: v => 10 ** -v, format: spinReadout, relative: true },
  { key: 'temperature', label: 'Disk temperature', min: 2000, max: 20000, step: 100, unit: 'K', format: v => Math.round(v).toLocaleString('en-US') },
  { key: 'tilt', label: 'Disk tilt', min: -70, max: 70, step: 1, unit: '°', format: v => Math.round(v).toString() },
  { key: 'lensing', label: 'Lensing strength', min: 0, max: 2, step: .01, unit: '×', format: v => v.toFixed(2) },
  { key: 'timeScale', label: 'Time scale', min: 0, max: 4, step: .05, unit: '×', format: v => v.toFixed(2) },
];

/** DOM-only HUD. All simulation state is passed in and all input goes through callbacks. */
export function createUI({ presets, initialPreset = 'gargantua', onPreset = () => {}, onChange = () => {}, onQuality = () => {}, onAction = () => {}, onTravel = () => {} }) {
  const hud = document.createElement('div');
  hud.id = 'hud';
  const initialWorlds = worlds(presets[initialPreset].spinDelta);
  const locations = ['ship', 'farShore', 'lantern', 'brink'].map(id => initialWorlds.find(body => body.id === id));
  const ledgerRows = [['crew', 'Crew'], ['home', 'Home'], ['brink', 'Brink'], ['lantern', 'Lantern'], ['farShore', 'Far Shore'], ['ship', 'Ship']];
  hud.innerHTML = `
    <header class="topbar">
      <a class="brand" href="#" aria-label="Event Horizon — reset view">
        <svg class="brand-mark" viewBox="0 0 44 44" fill="none" aria-hidden="true"><circle cx="22" cy="22" r="11" stroke="currentColor"/><ellipse cx="22" cy="22" rx="21" ry="6" transform="rotate(-31 22 22)" stroke="currentColor"/><circle cx="22" cy="22" r="15" stroke="currentColor" stroke-opacity=".18"/></svg>
        <span><span class="brand-title">EVENT HORIZON<span class="brand-dot">.</span></span><span class="brand-subtitle">A STUDY IN GRAVITY</span></span>
      </a>
      <div class="top-center"><span class="live-dot"></span> LIVE SIMULATION <span class="top-divider">/</span> SCHWARZSCHILD METRIC</div>
      <div class="top-actions">
        <span class="performance"><span data-readout="fps">—</span><small>FPS</small><i class="signal-bars" aria-hidden="true"><i></i><i></i><i></i></i></span>
        <button class="cinema-button" data-action="cinematic" aria-pressed="false">${icon('cinema')}<span>Cinematic</span><kbd>C</kbd></button>
      </div>
    </header>

    <section class="object-label" aria-label="Current black hole">
      <div class="eyebrow"><span class="amber-line"></span> DEEP SPACE OBSERVATORY <span class="muted">001</span></div>
      <h1 data-readout="object-name">Gargantua</h1>
      <p data-readout="object-description">Supermassive black hole</p>
      <div class="object-coordinates">SCHWARZSCHILD GEOMETRY<span>PROCEDURAL · REAL TIME</span></div>
    </section>

    <button class="panel-toggle icon-button" aria-label="Toggle simulation controls" aria-expanded="true">${icon('sliders')}</button>
    <aside class="control-panel" aria-label="Simulation controls">
      <div class="panel-heading"><span class="eyebrow">SIMULATION</span><span class="panel-number">01 / CONTROLS</span></div>
      <div class="preset-tabs world-presets" role="group" aria-label="Black hole preset">${Object.entries(presets).map(([id, p]) => `<button data-preset="${id}" aria-pressed="${id === initialPreset}">${p.name}</button>`).join('')}</div>
      <div class="quality-heading eyebrow">QUALITY</div>
      <div class="preset-tabs quality-tabs" role="group" aria-label="Quality">${['auto', 'high', 'balanced', 'performance'].map(mode => `<button data-quality="${mode}" aria-pressed="${mode === 'auto'}">${mode[0].toUpperCase() + mode.slice(1)}</button>`).join('')}</div>
      <div class="parameter-list">${controls.map(c => `<div class="parameter"><div class="parameter-heading"><label for="param-${c.key}">${c.label}</label><span class="parameter-output"><output for="param-${c.key}" data-control-output="${c.key}">—</output><span class="unit">${c.unit}</span></span></div><input id="param-${c.key}" name="${c.key}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" aria-label="${c.label}"></div>`).join('')}</div>
      <div class="panel-footnote"><span class="small-cross">+</span><span>Light follows the curvature of spacetime.</span></div>
      <button class="alignment-button" data-action="align"><span>Align a background star</span><kbd>E</kbd></button>
    </aside>

    <aside class="mission-panel" aria-label="Mission" inert>
      <div class="panel-heading"><span class="eyebrow">MISSION</span><span class="panel-number">02 / CLOCKS</span></div>
      <div class="mission-locations" role="group" aria-label="Crew location">${locations.map(body => `<button data-location="${body.id}" aria-pressed="${body.id === 'ship'}"><span class="location-heading"><span class="location-name">${body.name}</span><span data-radius>—</span></span><span class="location-factor"><span data-factor title="Home time / local time">—</span><span data-hour-cost>—</span></span></button>`).join('')}</div>
      <div class="eyebrow ledger-heading">TIME LEDGER</div>
      <dl class="mission-ledger">${ledgerRows.map(([id, label]) => `<div><dt>${label}</dt><dd data-ledger="${id}">0 s</dd></div>`).join('')}</dl>
      <div class="mission-actions"><button data-action="mission-start" aria-pressed="false">Start</button><button data-action="mission-reset">Reset ledger</button></div>
    </aside>

    <section class="telemetry" aria-label="Live measurements">
      <div class="eyebrow telemetry-heading">OBSERVER TELEMETRY <span class="live-dot"></span></div>
      <div class="metric"><span class="metric-label">MASS</span><span class="metric-value"><span data-readout="mass">100.00 M</span><small>M☉</small></span></div>
      <div class="metric"><span class="metric-label">SCHWARZSCHILD RADIUS</span><span class="metric-value"><span data-readout="radius">295.33 M</span><small>km</small></span></div>
      <div class="metric"><span class="metric-label">OBSERVER DISTANCE</span><span class="metric-value"><span data-readout="cameraDistance">17.02</span><small>rₛ</small></span></div>
      <div class="metric"><span class="metric-label">SHADOW</span><span class="metric-value"><span data-readout="shadowFraction">0.3</span><small>% OF SKY</small></span></div>
      <section class="probe-readout" aria-label="Probe signal">
        <div class="probe-status"><span class="probe-light" aria-hidden="true"></span><span data-readout="probeState">PROBE STANDBY</span><span class="probe-flashes" data-readout="probeFlashes"></span></div>
        <dl class="probe-values" hidden>
          <div><dt>SEEN AT</dt><dd><span data-readout="probeRadius">—</span><small>rₛ</small></dd></div>
          <div><dt>SIGNAL</dt><dd><span data-readout="probeSignal">—</span><small>ν/ν₀</small></dd></div>
          <div><dt>PROBE CLOCK</dt><dd><span data-readout="probeClock">—</span><small>rₛ/c</small></dd></div>
          <div><dt>YOUR CLOCK</dt><dd><span data-readout="probeObserverClock">—</span><small>rₛ/c</small></dd></div>
        </dl>
      </section>
    </section>

    <div class="simulation-time" aria-label="Observer clock"><div class="eyebrow">LOCAL PROPER TIME <span data-readout="dilation">τ / t 0.970</span></div><div class="clock-row"><time data-readout="clock">00:00:00.00</time><button class="icon-button pause-button" data-action="pause" aria-label="Pause simulation" aria-pressed="false">${icon('pause')}</button></div></div>

    <nav class="camera-dock" aria-label="Camera and probe controls">
      <button class="dock-button active" data-action="reset" data-mode="orbit" aria-pressed="true">${icon('orbit')}<span>Orbit</span></button>
      <button class="dock-button" data-action="fly" data-mode="fly" aria-pressed="false">${icon('fly')}<span>Fly in</span><kbd>F</kbd></button>
      <span class="dock-divider"></span>
      <button class="dock-button probe-button" data-action="probe">${icon('probe')}<span>Drop a probe</span><kbd>P</kbd></button>
      <button class="dock-button mission-button" data-action="mission" aria-label="Mission" aria-expanded="false">${icon('mission')}<span>Mission</span></button>
    </nav>

    <footer class="statusbar"><span class="interaction-hint"><span class="mouse-symbol" aria-hidden="true"></span> DRAG TO ORBIT <span class="hint-separator">·</span> SCROLL TO EXPLORE</span><span class="render-status"><span class="live-dot"></span> <span data-readout="quality">ADAPTIVE QUALITY</span></span><button class="help-button" data-action="help" aria-label="Open keyboard shortcuts">${icon('help')}<span>SHORTCUTS</span></button></footer>
    <div class="notice" role="status" aria-live="polite"></div>
    <dialog class="help-dialog" aria-label="Keyboard shortcuts"><div class="dialog-heading"><span class="eyebrow">FLIGHT MANUAL</span><button class="close-help icon-button" aria-label="Close keyboard shortcuts">×</button></div><h2 tabindex="-1" autofocus>Explore the edge.</h2><p>Drag or use one finger to orbit; in flight, look freely. Scroll or pinch to zoom. F stops the approach; R restores the view.</p><dl>${SHORTCUTS.map(shortcut => `<div data-shortcut="${shortcut.code}"><dt>${shortcut.description}</dt><dd><kbd>${shortcut.label}</kbd></dd></div>`).join('')}</dl><p class="help-note">Spin sets disk rotation and beaming in the picture, which remains Schwarzschild; the Mission clocks use the Kerr metric for the selected spin.</p></dialog>
  `;
  document.body.append(hud);
  const events = new AbortController();
  const options = { signal: events.signal };
  const readouts = Object.fromEntries([...hud.querySelectorAll('[data-readout]')].map(el => [el.dataset.readout, el]));
  const inputs = Object.fromEntries(controls.map(c => [c.key, hud.querySelector(`#param-${c.key}`)]));
  const outputs = Object.fromEntries([...hud.querySelectorAll('[data-control-output]')].map(el => [el.dataset.controlOutput, el]));
  const presetButtons = [...hud.querySelectorAll('[data-preset]')];
  const dialog = hud.querySelector('dialog');
  let noticeTimer;
  let lastPaused;
  let selectedPreset = initialPreset;
  const parameterValues = {};
  const narrowLayout = window.matchMedia('(max-width: 760px)');
  const panel = hud.querySelector('.control-panel');
  const toggle = hud.querySelector('.panel-toggle');
  const missionPanel = hud.querySelector('.mission-panel');
  const missionToggle = hud.querySelector('[data-action="mission"]');
  const missionStart = hud.querySelector('[data-action="mission-start"]');
  const locationReadouts = Object.fromEntries([...hud.querySelectorAll('[data-location]')].map(button => [button.dataset.location, {
    button, radius: button.querySelector('[data-radius]'), factor: button.querySelector('[data-factor]'), cost: button.querySelector('[data-hour-cost]'),
  }]));
  const ledgerReadouts = Object.fromEntries([...hud.querySelectorAll('[data-ledger]')].map(element => [element.dataset.ledger, element]));
  function setMissionOpen(open) {
    hud.classList.toggle('mission-open', open);
    missionPanel.inert = !open;
    missionToggle.setAttribute('aria-expanded', String(open));
    if (open && narrowLayout.matches) setPanelClosed(true);
  }
  function setPanelClosed(closed) {
    hud.classList.toggle('panel-closed', closed);
    panel.inert = closed;
    toggle.setAttribute('aria-expanded', String(!closed));
    if (!closed && narrowLayout.matches) setMissionOpen(false);
  }
  const syncLayout = () => setPanelClosed(narrowLayout.matches);
  narrowLayout.addEventListener('change', syncLayout, options);
  syncLayout();

  function write(name, value) {
    if (readouts[name] && readouts[name].textContent !== value) readouts[name].textContent = value;
  }

  function controlPosition(c, value) {
    const raw = c.from ? c.from(value) : value;
    return Math.max(c.min, Math.min(c.max, c.min + Math.round((raw - c.min) / c.step) * c.step));
  }

  function setControl(c, value) {
    const raw = controlPosition(c, value);
    inputs[c.key].value = raw;
    inputs[c.key].style.setProperty('--fill', `${Math.max(0, Math.min(100, (raw - c.min) / (c.max - c.min) * 100))}%`);
    outputs[c.key].value = c.format(value);
    inputs[c.key].setAttribute('aria-valuetext', `${c.format(value)} ${c.unit}`);
  }

  controls.forEach(c => inputs[c.key].addEventListener('input', () => {
    const position = Number(inputs[c.key].value);
    const presetValue = presets[selectedPreset][c.key];
    // A transformed preset retains its exact value at its snapped thumb position.
    const atPreset = c.from && c.to && Math.abs(position - controlPosition(c, presetValue)) < c.step / 2;
    const value = atPreset ? presetValue : c.to ? c.to(position) : position;
    setControl(c, value);
    parameterValues[c.key] = value;
    const custom = controls.some(control => {
      const expected = presets[selectedPreset][control.key];
      const scale = control.relative ? Math.abs(expected) : Math.max(1, Math.abs(expected));
      return Math.abs(parameterValues[control.key] - expected) > 1e-9 * scale;
    });
    presetButtons.forEach(b => b.setAttribute('aria-pressed', String(!custom && b.dataset.preset === selectedPreset)));
    write('object-description', custom ? 'Custom parameters' : presetDescription(selectedPreset));
    onChange(c.key, value);
  }, options));

  function setPreset(id, values = presets[id]) {
    presetButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === id)));
    if (!values) return;
    selectedPreset = id;
    Object.assign(parameterValues, values);
    controls.forEach(c => { if (Number.isFinite(values[c.key])) setControl(c, values[c.key]); });
    write('object-name', values.name || presets[id]?.name || 'Custom singularity');
    write('object-description', presetDescription(id));
  }

  function presetDescription(id) {
    if (id === 'deep') return 'Near-extremal spin';
    return id === 'quiet' ? 'A quiet stellar remnant' : id === 'sagittarius' ? 'At the heart of the Milky Way' : 'Supermassive black hole';
  }

  presetButtons.forEach(button => button.addEventListener('click', () => {
    setPreset(button.dataset.preset);
    onPreset(button.dataset.preset);
  }, options));

  hud.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    onAction(button.dataset.action);
  }, options));
  Object.entries(locationReadouts).forEach(([id, { button }]) => button.addEventListener('click', () => onTravel(id), options));
  hud.querySelectorAll('[data-quality]').forEach(button => button.addEventListener('click', () => {
    hud.querySelectorAll('[data-quality]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    onQuality(button.dataset.quality);
  }, options));
  hud.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); onAction('reset'); }, options);
  hud.querySelector('.close-help').addEventListener('click', () => dialog.close(), options);
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }, options);
  toggle.addEventListener('click', () => {
    setPanelClosed(narrowLayout.matches && !hud.classList.contains('panel-closed'));
  }, options);

  function setMode(mode) {
    hud.dataset.mode = mode;
    hud.querySelectorAll('[data-mode]').forEach(button => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    hud.querySelector('[data-action="cinematic"]').setAttribute('aria-pressed', String(mode === 'cinematic'));
  }

  function update(r = {}) {
    if (r.ledger) {
      const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
      for (const body of worlds(r.spinDelta)) {
        const readout = locationReadouts[body.id];
        readout.button.setAttribute('aria-pressed', String(body.id === r.ledger.location));
        setText(readout.radius, `${Number(body.radiusM.toPrecision(8))} M`);
        setText(readout.factor, formatFactor(body.dtdtau));
        setText(readout.cost, `1 h here = ${formatDuration(3600 * body.dtdtau)}`);
      }
      for (const [id, element] of Object.entries(ledgerReadouts)) {
        const seconds = id === 'crew' ? r.ledger.crewSeconds : id === 'home' ? r.ledger.homeSeconds : r.ledger.bodySeconds[id];
        setText(element, formatDuration(seconds));
      }
      setText(missionStart, r.missionRunning ? 'Stop' : 'Start');
      missionStart.setAttribute('aria-pressed', String(r.missionRunning));
    }
    if (Number.isFinite(r.fps)) write('fps', Math.round(r.fps).toString());
    if (r.quality !== undefined) write('quality', `${r.qualityMode === 'auto' ? 'AUTO' : 'FIXED'} · ${r.quality}`);
    if (Number.isFinite(r.mass)) write('mass', compact(r.mass));
    if (Number.isFinite(r.radius)) write('radius', compact(r.radius / 1000));
    if (Number.isFinite(r.cameraDistance)) write('cameraDistance', r.cameraDistance.toFixed(2));
    if (Number.isFinite(r.shadowFraction)) write('shadowFraction', (r.shadowFraction * 100).toFixed(1));
    if (Number.isFinite(r.dilation)) write('dilation', `τ / t ${r.dilation.toFixed(3)}`);
    if (Number.isFinite(r.clock)) write('clock', clock(r.clock));
    if (r.probeState !== undefined) {
      const state = String(r.probeState).toLowerCase();
      const active = state !== 'idle' && state !== 'standby';
      hud.querySelector('.probe-values').hidden = !r.probe;
      hud.classList.toggle('probe-active', active && state !== 'lost');
      hud.dataset.probeState = state;
      hud.style.setProperty('--probe-pulse', active && state !== 'lost' ? r.probe.pulse : 0);
      write('probeFlashes', active ? `FLASH ${r.probe.flashCount} of ${r.probe.flashTotal}` : '');
      write('probeState', state === 'lost' ? 'SIGNAL LOST' : state === 'fading' ? 'SIGNAL FADING' : active ? 'PROBE · FALLING' : 'PROBE STANDBY');
      for (const [key, value, digits] of [
        ['probeRadius', r.probe?.radius, 3], ['probeSignal', r.probe?.signal, 3],
        ['probeClock', r.probe?.properElapsed, 3], ['probeObserverClock', r.probe?.observerElapsed, 3],
      ]) write(key, active && Number.isFinite(value) ? value.toFixed(digits) : '—');
    }
    if (r.paused !== undefined && r.paused !== lastPaused) {
      lastPaused = r.paused;
      const button = hud.querySelector('.pause-button');
      button.innerHTML = icon(r.paused ? 'play' : 'pause');
      button.setAttribute('aria-label', r.paused ? 'Resume simulation' : 'Pause simulation');
      button.setAttribute('aria-pressed', String(r.paused));
      hud.classList.toggle('simulation-paused', r.paused);
    }
  }

  function setNotice(message) {
    clearTimeout(noticeTimer);
    const notice = hud.querySelector('.notice');
    notice.textContent = message;
    notice.classList.toggle('visible', Boolean(message));
    if (message) noticeTimer = setTimeout(() => notice.classList.remove('visible'), 6000);
  }

  setPreset(initialPreset);
  return { update, setMode, setPreset, setNotice,
    toggleMission() { setMissionOpen(missionPanel.inert); },
    get missionOpen() { return !missionPanel.inert; },
    toggleHelp() {
      if (dialog.open) dialog.close();
      else dialog.showModal();
      return dialog.open;
    },
    destroy() { events.abort(); clearTimeout(noticeTimer); hud.remove(); } };
}
