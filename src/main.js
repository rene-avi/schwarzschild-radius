import './style.css';
import { BlackHoleScene } from './scene.js';
import { ObservatoryCamera } from './camera.js';
import { PRESETS, schwarzschildRadius, timeDilation, createProbe, updateProbe } from './physics.js';
import { createUI } from './ui.js';
import { QualityController } from './quality.js';
import { allowsShortcut, shortcutForCode, shortcutNotice } from './shortcuts.js';
import { spinFromDelta } from './kerr.js';
import { KERR_RAY, zamoClockRate, pictureSpin } from './kerrray.js';
import { worldEvent, worldImage, photonOrbit } from './kerrworlds.js';
import { probeDropRefusal, unpackKerrProbe, updateKerrProbe } from './kerrprobe.js';
import KerrProbeWorker from './kerrprobe-worker.js?worker&inline';
import { reset as resetLedger, advance as advanceLedger, travel as travelLedger } from './ledger.js';
import { crewStep } from './mission.js';
import { START_PHASES, advancePhases, drawnWorlds, retardedPosition } from './worldview.js';

const canvas = document.querySelector('#universe');
const metric = new URLSearchParams(window.location.search).get('metric') === 'kerr' ? 'kerr' : 'schwarzschild';
const settings = { ...PRESETS.gargantua };
function refreshVisualSpin() {
  settings.spin = Math.min(0.99, spinFromDelta(settings.spinDelta));
}
refreshVisualSpin();
let ledger = resetLedger();
let missionRunning = false;
let paused = false;
let probe = null;
let probeWorker = null;
function cancelProbeDrop() {
  probeWorker?.terminate();
  probeWorker = null;
}
let simulationTime = 0;
let worldPhases = { ...START_PHASES };
let worldsLayer = true;
let pictureWorlds = [];
let clock = 0;
let scene;
let ui;
let frameId;
let previousTime = null;
let fps = 60;
let flyMilestones = new Set();
let renderedFrames = 0;
const qualityController = new QualityController();
let qualityPinned = false;
let contextLost = false;
const events = new AbortController();
const eventOptions = { signal: events.signal };

const camera = new ObservatoryCamera(canvas, (mode) => ui?.setMode(mode));
function setPictureLensing() {
  camera.setLensing(metric === 'kerr' ? 1 : settings.lensing);
  if (metric === 'kerr') camera.minimum = KERR_RAY.minimumCamera;
}
setPictureLensing();

function referenceDilation() {
  return metric === 'kerr' ? zamoClockRate(camera.position.toArray(), settings.spinDelta)
    : timeDilation(camera.radius, settings.lensing);
}

const kerrWorldImages = new Map();
function pictureWorldState({ id, drawn, center, radius, phase, radiusM }) {
  if (metric !== 'kerr') return { id, drawn, center: [...center], radius };
  const spin = pictureSpin(settings.spinDelta), position = camera.position.toArray();
  const key = JSON.stringify([phase, position, spin]);
  let cached = kerrWorldImages.get(id);
  if (drawn && cached?.key !== key) {
    let image;
    try { image = worldImage({ radius: radiusM / 2, phase, position, spin }); } catch { /* Occulted direct images have no centre. */ }
    cached = { key, image }; kerrWorldImages.set(id, cached);
  }
  const image = cached?.key === key ? cached.image : undefined;
  return { id, drawn, radius, phase, orbitRadius: radiusM / 2, center: image ? [image.x[1], image.x[2], image.x[0]] : null,
    direction: image ? [...image.sceneDirection] : undefined, delay: image?.delay };
}

function action(type) {
  if (metric === 'kerr' && ['fly', 'cinematic'].includes(type)) return;
  switch (type) {
    case 'probe':
      try {
        cancelProbeDrop();
        const tilt = metric === 'kerr' ? 0 : settings.tilt * Math.PI / 180;
        const normal = [0, Math.cos(tilt), -Math.sin(tilt)];
        const radial = camera.position.clone().normalize().multiplyScalar(Math.cos(25 * Math.PI / 180));
        radial.addScaledVector(camera.right, Math.sin(25 * Math.PI / 180));
        const clearance = Math.max(0, 0.18 - radial.toArray().reduce((sum, v, i) => sum + v * normal[i], 0));
        const direction = radial.toArray().map((value, i) => value + clearance * normal[i]);
        if (metric === 'kerr') {
          const drop = { position: camera.position.toArray(), direction, spin: pictureSpin(settings.spinDelta) };
          const refusal = probeDropRefusal(drop.position, drop.spin);
          if (refusal) { ui.setNotice(refusal); break; }
          const worker = new KerrProbeWorker();
          probeWorker = worker;
          ui.setNotice('Computing the Kerr probe reception timeline…');
          worker.onmessage = ({ data }) => {
            if (probeWorker !== worker) return;
            try {
              if (data.notice) ui.setNotice(data.notice);
              else {
                probe = unpackKerrProbe(data.packet);
                ui.setNotice('Watch the beacon: one flash per second of its own time.');
              }
            } catch (error) { ui.setNotice(`Probe not released: ${error.message}`); }
            cancelProbeDrop();
          };
          worker.onerror = event => {
            event.preventDefault();
            if (probeWorker !== worker) return;
            ui.setNotice(`Probe not released: ${event.message || 'the reception calculation failed.'}`);
            cancelProbeDrop();
          };
          worker.postMessage(drop);
          break;
        }
        probe = createProbe({ observerRadius: Math.max(7, camera.radius), direction });
        ui.setNotice('Watch the beacon: one flash per second of its own time.');
      } catch (error) {
        cancelProbeDrop();
        ui.setNotice(`Probe not released: ${error.message}`);
      }
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
      cancelProbeDrop();
      camera.reset();
      probe = null;
      clock = 0;
      simulationTime = 0;
      worldPhases = { ...START_PHASES };
      flyMilestones.clear();
      ui.setNotice('OBSERVATION POINT RESTORED');
      break;
    case 'pause': paused = !paused; break;
    case 'mission': ui.toggleMission(); break;
    case 'mission-start': missionRunning = !missionRunning; break;
    case 'mission-reset':
      ledger = resetLedger();
      missionRunning = false;
      break;
    case 'help':
      ui.setNotice(ui.toggleHelp() ? shortcutNotice() : '');
      break;
    case 'hud': document.body.classList.toggle('hud-hidden'); break;
  }
}

