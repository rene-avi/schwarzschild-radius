import { GEODESIC, impactParameter, traceRay } from '../src/geodesic.js';

// Pixel centres use screenshot coordinates; WebGL's vertical axis points upward.
export function diskRay(x, y, { width = 1440, height = 900, r = 23, theta = 0.05, elevation = 0.23, tilt = 8 } = {}) {
  const radial = [Math.sin(theta) * Math.cos(elevation), Math.sin(elevation), Math.cos(theta) * Math.cos(elevation)];
  const right = [Math.cos(theta), 0, -Math.sin(theta)];
  const up = [-Math.sin(theta) * Math.sin(elevation), Math.cos(elevation), -Math.cos(theta) * Math.sin(elevation)];
  const sx = (2 * (x + 0.5) / width - 1 + (width > 1000 ? 0.13 : 0)) * width / height;
  const sy = 1 - 2 * (y + 0.5) / height;
  const screenLength = Math.hypot(sx, sy);
  const psi = Math.atan(Math.tan(GEODESIC.halfFov) * screenLength);
  const tangent = screenLength > GEODESIC.radialEpsilon
    ? right.map((value, axis) => (sx * value + sy * up[axis]) / screenLength) : up;
  const angle = tilt * Math.PI / 180;
  return { r, psi, disk: { radial, tangent, normal: [0, Math.cos(angle), -Math.sin(angle)] } };
}

export function traceDiskPixel(x, y, options = {}) {
  const ray = diskRay(x, y, options);
  if (impactParameter(ray.r, ray.psi, options.L) >= GEODESIC.weakEnd) {
    return { steps: 0, crossings: [], exhausted: false };
  }
  return traceRay({ ...ray, ...options });
}

export const tipScans = [[230, 420], [960, 1110]];
