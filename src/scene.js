import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { vertexShader, fragmentShader } from './shaders/blackhole.js';
import { filmShader } from './shaders/post.js';
import { qualityForScale } from './quality.js';

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
      uProbeDilation: { value: 1 },
      uDiskIntensity: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms, depthTest: false, depthWrite: false });
    this.geometry = new THREE.PlaneGeometry(2, 2);
    this.scene.add(new THREE.Mesh(this.geometry, this.material));
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.45, 1.3);
    this.composer.addPass(this.bloom);
    this.film = new ShaderPass(filmShader);
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

  render(camera, settings, simulationTime, probe) {
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
    if (probe) {
      // A bounded near-side descent stays observable as coordinate time freezes.
      const angle = 0.8 + 0.45 * (1 - Math.exp(-probe.angle));
      const tilt = THREE.MathUtils.degToRad(settings.tilt);
      u.uProbePosition.value.set(Math.cos(angle), Math.sin(tilt) * Math.sin(angle) + 0.12, Math.sin(angle) * Math.cos(tilt)).normalize().multiplyScalar(probe.radius);
      u.uProbeRadius.value = probe.radius;
      u.uProbeDilation.value = probe.dilation;
    } else u.uProbeRadius.value = -1;
    this.film.uniforms.uTime.value = simulationTime;
    this.composer.render();
  }

  destroy() {
    this.geometry.dispose();
    this.material.dispose();
    this.bloom.dispose();
    this.film.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
