import './style.css';
import { BlackHoleScene } from './scene.js';
import { ObservatoryCamera } from './camera.js';
import { PRESETS, schwarzschildRadius, timeDilation, createProbe, updateProbe } from './physics.js';
import { createUI } from './ui.js';
import { QualityController } from './quality.js';
import { allowsShortcut, shortcutForCode, shortcutNotice } from './shortcuts.js';

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
let fps = 60;
let flyMilestones = new Set();
let renderedFrames = 0;
const qualityController = new QualityController();
let contextLost = false;
const events = new AbortController();
const eventOptions = { signal: events.signal };

const camera = new ObservatoryCamera(canvas, (mode) => ui?.setMode(mode));

function action(type) {
  switch (type) {
    case 'probe':
      {
        const tilt = settings.tilt * Math.PI / 180;
        const normal = [0, Math.cos(tilt), -Math.sin(tilt)];
        const radial = camera.position.clone().normalize().multiplyScalar(Math.cos(25 * Math.PI / 180));
        radial.addScaledVector(camera.right, Math.sin(25 * Math.PI / 180));
        const clearance = Math.max(0, 0.18 - radial.toArray().reduce((sum, v, i) => sum + v * normal[i], 0));
        const direction = radial.toArray().map((value, i) => value + clearance * normal[i]);
        probe = createProbe({ observerRadius: Math.max(7, camera.radius), direction });
      }
      ui.setNotice('Watch the beacon: one flash per second of its own time.');
      break;
    case 'cinematic':
      camera.setMode(camera.mode === 'cinematic' ? 'orbit' : 'cinematic');
      ui.setNotice(camera.mode === 'cinematic' ? 'CINEMATIC PATH · Press H to hide the HUD for recording' : 'ORBIT CONTROL RESTORED');
      break;
    case 'fly':
      camera.setDisk(settings.tilt, settings.spin);
      camera.setMode(camera.mode === 'fly' ? 'orbit' : 'fly');
      if (camera.mode === 'fly') flyMilestones = new Set();
      ui.setNotice(camera.mode === 'fly' ? 'APPROACHING HORIZON · Drag to look · W/S thrust · A/D steer' : 'APPROACH STOPPED · R to restore the observation point');
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
      simulationTime = 0;
      flyMilestones.clear();
      ui.setNotice('OBSERVATION POINT RESTORED');
      break;
    case 'pause': paused = !paused; break;
    case 'help':
      ui.setNotice(ui.toggleHelp() ? shortcutNotice() : '');
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
    camera.setLensing(settings.lensing);
    camera.setDisk(settings.tilt, settings.spin);
    camera.reset();
    probe = null;
    ui.setPreset(id, settings);
    ui.setNotice(`${settings.name.toUpperCase()} · Observation parameters loaded`);
  },
  onChange(key, value) {
    if (key in settings && Number.isFinite(value)) settings[key] = value;
    if (key === 'lensing') camera.setLensing(settings.lensing);
    if (key === 'tilt' || key === 'spin') camera.setDisk(settings.tilt, settings.spin);
  },
  onQuality(mode) { applyQuality(qualityController.setMode(mode)); },
  onAction: action,
});

function applyQuality(decision) {
  if (decision && scene) scene.setScale(decision.scale);
}

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
  if (!allowsShortcut(event)) return;
  const shortcut = shortcutForCode(event.code);
  if (shortcut && !shortcut.camera && !event.repeat) { event.preventDefault(); action(shortcut.action); }
}, eventOptions);
document.addEventListener('visibilitychange', () => {
  previousTime = null;
  qualityController.resetTiming();
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
  const dilation = timeDilation(camera.radius, settings.lensing);
  if (camera.mode === 'fly') {
    for (const [id, reached, message] of [
      ['disk', camera.radius < 2.95 - 0.35 * settings.spin, 'INSIDE THE DISK’S INNER EDGE · The shadow rises around you'],
      ['sphere', camera.radius <= 1.5 * settings.lensing, 'PHOTON SPHERE · Half the sky is shadow · Looking along the horizon'],
      ['hover', camera.hovering && camera.radius === camera.minimum, camera.minimum < 1.5 * settings.lensing
        ? 'FINAL HOVER · The outside universe closes to a bright disc overhead'
        : 'FINAL HOVER · Looking outward from the minimum observer radius'],
    ]) {
      if (reached && !flyMilestones.has(id)) { flyMilestones.add(id); ui.setNotice(message); }
    }
  }
  simulationTime += simDt;
  clock += simDt * dilation;
  if (probe) updateProbe(probe, paused ? 0 : dt, settings.timeScale);

  const qualityDecision = qualityController.feed(rawDt);
  fps = qualityController.fps;
  applyQuality(qualityDecision);
  try {
    scene.render(camera, settings, simulationTime, probe, dt);
    renderedFrames++;
  } catch (error) {
    console.error(error);
    contextLost = true;
    showFailure('The graphics renderer could not start. Update your browser or graphics driver, then reload.');
    return;
  }
  window.eventHorizonBoot?.ready();
  ui.update({
    fps, quality: scene.quality, qualityMode: qualityController.qualityMode, mass: settings.mass,
    radius: schwarzschildRadius(settings.mass), dilation, clock,
    probe, probeState: probe?.state ?? 'idle',
    cameraDistance: camera.radius, shadowFraction: camera.shadowFraction, paused,
    cinematic: camera.mode === 'cinematic', fly: camera.mode === 'fly',
  });
}

const debug = new URLSearchParams(window.location.search).get('debug') === '1' ? Object.freeze({
  setCamera: values => camera.setCamera(values),
  setLayers(values) {
    const layers = scene.uniforms.uLayers.value;
    for (const [key, component] of [['disk', 'x'], ['sky', 'y'], ['ring', 'z'], ['probe', 'w']]) {
      if (typeof values[key] === 'boolean') layers[component] = Number(values[key]);
    }
  },
  setPaused(value) { if (typeof value === 'boolean') paused = value; },
  advanceProbe(dt) { if (probe) updateProbe(probe, dt, settings.timeScale); },
}) : null;

// Debug mutation exists only behind the explicit flag; normal telemetry is copied.
Object.defineProperty(window, 'eventHorizon', {
  configurable: true,
  value: Object.freeze({ ...(debug ? { debug } : {}), getState: () => ({ settings: { ...settings }, camera: {
    mode: camera.mode, radius: camera.radius, theta: camera.theta, elevation: camera.elevation,
    dilation: timeDilation(camera.radius, settings.lensing), gazeYaw: camera.gazeYaw, gazePitch: camera.gazePitch,
    shadowFraction: camera.shadowFraction,
  }, probe: probe ? { ...probe, direction: [...probe.direction], trail: probe.trail.map(event => ({ ...event })) } : null, paused, clock, fps, renderedFrames,
  exposure: scene?.meter.exposure,
  quality: scene?.quality, renderScale: scene?.scale, qualityMode: qualityController.qualityMode, frameCap: qualityController.frameCap }) }),
});

if (scene) frameId = requestAnimationFrame(animate);
if (import.meta.hot) import.meta.hot.dispose(() => {
  cancelAnimationFrame(frameId);
  events.abort();
  scene?.destroy();
  camera.destroy();
  ui.destroy();
});
