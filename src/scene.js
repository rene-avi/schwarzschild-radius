import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { vertexShader, fragmentShader } from './shaders/blackhole.js';
import { filmShader, meterShader, exposureTarget, smoothExposure } from './shaders/post.js';
import { qualityForScale } from './quality.js';

class ExposurePass extends Pass {
  constructor(film) {
    super();
    this.needsSwap = false;
    this.film = film;
    this.exposure = 1;
    this.target = 1;
    this.elapsed = 1;
    this.pending = false;
    this.disposed = false;
    this.error = null;
    this.material = new THREE.ShaderMaterial({ ...meterShader,
      uniforms: THREE.UniformsUtils.clone(meterShader.uniforms), depthTest: false, depthWrite: false });
    this.quad = new FullScreenQuad(this.material);
    this.targets = [64, 16, 4, 1].map(size => new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false,
    }));
    this.pixel = new Uint8Array(4);
  }

  render(renderer, writeBuffer, readBuffer, dt) {
    if (this.error) throw this.error;
    this.exposure = smoothExposure(this.exposure, this.target, dt);
    this.film.uniforms.uExposure.value = this.exposure;
    this.elapsed += dt;
    if (this.elapsed < 0.15 || this.pending) return;
    this.elapsed = 0;
    const previous = renderer.getRenderTarget();
    let texture = readBuffer.texture;
    for (let i = 0; i < this.targets.length; i++) {
      const target = this.targets[i];
      this.material.uniforms.tDiffuse.value = texture;
      this.material.uniforms.uSize.value = target.width;
      this.material.uniforms.uRaw.value = i === 0;
      renderer.setRenderTarget(target);
      this.quad.render(renderer);
      texture = target.texture;
    }
    this.pending = true;
    // Only four bytes cross the GPU boundary; a fence avoids a synchronous stall.
    renderer.readRenderTargetPixelsAsync(this.targets.at(-1), 0, 0, 1, 1, this.pixel).then(() => {
      if (this.disposed) return;
      const mean = 2 ** (this.pixel[0] / 255 * 8) - 1;
      const peak = 2 ** (this.pixel[1] / 255 * 8) - 1;
      const target = exposureTarget(peak, mean);
      if (Math.abs(Math.log(target / this.target)) > 0.03) this.target = target;
    }).catch(error => { if (!this.disposed) this.error = error; }).finally(() => { this.pending = false; });
    renderer.setRenderTarget(previous);
  }

  dispose() {
    this.disposed = true;
    this.targets.forEach(target => target.dispose());
    this.material.dispose();
    this.quad.dispose();
  }
}

export class BlackHoleScene {
  constructor(canvas, settings) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.debug.checkShaderErrors = true;
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      console.error('Shader compilation failed:', gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment));
      throw new Error('The graphics driver could not compile the simulation shader.');
    };
    this.renderer.setClearColor(0x050608);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.uniforms = {
      uResolution: { value: new THREE.Vector2() },
      uPixelRatio: { value: 1 },
      uTime: { value: 0 },
      uCameraPosition: { value: new THREE.Vector3() },
      uCameraForward: { value: new THREE.Vector3() },
      uCameraRight: { value: new THREE.Vector3() },
      uCameraUp: { value: new THREE.Vector3() },
      uLayers: { value: new THREE.Vector4(1, 1, 1, 1) },
      uScreenOffset: { value: new THREE.Vector2() },
      uTemperature: { value: settings.temperature },
      uSpin: { value: settings.spin },
      uTilt: { value: settings.tilt },
      uLensing: { value: settings.lensing },
      uQuality: { value: qualityForScale(1).qualityIndex },
      uProbePosition: { value: new THREE.Vector3(0, 0, 0) },
      uProbeRadius: { value: -1 },
      uProbeSignal: { value: 1 },
      uProbePulse: { value: 0 },
      uProbeExtent: { value: 1.5 },
      uProbeTrail: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uProbeTrailAge: { value: Array(8).fill(0) },
      uProbeTrailCount: { value: 0 },
      uDiskIntensity: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms, depthTest: false, depthWrite: false });
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.scene.add(new THREE.Mesh(this.geometry, this.material));
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.film = new ShaderPass(filmShader);
    this.meter = new ExposurePass(this.film);
    this.composer.addPass(this.meter);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.28, 1.3);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.film);
    this.scale = 1;
    this.resize();
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    // Bound fill rate independently of high-DPI desktop display size.
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1300000 / (width * height))) * this.scale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
    this.uniforms.uResolution.value.set(Math.round(width * ratio), Math.round(height * ratio));
    this.uniforms.uPixelRatio.value = ratio;
    this.uniforms.uScreenOffset.value.set(width > 1000 ? 0.065 : 0, 0);
  }

  setScale(scale) {
    // The controller owns scale bounds, rounding and quality thresholds.
    const oldScale = this.scale;
    this.scale = scale;
    this.uniforms.uQuality.value = qualityForScale(scale).qualityIndex;
    if (oldScale !== this.scale) this.resize();
    return oldScale !== this.scale;
  }

  get quality() { return `${qualityForScale(this.scale).mode} · ${Math.round(this.scale * 100)}%`; }

  render(camera, settings, simulationTime, probe, dt) {
    const u = this.uniforms;
    u.uTime.value = simulationTime;
    u.uCameraPosition.value.copy(camera.position);
    u.uCameraForward.value.copy(camera.forward);
    u.uCameraRight.value.copy(camera.right);
    u.uCameraUp.value.copy(camera.up);
    u.uTemperature.value = settings.temperature;
    u.uSpin.value = settings.spin;
    u.uTilt.value = settings.tilt;
    u.uLensing.value = settings.lensing;
    u.uDiskIntensity.value = 0.55 + settings.temperature / 12000;
    if (probe && probe.state !== 'lost') {
      u.uProbePosition.value.fromArray(probe.direction).multiplyScalar(probe.radius);
      u.uProbeRadius.value = probe.radius;
      u.uProbeSignal.value = probe.signal;
      u.uProbePulse.value = probe.pulse;
      u.uProbeExtent.value = 1.5 + Math.max(0, ...probe.trail.map(event => event.radius - probe.radius));
      u.uProbeTrailCount.value = probe.trail.length;
      probe.trail.forEach((event, i) => {
        u.uProbeTrail.value[i].set(...probe.direction.map(value => value * event.radius), event.signal);
        u.uProbeTrailAge.value[i] = event.age;
      });
    } else {
      u.uProbeRadius.value = -1;
      u.uProbeTrailCount.value = 0;
    }
    this.film.uniforms.uTime.value = simulationTime;
    this.composer.render(dt);
  }

  destroy() {
    this.geometry.dispose();
    this.material.dispose();
    this.bloom.dispose();
    this.meter.dispose();
    this.film.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
