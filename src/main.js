import './style.css';
import { BlackHoleScene } from './scene.js';
import { ObservatoryCamera } from './camera.js';
import { PRESETS, schwarzschildRadius, timeDilation, createProbe, updateProbe } from './physics.js';
import { createUI } from './ui.js';

const canvas = document.querySelector('#universe');
const settings = { ...PRESETS.gargantua };
let paused = false;
let probe = null;
let simulationTime = 0;
let clock = 0;
let scene;
let ui;
let frameId;
let previousTime = null;
let fpsElapsed = 0;
let fpsFrames = 0;
let fps = 60;
let slowSeconds = 0;
let fastSeconds = 0;
let contextLost = false;
const events = new AbortController();
const eventOptions = { signal: events.signal };

const camera = new ObservatoryCamera(canvas, (mode) => ui?.setMode(mode));

function action(type) {
  switch (type) {
    case 'probe':
      probe = createProbe();
      ui.setNotice('PROBE 01 RELEASED · Tracking gravitational descent');
      break;
    case 'cinematic':
      camera.setMode(camera.mode === 'cinematic' ? 'orbit' : 'cinematic');
      ui.setNotice(camera.mode === 'cinematic' ? 'CINEMATIC PATH · Press H to hide the HUD for recording' : 'ORBIT CONTROL RESTORED');
      break;
    case 'fly':
      camera.setMode(camera.mode === 'fly' ? 'orbit' : 'fly');
      ui.setNotice(camera.mode === 'fly' ? 'APPROACHING HORIZON · W/S thrust · A/D steer · R to return' : 'ORBIT CONTROL RESTORED');
      break;
    case 'orbit': camera.setMode('orbit'); break;
    case 'align':
      camera.alignStar();
      ui.setNotice('STELLAR ALIGNMENT · A background star forms an Einstein ring');
      break;
    case 'reset':
      camera.reset();
      probe = null;
      clock = 0;
      ui.setNotice('OBSERVATION POINT RESTORED');
      break;
    case 'pause': paused = !paused; break;
    case 'help':
      ui.setNotice('Drag to orbit · Scroll to zoom · F fly · P probe · C cinema · Space pause · R reset · H hide HUD');
      break;
    case 'hud': document.body.classList.toggle('hud-hidden'); break;
  }
}

ui = createUI({
  presets: PRESETS,
  initialPreset: 'gargantua',
  onPreset(id) {
    if (!PRESETS[id]) return;
    Object.assign(settings, PRESETS[id]);
    camera.reset();
    probe = null;
    ui.setPreset(id, settings);
    ui.setNotice(`${settings.name.toUpperCase()} · Observation parameters loaded`);
  },
  onChange(key, value) { if (key in settings && Number.isFinite(value)) settings[key] = value; },
  onAction: action,
});

function showFailure(message) {
  cancelAnimationFrame(frameId);
  window.eventHorizonBoot?.fail(message);
  const existing = document.querySelector('.render-error');
  if (existing) existing.remove();
  const error = document.createElement('section');
  error.className = 'render-error';
  error.setAttribute('role', 'alert');
  error.textContent = message;
  document.querySelector('#observatory').append(error);
}

try {
  scene = new BlackHoleScene(canvas, settings);
} catch (error) {
  console.error(error);
  showFailure('The observatory needs WebGL 2. Enable hardware acceleration in your browser and reload to begin.');
}

window.addEventListener('resize', () => scene?.resize(), eventOptions);
window.addEventListener('keydown', (event) => {
  if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  if (event.target.tagName === 'BUTTON' && event.code === 'Space') return;
  const shortcuts = { KeyP: 'probe', KeyC: 'cinematic', KeyF: 'fly', KeyR: 'reset', KeyE: 'align', KeyH: 'hud', Space: 'pause', Escape: 'orbit', Slash: 'help' };
  const command = shortcuts[event.code];
  if (command && !event.repeat) { event.preventDefault(); action(command); }
}, eventOptions);
document.addEventListener('visibilitychange', () => {
  previousTime = null;
  fpsElapsed = fpsFrames = slowSeconds = fastSeconds = 0;
}, eventOptions);
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  contextLost = true;
  showFailure('The graphics connection was interrupted. Waiting for the browser to restore it…');
}, eventOptions);
canvas.addEventListener('webglcontextrestored', () => window.location.reload(), eventOptions);

function animate(now) {
  if (contextLost) return;
  frameId = requestAnimationFrame(animate);
  const rawDt = previousTime === null ? 1 / 60 : Math.max(0, (now - previousTime) / 1000);
  previousTime = now;
  if (document.hidden) return;
  // Avoid simulation jumps after debugging, tab suspension, or shader compilation.
  const dt = Math.min(rawDt, 0.1);
  const simDt = paused ? 0 : dt * settings.timeScale;
  camera.update(dt);
  const dilation = timeDilation(camera.radius);
  simulationTime += simDt;
  clock += simDt * dilation;
  if (probe) updateProbe(probe, paused ? 0 : dt, settings.timeScale);

  fpsElapsed += rawDt;
  fpsFrames += 1;
  if (fpsElapsed >= 0.75) {
    fps = Math.round(fpsFrames / fpsElapsed);
    slowSeconds = fps < 50 ? slowSeconds + fpsElapsed : 0;
    fastSeconds = fps >= 58 ? fastSeconds + fpsElapsed : 0;
    // Hysteresis avoids oscillating resolution on borderline graphics hardware.
    if (slowSeconds >= 1.5) {
      scene.adjustQuality(-1);
      slowSeconds = fastSeconds = 0;
    } else if (fastSeconds >= 12 && scene.scale < 1) {
      scene.adjustQuality(1);
      slowSeconds = fastSeconds = 0;
    }
    fpsElapsed = fpsFrames = 0;
  }
  try {
    scene.render(camera, settings, simulationTime, probe);
  } catch (error) {
    console.error(error);
    contextLost = true;
    showFailure('The graphics renderer could not start. Update your browser or graphics driver, then reload.');
    return;
  }
  window.eventHorizonBoot?.ready();
  ui.update({
    fps, quality: scene.quality, mass: settings.mass,
    radius: schwarzschildRadius(settings.mass), dilation, clock,
    probeDilation: probe?.dilation ?? 1, probeState: probe?.state ?? 'idle',
    cameraDistance: camera.radius, paused,
    cinematic: camera.mode === 'cinematic', fly: camera.mode === 'fly',
  });
}

// Read-only observatory telemetry, useful for automated browser validation.
Object.defineProperty(window, 'eventHorizon', {
  configurable: true,
  value: Object.freeze({ getState: () => ({ settings: { ...settings }, camera: { mode: camera.mode, radius: camera.radius, dilation: timeDilation(camera.radius) }, probe: probe ? { ...probe } : null, paused, clock, fps, quality: scene?.quality, renderScale: scene?.scale }) }),
});

if (scene) frameId = requestAnimationFrame(animate);
if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(frameId);
  events.abort();
  scene?.destroy();
  camera.destroy();
  ui.destroy();
});
