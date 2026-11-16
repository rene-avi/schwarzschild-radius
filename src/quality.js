export const QUALITY_MODES = Object.freeze({ auto: 1, high: 1, balanced: 0.76, performance: 0.52 });

export function qualityForScale(scale) {
  const qualityIndex = scale < 0.6 ? 0 : scale < 0.9 ? 1 : 2;
  return { qualityIndex, mode: ['PERFORMANCE', 'BALANCED', 'HIGH'][qualityIndex] };
}

export class QualityController {
  constructor() {
    this.scale = 1;
    this.fps = 60;
    this.frameCap = null;
    this.qualityMode = 'auto';
    this.recoveryDelay = 12;
    this.resetTiming();
  }

  resetTiming() {
    this.fpsElapsed = this.fpsFrames = this.slowSeconds = this.fastSeconds = 0;
    this.probe = null;
    this.recovering = false;
  }

  getState() {
    return { scale: this.scale, fps: this.fps, frameCap: this.frameCap, qualityMode: this.qualityMode,
      ...qualityForScale(this.scale) };
  }

  setMode(mode) {
    if (!Object.hasOwn(QUALITY_MODES, mode)) throw new RangeError('Unknown quality mode');
    this.qualityMode = mode;
    this.frameCap = null;
    this.recoveryDelay = 12;
    this.resetTiming();
    return this.setScale(QUALITY_MODES[mode]);
  }

  setScale(scale) {
    const previous = this.scale;
    this.scale = Math.max(0.4, Math.min(1, Math.round(scale * 100) / 100));
    this.slowSeconds = this.fastSeconds = 0;
    return previous === this.scale ? null : this.getState();
  }

  feed(rawDt) {
    // Suspension is not evidence of GPU load; discard partial measurements too.
    if (!Number.isFinite(rawDt) || rawDt <= 0 || rawDt > 1) {
      this.resetTiming();
      return null;
    }
    this.fpsElapsed += rawDt;
    this.fpsFrames += 1;
    if (this.fpsElapsed < 0.75) return null;
    const elapsed = this.fpsElapsed;
    this.fps = this.fpsFrames / elapsed;
    this.fpsElapsed = this.fpsFrames = 0;
    if (this.qualityMode !== 'auto') return null;

    if (this.frameCap !== null && this.fps > this.frameCap * 1.2) {
      this.frameCap = null;
      this.recoveryDelay = 12;
      this.fastSeconds = this.slowSeconds = 0;
    }

    if (this.probe) {
      this.probe.elapsed += elapsed;
      this.probe.frames += this.fps * elapsed;
      if (this.probe.elapsed < 2.25) return null;
      const { before, scale, steps, frames, elapsed: measured } = this.probe;
      this.probe = null;
      if (frames / measured < before * 1.12) {
        // Vsync can hide one gain; require a second reduction before inferring a cap.
        if (steps === 1 && this.scale > 0.4) {
          this.probe = { before, scale, steps: 2, frames: 0, elapsed: 0 };
          return this.setScale(this.scale - 0.12);
        }
        this.frameCap = frames / measured;
        return this.setScale(scale);
      }
      this.slowSeconds = this.fastSeconds = 0;
    }

    const slowThreshold = this.frameCap === null ? 50 : this.frameCap * 0.85;
    const fastThreshold = this.frameCap === null ? 58 : this.frameCap * 0.97;
    this.slowSeconds = this.fps < slowThreshold ? this.slowSeconds + elapsed : 0;
    this.fastSeconds = this.fps >= fastThreshold ? this.fastSeconds + elapsed : 0;
    // Require more than a one-second hitch, even across measurement boundaries.
    if (this.slowSeconds >= 3 && this.scale > 0.4) {
      if (this.recovering) {
        // A failed upward trial backs off before trying the same GPU limit again.
        this.recoveryDelay = 60;
        this.recovering = false;
      }
      this.probe = { before: this.fps, scale: this.scale, steps: 1, frames: 0, elapsed: 0 };
      return this.setScale(this.scale - 0.12);
    }
    if (this.fastSeconds >= this.recoveryDelay && this.scale < 1) {
      this.recovering = true;
      return this.setScale(this.scale + 0.12);
    }
    return null;
  }
}
