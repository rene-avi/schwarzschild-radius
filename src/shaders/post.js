export function exposureTarget(peak, mean) {
  if (!Number.isFinite(peak) || !Number.isFinite(mean)) return 1;
  // Normal views retain unit exposure; only excessive scene light reduces it.
  return Math.max(0.035, Math.min(1, 0.7 / Math.max(0.7, mean), 14 / Math.max(14, peak)));
}

export function smoothExposure(current, target, dt) {
  if (!(dt > 0) || !Number.isFinite(dt)) return current;
  return Math.exp(Math.log(current) + (Math.log(target) - Math.log(current)) * -Math.expm1(-dt / 0.5));
}

export const meterShader = {
  uniforms: { tDiffuse: { value: null }, uSize: { value: 64 }, uRaw: { value: true } },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSize;
    uniform bool uRaw;
    varying vec2 vUv;
    void main() {
      vec2 block = floor(vUv * uSize) * 4.0;
      float mean = 0.0, peak = 0.0;
      for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
        vec3 sampleColor = texture2D(tDiffuse, (block + vec2(float(x), float(y)) + 0.5) / (uSize * 4.0)).rgb;
        vec2 sampleMeter = sampleColor.rg;
        if (uRaw) sampleMeter = log2(1.0 + vec2(dot(sampleColor, vec3(0.2126,0.7152,0.0722)), max(sampleColor.r, max(sampleColor.g, sampleColor.b)))) / 8.0;
        mean += sampleMeter.r / 16.0;
        peak = max(peak, sampleMeter.g);
      }
      gl_FragColor = vec4(mean, peak, 0.0, 1.0);
    }`,
};

export const filmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.003 }, uExposure: { value: 1 } },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uExposure;
    varying vec2 vUv;
    void main() {
      float vignette = 1.0 - 0.25 * pow(length((vUv-0.5)*1.25), 1.5);
      vec3 col = max(texture2D(tDiffuse, vUv).rgb * uExposure * vignette, vec3(0.0));
      // Scale channels together; only the white-hot shoulder loses chroma.
      float peak = max(col.r, max(col.g, col.b));
      float shoulder = peak <= 0.8 ? peak : 1.0 - 0.04 / (peak - 0.6);
      float white = smoothstep(2.0, 8.0, peak);
      col = mix(col / max(peak, 1e-6), vec3(1.0), white) * shoulder;
      col = pow(col, vec3(1.0/2.2));
      float grain = fract(sin(dot(vUv + fract(uTime), vec2(12.9898,78.233))) * 43758.5453);
      col += (grain - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, vec3(0.0)),1.0);
    }`,
};
