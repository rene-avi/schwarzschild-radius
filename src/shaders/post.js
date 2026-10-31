export const filmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.012 } },
  vertexShader: `varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    varying vec2 vUv;
    vec3 aces(vec3 x) { return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      col = pow(aces(col * 1.05), vec3(1.0/2.2));
      float vignette = 1.0 - 0.25 * pow(length((vUv-0.5)*1.25), 1.5);
      col *= vignette;
      float grain = fract(sin(dot(vUv + fract(uTime), vec2(12.9898,78.233))) * 43758.5453);
      col += (grain - 0.5) * uGrain;
      gl_FragColor = vec4(max(col, vec3(0.0)),1.0);
    }`,
};
