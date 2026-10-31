import { Vector3, MathUtils } from 'three';

const DEFAULT = { radius: 23, theta: 0.05, elevation: 0.23 };

/** Camera distances are expressed in Schwarzschild radii. */
export class ObservatoryCamera {
  constructor(canvas, onModeChange = () => {}) {
    this.canvas = canvas;
    this.onModeChange = onModeChange;
    this.position = new Vector3();
    this.target = new Vector3();
    this.mode = 'orbit';
    this.radius = this.desiredRadius = DEFAULT.radius;
    this.theta = this.desiredTheta = DEFAULT.theta;
    this.elevation = this.desiredElevation = DEFAULT.elevation;
    this.cinematicTime = 0;
    this.flyAmount = 0;
    this.keys = new Set();
    this.drag = null;
    this.abort = new AbortController();
    const options = { signal: this.abort.signal };
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.setMode('orbit');
      canvas.setPointerCapture(event.pointerId);
      this.drag = { x: event.clientX, y: event.clientY };
    }, options);
    canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      this.desiredTheta -= (event.clientX - this.drag.x) * 0.004;
      this.desiredElevation = MathUtils.clamp(this.desiredElevation + (event.clientY - this.drag.y) * 0.003, -1.35, 1.35);
      this.drag = { x: event.clientX, y: event.clientY };
    }, options);
    const release = () => { this.drag = null; };
    canvas.addEventListener('pointerup', release, options);
    canvas.addEventListener('pointercancel', release, options);
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.setMode('orbit');
      this.desiredRadius = MathUtils.clamp(this.desiredRadius * Math.exp(event.deltaY * 0.001), 1.055, 65);
    }, { ...options, passive: false });
    window.addEventListener('keydown', (event) => {
      if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      this.keys.add(event.code);
    }, options);
    window.addEventListener('keyup', (event) => this.keys.delete(event.code), options);
    window.addEventListener('blur', () => this.keys.clear(), options);
    this.update(0);
  }

  setMode(mode) {
    if (this.mode === mode) return;
    if (this.mode === 'cinematic') {
      this.desiredRadius = this.radius;
      this.desiredTheta = this.theta;
      this.desiredElevation = this.elevation;
    }
    this.mode = mode;
    if (mode === 'cinematic') this.cinematicTime = 0;
    this.onModeChange(mode);
  }

  reset() {
    this.setMode('orbit');
    this.desiredRadius = DEFAULT.radius;
    this.desiredTheta = DEFAULT.theta;
    this.desiredElevation = DEFAULT.elevation;
  }

  alignStar() {
    this.setMode('orbit');
    this.theta = this.desiredTheta = 0;
    this.elevation = this.desiredElevation = Math.atan2(5.8, 21);
    this.radius = this.desiredRadius = 23;
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
      this.desiredRadius = 1.055 + (this.desiredRadius - 1.055) * Math.exp(-dt * 0.12);
      this.desiredElevation *= Math.exp(-dt * 0.07);
    }
    if (this.keys.has('KeyW')) this.desiredRadius *= Math.exp(-dt * 0.5);
    if (this.keys.has('KeyS')) this.desiredRadius *= Math.exp(dt * 0.5);
    if (this.keys.has('KeyA')) this.desiredTheta += dt * 0.4;
    if (this.keys.has('KeyD')) this.desiredTheta -= dt * 0.4;
    this.desiredRadius = MathUtils.clamp(this.desiredRadius, 1.055, 65);
    this.radius = MathUtils.lerp(this.radius, this.desiredRadius, smooth);
    this.theta = MathUtils.lerp(this.theta, this.desiredTheta, smooth);
    this.elevation = MathUtils.lerp(this.elevation, this.desiredElevation, smooth);
    this.position.set(
      this.radius * Math.sin(this.theta) * Math.cos(this.elevation),
      this.radius * Math.sin(this.elevation),
      this.radius * Math.cos(this.theta) * Math.cos(this.elevation),
    );
    const flyTarget = this.mode === 'fly' ? MathUtils.clamp((23 - this.radius) / 23, 0, 1) : 0;
    this.flyAmount = MathUtils.lerp(this.flyAmount, flyTarget, smooth);
  }

  destroy() { this.abort.abort(); }
}
