import { Vector3, MathUtils } from 'three';
import { allowsShortcut, shortcutForCode } from './shortcuts.js';
import { GEODESIC, minimumRadius, shadowAngularRadius } from './geodesic.js';

const DEFAULT = { radius: 23, theta: 0.05, elevation: 0.23 };
const ease = t => { const x = MathUtils.clamp(t, 0, 1); return x * x * (3 - 2 * x); };

export function approachGaze(radius, minimum = minimumRadius(1), photonSphere = 1.5) {
  if (radius >= 6) return 0;
  const pivot = Math.max(photonSphere, minimum + 0.15);
  return radius >= pivot ? Math.PI / 2 * ease((6 - radius) / (6 - pivot))
    : Math.PI / 2 * (1 + ease((pivot - radius) / (pivot - minimum)));
}

/** The gaze basis is built by rotations, including at straight-in/out poles. */
export class ObservatoryCamera {
  constructor(canvas, onModeChange = () => {}) {
    this.canvas = canvas;
    this.onModeChange = onModeChange;
    this.position = new Vector3();
    this.forward = new Vector3();
    this.right = new Vector3();
    this.up = new Vector3();
    this.mode = 'orbit';
    this.radius = this.desiredRadius = DEFAULT.radius;
    this.theta = this.desiredTheta = DEFAULT.theta;
    this.elevation = this.desiredElevation = DEFAULT.elevation;
    this.gazeYaw = this.gazePitch = this.freeYaw = this.freePitch = 0;
    this.automaticGaze = 0;
    this.flyGazeStart = this.flyGazeTime = 0;
    this.diskTilt = 8 * Math.PI / 180;
    this.diskInner = 2.95 - 0.35 * 0.85;
    this.diskGaze = false;
    this.lensing = 1;
    this.minimum = minimumRadius(1);
    this.cinematicTime = this.flyElapsed = 0;
    this.flyStartRadius = this.radius;
    this.hovering = false;
    this.keys = new Set();
    this.pointers = new Map();
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    canvas.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      if (this.mode === 'cinematic') this.setMode('orbit');
      canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }, options);
    canvas.addEventListener('pointermove', event => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;
      const before = this.pinchDistance();
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size >= 2) {
        const after = this.pinchDistance();
        if (before > 0 && after > 0) this.zoom(before / after);
        return;
      }
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      if (this.mode === 'fly' || this.automaticGaze !== 0 || this.freePitch !== 0 || this.freeYaw !== 0) {
        this.freeYaw -= dx * 0.004;
        this.freePitch += dy * 0.003;
      } else {
        this.desiredTheta -= dx * 0.004;
        this.desiredElevation = MathUtils.clamp(this.desiredElevation + dy * 0.003, -1.35, 1.35);
      }
    }, options);
    const release = event => this.pointers.delete(event.pointerId);
    canvas.addEventListener('pointerup', release, options);
    canvas.addEventListener('pointercancel', release, options);
    canvas.addEventListener('lostpointercapture', release, options);
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      this.zoom(Math.exp(event.deltaY * 0.001));
    }, { ...options, passive: false });
    window.addEventListener('keydown', event => {
      if (!allowsShortcut(event) || !shortcutForCode(event.code)?.camera) return;
      event.preventDefault();
      this.keys.add(event.code);
    }, options);
    window.addEventListener('keyup', event => this.keys.delete(event.code), options);
    window.addEventListener('blur', () => { this.keys.clear(); this.pointers.clear(); }, options);
    this.update(0);
  }

  pinchDistance() {
    const [a, b] = this.pointers.values();
    return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  zoom(factor) {
    this.setMode('orbit');
    this.desiredRadius = MathUtils.clamp(this.desiredRadius * factor, this.minimum, GEODESIC.maximumRadius);
  }

  setLensing(L) {
    this.lensing = L;
    this.minimum = minimumRadius(L);
    this.radius = Math.max(this.minimum, this.radius);
    this.desiredRadius = Math.max(this.minimum, this.desiredRadius);
  }

  setDisk(tilt, spin) {
    this.diskTilt = tilt * Math.PI / 180;
    this.diskInner = 2.95 - 0.35 * spin;
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.desiredRadius = this.radius;
    this.desiredTheta = this.theta;
    this.desiredElevation = this.elevation;
    this.mode = mode;
    if (mode === 'cinematic') {
      this.cinematicTime = 0;
      this.automaticGaze = this.freeYaw = this.freePitch = 0;
      this.diskGaze = false;
    }
    if (mode === 'fly') {
      this.flyElapsed = 0;
      this.flyGazeTime = 0;
      this.flyGazeStart = this.automaticGaze;
      this.flyStartRadius = this.radius;
      const normal = new Vector3(0, Math.cos(this.diskTilt), -Math.sin(this.diskTilt));
      const along = new Vector3(0, Math.sin(this.diskTilt), Math.cos(this.diskTilt));
      const radial = this.position.clone().normalize();
      this.flyLatitude = this.flyStartLatitude = Math.asin(MathUtils.clamp(radial.dot(normal), -1, 1));
      this.flySide = this.flyLatitude < 0 ? -1 : 1;
      this.flyAzimuth = Math.atan2(radial.x, radial.dot(along));
      this.diskGaze = true;
      this.hovering = false;
    }
    this.onModeChange(mode);
  }

  reset() {
    this.setMode('orbit');
    Object.assign(this, { automaticGaze: 0, freeYaw: 0, freePitch: 0, hovering: false, diskGaze: false });
    this.keys.clear();
    this.pointers.clear();
    this.setCamera({ ...DEFAULT, yaw: 0, pitch: 0 });
  }

  alignStar() {
    this.setMode('orbit');
    this.setCamera({ radius: 23, theta: 0, elevation: Math.atan2(5.8, 21), yaw: 0, pitch: 0 });
  }

  setCamera({ radius = this.radius, theta = this.theta, elevation = this.elevation, yaw = this.gazeYaw, pitch = this.gazePitch }) {
    if (![radius, theta, elevation, yaw, pitch].every(Number.isFinite)) throw new RangeError('Camera values must be finite.');
    this.setMode('orbit');
    this.radius = this.desiredRadius = MathUtils.clamp(radius, this.minimum, GEODESIC.maximumRadius);
    this.theta = this.desiredTheta = theta;
    this.elevation = this.desiredElevation = MathUtils.clamp(elevation, -1.35, 1.35);
    this.automaticGaze = 0;
    this.diskGaze = false;
    this.freeYaw = yaw;
    this.freePitch = pitch;
    this.update(0);
  }

  update(dt) {
    const smooth = 1 - Math.exp(-dt * 4.5);
    if (this.mode === 'cinematic') {
      this.cinematicTime += dt;
      const t = this.cinematicTime;
      this.desiredTheta = DEFAULT.theta + t * 0.035;
      this.desiredElevation = 0.23 + Math.sin(t * 0.085) * 0.19;
      this.desiredRadius = 21 + Math.cos(t * 0.07) * 2;
    } else if (this.mode === 'fly') {
      this.flyElapsed += dt;
      // A finite endpoint makes the final hover reachable without a radius snap.
      const progress = MathUtils.clamp(this.flyElapsed / 60, 0, 1);
      const remaining = (Math.exp(-0.12 * this.flyElapsed) - Math.exp(-7.2)) / (1 - Math.exp(-7.2));
      this.desiredRadius = this.minimum + (this.flyStartRadius - this.minimum) * Math.max(0, remaining);
      this.hovering = progress >= 1;
    }
    if (this.keys.has('KeyW')) this.desiredRadius *= Math.exp(-dt * 0.5);
    if (this.keys.has('KeyS')) this.desiredRadius *= Math.exp(dt * 0.5);
    const turn = Number(this.keys.has('KeyA')) - Number(this.keys.has('KeyD'));
    if (this.mode === 'fly') this.flyAzimuth += turn * dt * 0.4;
    else this.desiredTheta += turn * dt * 0.4;
    this.desiredRadius = MathUtils.clamp(this.desiredRadius, this.minimum, GEODESIC.maximumRadius);
    if (this.mode === 'fly' && (this.keys.has('KeyW') || this.keys.has('KeyS'))) {
      this.flyStartRadius = this.desiredRadius;
      this.flyElapsed = 0;
      this.hovering = false;
    }
    // Equal endpoints must stay bitwise fixed regardless of the frame interval.
    if (this.radius !== this.desiredRadius) this.radius = MathUtils.lerp(this.radius, this.desiredRadius, smooth);
    if (this.hovering && Math.abs(this.radius - this.minimum) < 0.00001) this.radius = this.desiredRadius = this.minimum;
    if (this.mode === 'fly') {
      // The extra degree lets an initially low path ease above the clearance before reaching the disk.
      const clearance = 21 * Math.PI / 180;
      const outerLatitude = MathUtils.lerp(this.flyStartLatitude, this.flySide * clearance, ease((this.flyGazeTime + dt) / 3));
      const inside = ease((this.diskInner - this.radius) / Math.max(0.1, this.diskInner - 1.5));
      const targetLatitude = MathUtils.lerp(outerLatitude, this.flySide * 8 * Math.PI / 180, inside);
      this.flyLatitude = MathUtils.lerp(this.flyLatitude, targetLatitude, smooth);
      const along = Math.cos(this.flyLatitude) * Math.cos(this.flyAzimuth);
      const height = Math.sin(this.flyLatitude);
      const x = Math.cos(this.flyLatitude) * Math.sin(this.flyAzimuth);
      const y = along * Math.sin(this.diskTilt) + height * Math.cos(this.diskTilt);
      const z = along * Math.cos(this.diskTilt) - height * Math.sin(this.diskTilt);
      const theta = Math.atan2(x, z);
      this.theta += Math.atan2(Math.sin(theta - this.theta), Math.cos(theta - this.theta));
      this.elevation = Math.asin(MathUtils.clamp(y, -1, 1));
      this.desiredTheta = this.theta;
      this.desiredElevation = this.elevation;
      this.flyGazeTime += dt;
      this.automaticGaze = MathUtils.lerp(this.flyGazeStart, this.flySide * approachGaze(this.radius, this.minimum, 1.5 * this.lensing), ease(this.flyGazeTime / 1.5));
    } else {
      if (this.theta !== this.desiredTheta) this.theta = MathUtils.lerp(this.theta, this.desiredTheta, smooth);
      if (this.elevation !== this.desiredElevation) this.elevation = MathUtils.lerp(this.elevation, this.desiredElevation, smooth);
    }
    this.gazeYaw = this.freeYaw;
    this.gazePitch = this.automaticGaze + this.freePitch;
    const radial = new Vector3(Math.sin(this.theta) * Math.cos(this.elevation), Math.sin(this.elevation), Math.cos(this.theta) * Math.cos(this.elevation));
    const baseRight = new Vector3(Math.cos(this.theta), 0, -Math.sin(this.theta));
    const baseUp = new Vector3().crossVectors(baseRight, radial.clone().negate());
    if (this.diskGaze) {
      const diskUp = new Vector3(0, Math.cos(this.diskTilt), -Math.sin(this.diskTilt));
      diskUp.addScaledVector(radial, -diskUp.dot(radial)).normalize();
      const roll = Math.atan2(diskUp.dot(baseRight), diskUp.dot(baseUp)) * ease(this.flyGazeTime / 1.5);
      const rolledUp = baseUp.clone().multiplyScalar(Math.cos(roll)).addScaledVector(baseRight, Math.sin(roll));
      baseRight.multiplyScalar(Math.cos(roll)).addScaledVector(baseUp, -Math.sin(roll));
      baseUp.copy(rolledUp);
    }
    const pitched = radial.clone().multiplyScalar(-Math.cos(this.gazePitch)).addScaledVector(baseUp, Math.sin(this.gazePitch));
    this.up.copy(baseUp).multiplyScalar(Math.cos(this.gazePitch)).addScaledVector(radial, Math.sin(this.gazePitch));
    this.forward.copy(pitched).multiplyScalar(Math.cos(this.gazeYaw)).addScaledVector(baseRight, Math.sin(this.gazeYaw));
    this.right.copy(baseRight).multiplyScalar(Math.cos(this.gazeYaw)).addScaledVector(pitched, -Math.sin(this.gazeYaw));
    this.position.copy(radial).multiplyScalar(this.radius);
    this.shadowFraction = (1 - Math.cos(shadowAngularRadius(this.radius, this.lensing))) / 2;
  }

  destroy() { this.abort.abort(); }
}