ui = createUI({
  metric,
  presets: PRESETS,
  initialPreset: 'gargantua',
  onPreset(id) {
    if (!PRESETS[id]) return;
    cancelProbeDrop();
    Object.assign(settings, PRESETS[id]);
    refreshVisualSpin();
    setPictureLensing();
    camera.setDisk(settings.tilt, settings.spin);
    camera.reset();
    probe = null;
    ui.setPreset(id, settings);
    ui.setNotice(`${settings.name.toUpperCase()} · Observation parameters loaded`);
  },
  onChange(key, value) {
    if (key in settings && Number.isFinite(value)) settings[key] = value;
    if (key === 'spinDelta') { refreshVisualSpin(); if (metric === 'kerr') { cancelProbeDrop(); probe = null; } }
    if (key === 'lensing') setPictureLensing();
    if (key === 'tilt' || key === 'spinDelta') camera.setDisk(settings.tilt, settings.spin);
  },
  onQuality(mode) { applyQuality(qualityController.setMode(mode)); },
  onTravel(location) { ledger = travelLedger(ledger, location); },
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
  scene = new BlackHoleScene(canvas, settings, metric);
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
  const dilation = referenceDilation();
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
  worldPhases = advancePhases(worldPhases, simDt, metric === 'kerr' ? Math.max(settings.spinDelta, 0.002) : settings.spinDelta);
  pictureWorlds = drawnWorlds(settings.spinDelta, settings.lensing).map(body => ({ ...body,
    phase: worldPhases[body.id],
    drawn: (metric === 'kerr' ? body.radiusM / 2 >= 1.2 * photonOrbit(pictureSpin(settings.spinDelta)) : body.drawn) && ui.missionOpen && worldsLayer,
    center: metric === 'kerr' ? worldEvent(body.radiusM / 2, worldPhases[body.id], 0, pictureSpin(settings.spinDelta)).x.map((_, i, x) => x[(i + 1) % 3])
      : retardedPosition(body, worldPhases[body.id], camera.position.toArray(), settings.tilt).center,
  }));
  scene?.setWorlds(pictureWorlds);
  clock += simDt * dilation;
  const crewSeconds = crewStep(dt, settings.timeScale, missionRunning, paused);
  if (crewSeconds > 0) ledger = advanceLedger(ledger, crewSeconds, settings.spinDelta);
  if (probe) (metric === 'kerr' ? updateKerrProbe : updateProbe)(probe, paused ? 0 : dt, settings.timeScale);

  const qualityDecision = qualityPinned ? null : qualityController.feed(rawDt);
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
    ledger, spinDelta: settings.spinDelta, missionRunning,
  });
}

const debug = new URLSearchParams(window.location.search).get('debug') === '1' ? Object.freeze({
  setQualityPinned(value) { if (typeof value === 'boolean') qualityPinned = value; },
  setCamera: values => camera.setCamera(values),
  setLayers(values) {
    if (typeof values.worlds === 'boolean') worldsLayer = values.worlds;
    const layers = scene.uniforms.uLayers.value;
    for (const [key, component] of [['disk', 'x'], ['sky', 'y'], ['ring', 'z'], ['probe', 'w']]) {
      if (typeof values[key] === 'boolean') layers[component] = Number(values[key]);
    }
  },
  setPaused(value) { if (typeof value === 'boolean') paused = value; },
  setWorldPhases(values) {
    for (const id of ['lantern', 'farShore']) if (Number.isFinite(values[id])) worldPhases[id] = values[id];
  },
  setSimulationTime(seconds) { if (Number.isFinite(seconds)) simulationTime = seconds; },
  advanceProbe(dt) { if (probe) (metric === 'kerr' ? updateKerrProbe : updateProbe)(probe, dt, settings.timeScale); },
  advanceCrew(seconds) { ledger = advanceLedger(ledger, seconds, settings.spinDelta); },
  travel(location) { ledger = travelLedger(ledger, location); },
}) : null;

// Debug mutation exists only behind the explicit flag; normal telemetry is copied.
Object.defineProperty(window, 'eventHorizon', {
  configurable: true,
  value: Object.freeze({ ...(debug ? { debug } : {}), getState: () => ({ metric, settings: { ...settings }, camera: {
    mode: camera.mode, radius: camera.radius, theta: camera.theta, elevation: camera.elevation,
    dilation: referenceDilation(), gazeYaw: camera.gazeYaw, gazePitch: camera.gazePitch,
    shadowFraction: camera.shadowFraction,
  }, ledger: {
    location: ledger.location, homeSeconds: ledger.homeSeconds, crewSeconds: ledger.crewSeconds,
    bodySeconds: { ...ledger.bodySeconds },
  }, mission: { open: ui.missionOpen, running: missionRunning },
  worlds: pictureWorlds.map(pictureWorldState),
  probe: probe ? { ...probe, direction: [...probe.direction], trail: probe.trail.map(event => ({ ...event })),
    ...(metric === 'kerr' ? { position: [...probe.position], flashEvents: probe.flashEvents.map(event => ({ ...event })) } : {}) } : null, paused, clock, simulationTime, fps, renderedFrames,
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
