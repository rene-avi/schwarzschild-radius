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

const controls = [
  { key: 'mass', label: 'Mass', min: 1, max: 9, step: .01, unit: 'M☉', from: Math.log10, to: v => 10 ** v, format: v => compact(v, 1) },
  { key: 'spin', label: 'Spin', min: 0, max: .99, step: .01, unit: 'a*', format: v => v.toFixed(2) },
  { key: 'temperature', label: 'Disk temperature', min: 2000, max: 20000, step: 100, unit: 'K', format: v => Math.round(v).toLocaleString('en-US') },
  { key: 'tilt', label: 'Disk tilt', min: -70, max: 70, step: 1, unit: '°', format: v => Math.round(v).toString() },
  { key: 'lensing', label: 'Lensing strength', min: 0, max: 2, step: .01, unit: '×', format: v => v.toFixed(2) },
  { key: 'timeScale', label: 'Time scale', min: 0, max: 4, step: .05, unit: '×', format: v => v.toFixed(2) },
];

/** DOM-only HUD. All simulation state is passed in and all input goes through callbacks. */
export function createUI({ presets, initialPreset = 'gargantua', onPreset = () => {}, onChange = () => {}, onAction = () => {} }) {
  const hud = document.createElement('div');
  hud.id = 'hud';
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
      <div class="preset-tabs" role="group" aria-label="Black hole preset">${Object.entries(presets).map(([id, p]) => `<button data-preset="${id}" aria-pressed="${id === initialPreset}">${p.name}</button>`).join('')}</div>
      <div class="parameter-list">${controls.map(c => `<div class="parameter"><div class="parameter-heading"><label for="param-${c.key}">${c.label}</label><span class="parameter-output"><output for="param-${c.key}" data-control-output="${c.key}">—</output><span class="unit">${c.unit}</span></span></div><input id="param-${c.key}" name="${c.key}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" aria-label="${c.label}"></div>`).join('')}</div>
      <div class="panel-footnote"><span class="small-cross">+</span><span>Light follows the curvature of spacetime.</span></div>
      <button class="alignment-button" data-action="align"><span>Align a background star</span><kbd>E</kbd></button>
    </aside>

    <section class="telemetry" aria-label="Live measurements">
      <div class="eyebrow telemetry-heading">OBSERVER TELEMETRY <span class="live-dot"></span></div>
      <div class="metric"><span class="metric-label">MASS</span><span class="metric-value"><span data-readout="mass">100.00 M</span><small>M☉</small></span></div>
      <div class="metric"><span class="metric-label">SCHWARZSCHILD RADIUS</span><span class="metric-value"><span data-readout="radius">295.33 M</span><small>km</small></span></div>
      <div class="metric"><span class="metric-label">OBSERVER DISTANCE</span><span class="metric-value"><span data-readout="cameraDistance">17.02</span><small>rₛ</small></span></div>
      <div class="probe-readout"><span class="probe-status"><span class="probe-light"></span><span data-readout="probeState">PROBE STANDBY</span></span><span class="probe-factor" data-readout="probeDilation">—</span></div>
    </section>

    <div class="simulation-time" aria-label="Observer clock"><div class="eyebrow">LOCAL PROPER TIME <span data-readout="dilation">τ / t 0.970</span></div><div class="clock-row"><time data-readout="clock">00:00:00.00</time><button class="icon-button pause-button" data-action="pause" aria-label="Pause simulation" aria-pressed="false">${icon('pause')}</button></div></div>

    <nav class="camera-dock" aria-label="Camera and probe controls">
      <button class="dock-button active" data-action="reset" data-mode="orbit" aria-pressed="true">${icon('orbit')}<span>Orbit</span></button>
      <button class="dock-button" data-action="fly" data-mode="fly" aria-pressed="false">${icon('fly')}<span>Fly in</span><kbd>F</kbd></button>
      <span class="dock-divider"></span>
      <button class="dock-button probe-button" data-action="probe">${icon('probe')}<span>Drop a probe</span><kbd>P</kbd></button>
    </nav>

    <footer class="statusbar"><span class="interaction-hint"><span class="mouse-symbol" aria-hidden="true"></span> DRAG TO ORBIT <span class="hint-separator">·</span> SCROLL TO EXPLORE</span><span class="render-status"><span class="live-dot"></span> <span data-readout="quality">ADAPTIVE QUALITY</span></span><button class="help-button" data-action="help" aria-label="Open keyboard shortcuts">${icon('help')}<span>SHORTCUTS</span></button></footer>
    <div class="notice" role="status" aria-live="polite"></div>
    <dialog class="help-dialog"><div class="dialog-heading"><span class="eyebrow">FLIGHT MANUAL</span><button class="close-help icon-button" aria-label="Close keyboard shortcuts">×</button></div><h2>Explore the edge.</h2><p>Drag to orbit. Scroll to approach. Watch local time slow as gravity grows.</p><dl><div><dt>Cinematic flight</dt><dd><kbd>C</kbd></dd></div><div><dt>Fly toward the horizon</dt><dd><kbd>F</kbd></dd></div><div><dt>Release a probe</dt><dd><kbd>P</kbd></dd></div><div><dt>Pause simulation</dt><dd><kbd>Space</kbd></dd></div><div><dt>Reset the camera</dt><dd><kbd>R</kbd></dd></div></dl><p class="help-note">Spin controls disk rotation and beaming. The spacetime model remains Schwarzschild.</p></dialog>
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
  if (window.matchMedia('(max-width: 760px)').matches) {
    hud.classList.add('panel-closed');
    hud.querySelector('.panel-toggle').setAttribute('aria-expanded', 'false');
  }

  function write(name, value) {
    if (readouts[name] && readouts[name].textContent !== value) readouts[name].textContent = value;
  }

  function setControl(c, value) {
    const raw = c.from ? c.from(value) : value;
    inputs[c.key].value = raw;
    inputs[c.key].style.setProperty('--fill', `${Math.max(0, Math.min(100, (raw - c.min) / (c.max - c.min) * 100))}%`);
    outputs[c.key].value = c.format(value);
    inputs[c.key].setAttribute('aria-valuetext', `${c.format(value)} ${c.unit}`);
  }

  controls.forEach(c => inputs[c.key].addEventListener('input', () => {
    const value = c.to ? c.to(Number(inputs[c.key].value)) : Number(inputs[c.key].value);
    setControl(c, value);
    presetButtons.forEach(b => b.setAttribute('aria-pressed', 'false'));
    onChange(c.key, value);
  }, options));

  function setPreset(id, values = presets[id]) {
    presetButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === id)));
    if (!values) return;
    controls.forEach(c => { if (Number.isFinite(values[c.key])) setControl(c, values[c.key]); });
    write('object-name', values.name || presets[id]?.name || 'Custom singularity');
    write('object-description', id === 'quiet' ? 'A quiet stellar remnant' : id === 'sagittarius' ? 'At the heart of the Milky Way' : 'Supermassive black hole');
  }

  presetButtons.forEach(button => button.addEventListener('click', () => {
    setPreset(button.dataset.preset);
    onPreset(button.dataset.preset);
  }, options));

  hud.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.action === 'help') dialog.showModal();
    onAction(button.dataset.action);
  }, options));
  hud.querySelector('.brand').addEventListener('click', event => { event.preventDefault(); onAction('reset'); }, options);
  hud.querySelector('.close-help').addEventListener('click', () => dialog.close(), options);
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }, options);
  hud.querySelector('.panel-toggle').addEventListener('click', event => {
    const closed = hud.classList.toggle('panel-closed');
    event.currentTarget.setAttribute('aria-expanded', String(!closed));
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
    if (Number.isFinite(r.fps)) write('fps', Math.round(r.fps).toString());
    if (r.quality !== undefined) write('quality', `ADAPTIVE · ${typeof r.quality === 'number' ? ['LOW', 'BALANCED', 'HIGH'][Math.round(r.quality)] || `${Math.round(r.quality * 100)}%` : r.quality}`.toUpperCase());
    if (Number.isFinite(r.mass)) write('mass', compact(r.mass));
    if (Number.isFinite(r.radius)) write('radius', compact(r.radius / 1000));
    if (Number.isFinite(r.cameraDistance)) write('cameraDistance', r.cameraDistance.toFixed(2));
    if (Number.isFinite(r.dilation)) write('dilation', `τ / t ${r.dilation.toFixed(3)}`);
    if (Number.isFinite(r.clock)) write('clock', clock(r.clock));
    if (r.probeState !== undefined) {
      const state = String(r.probeState).toLowerCase();
      const active = state !== 'idle' && state !== 'standby';
      hud.classList.toggle('probe-active', active);
      write('probeState', state === 'frozen' ? 'PROBE · AT HORIZON' : active ? 'PROBE · FALLING' : 'PROBE STANDBY');
      write('probeDilation', active && Number.isFinite(r.probeDilation) ? `${r.probeDilation.toFixed(3)}×` : '—');
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
  return { update, setMode, setPreset, setNotice, destroy() { events.abort(); clearTimeout(noticeTimer); hud.remove(); } };
}
