import { GEODESIC as G } from '../geodesic.js';
import { KERR_RAY as K, kerrFlowGLSL } from '../kerrray.js';

// All radii are measured in Schwarzschild radii. No textures are sampled.
export const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  uniform vec2 uResolution;
  uniform float uPixelRatio;
  uniform vec2 uScreenOffset;
  uniform float uTime;
  uniform vec3 uCameraPosition;
  uniform vec3 uCameraForward;
  uniform vec3 uCameraRight;
  uniform vec3 uCameraUp;
  uniform vec4 uLayers;
  uniform int uWorldCount;
  uniform vec3 uWorldCenter[2];
  uniform float uWorldRadius[2];
  uniform vec3 uWorldTint[2];
  uniform float uWorldLightRadius;
  uniform float uTemperature;
  uniform float uSpin;
  uniform float uTilt;
  uniform float uLensing;
  uniform float uQuality;
  uniform float uDiskIntensity;
  uniform vec3 uProbePosition;
  uniform float uProbeRadius;
  uniform float uProbeSignal;
  uniform float uProbePulse;
  uniform float uProbeExtent;
  uniform vec4 uProbeTrail[8];
  uniform float uProbeTrailAge[8];
  uniform int uProbeTrailCount;

  const float PI = 3.14159265359;

  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec3 noiseGradient(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p), blend = f * f * (3.0 - 2.0 * f);
    vec2 derivative = 6.0 * f * (1.0 - f);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + 1.0);
    return vec3(mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y),
      mix(b - a, d - c, blend.y) * derivative.x,
      mix(c - a, d - b, blend.x) * derivative.y);
  }

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float skyGradient(vec3 cell, vec3 offset) {
    float h = floor(hash31(cell) * 16.0);
    float a = h < 8.0 ? offset.x : offset.y;
    float b = h < 4.0 ? offset.y : ((h == 12.0 || h == 14.0) ? offset.x : offset.z);
    return (mod(h, 2.0) < 1.0 ? a : -a) + (mod(floor(h * 0.5), 2.0) < 1.0 ? b : -b);
  }

  float skyNoise(vec3 p, float footprint) {
    if (footprint >= 0.65) return 0.5;
    vec3 cell = floor(p), f = fract(p);
    // Gradient noise has no flat lattice corners, even under strong magnification.
    vec3 blend = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float low = mix(mix(skyGradient(cell, f), skyGradient(cell + vec3(1,0,0), f - vec3(1,0,0)), blend.x),
      mix(skyGradient(cell + vec3(0,1,0), f - vec3(0,1,0)), skyGradient(cell + vec3(1,1,0), f - vec3(1,1,0)), blend.x), blend.y);
    float high = mix(mix(skyGradient(cell + vec3(0,0,1), f - vec3(0,0,1)), skyGradient(cell + vec3(1,0,1), f - vec3(1,0,1)), blend.x),
      mix(skyGradient(cell + vec3(0,1,1), f - vec3(0,1,1)), skyGradient(cell + vec3(1,1,1), f - vec3(1,1,1)), blend.x), blend.y);
    return 0.5 + 0.5 * mix(low, high, blend.z) * (1.0 - smoothstep(0.2, 0.65, footprint));
  }

  // Smooth artistic black-body fit; the Doppler factor shifts the temperature.
  vec3 blackbody(float kelvin) {
    float t = clamp(kelvin / 6500.0, 0.15, 5.0);
    vec3 low = mix(vec3(1.0, 0.085, 0.012), vec3(1.0, 0.56, 0.19), smoothstep(0.15, 0.7, t));
    vec3 warm = mix(low, vec3(1.0, 0.91, 0.74), smoothstep(0.55, 1.15, t));
    return mix(warm, vec3(0.55, 0.74, 1.0), smoothstep(1.2, 3.0, t));
  }

  // Invert the continuous ray Jacobian, never derivatives of a cell ID or face ID.
  vec3 starFace(vec3 ray, vec3 dx, vec3 dy, vec3 n, vec3 a, vec3 b, float pixelAngle) {
    const float cells = 58.0;
    float den = dot(ray, n);
    vec2 uv = vec2(dot(ray, a), dot(ray, b)) / den;
    vec2 jx = (vec2(dot(dx, a), dot(dx, b)) - uv * dot(dx, n)) / den;
    vec2 jy = (vec2(dot(dy, a), dot(dy, b)) - uv * dot(dy, n)) / den;
    float det = jx.x * jy.y - jx.y * jy.x;
    if (abs(det) < 1e-12) return vec3(0.0);
    vec2 grid = (uv * 0.5 + 0.5) * cells;
    vec2 cell = floor(grid);
    float angularArea = abs(dot(cross(dx, dy), ray));
    float gain = min(pixelAngle * pixelAngle / max(angularArea, 1e-12), 1.8);
    // Preserve the observer's compressed escape cone; thin only excess crowding.
    float catalogueGain = gain / (1.0 - uLensing / length(uCameraPosition));
    // Unresolved folds at the capture boundary have no stable point-source image.
    float cellFootprint = max(length(jx), length(jy)) * cells * 0.5 * uPixelRatio;
    float stable = 1.0 - smoothstep(0.25, 0.6, cellFootprint);
    if (stable <= 0.0) return vec3(0.0);
    float compression = smoothstep(2.0, 8.0, 1.0 / (1.0 - uLensing / length(uCameraPosition)));
    vec2 reach = sqrt(jx * jx + jy * jy) * cells * 0.5 * uPixelRatio * 5.0;
    vec3 stars = vec3(0.0);
    // Reject support before hashing; retain border cores with a fixed nine-cell bound.
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 id = cell + vec2(float(x), float(y));
      if (min(id.x, id.y) < 0.0 || max(id.x, id.y) >= cells) continue;
      vec2 nearest = max(max(id + 0.12 - grid, grid - id - 0.88), vec2(0.0));
      if (any(greaterThan(nearest, reach))) continue;
      vec3 key = n * 113.0 + a * id.x + b * id.y;
      float h = hash31(key);
      if (h < 0.48) continue;
      float visible = 1.0;
      if (catalogueGain < 1.0) {
        float selection = 0.075 + 0.85 * hash31(key + 137.4);
        visible = smoothstep(selection - 0.075, selection + 0.075, catalogueGain);
      }
      if (visible <= 0.0) continue;
      vec2 jitter = 0.12 + 0.76 * vec2(hash31(key + 17.3), hash31(key + 61.7));
      vec2 center = (id + jitter) * (2.0 / cells) - 1.0;
      vec2 delta = uv - center;
      vec2 offset = vec2(jy.y * delta.x - jy.x * delta.y, jx.x * delta.y - jx.y * delta.x) / det / uPixelRatio;
      if (dot(offset, offset) > 25.0) continue;
      float d = length(offset);
      float population = (h - 0.48) / 0.52;
      float rare = smoothstep(0.975, 1.0, population);
      float radius = mix(1.35 + 0.2 * rare, 0.45 + 0.9 * pow(population, 8.0) + 0.2 * rare, compression);
      float edge = mix(0.8, 0.55, compression);
      float core = 1.0 - smoothstep(radius - edge, radius + edge, d);
      float halo = exp(-d * d / 6.0) * rare * mix(0.045, 0.14, compression);
      float magnitude = mix(0.045 + 1.35 * pow(population, 7.0), 0.004 + 1.35 * pow(population, 18.0), compression);
      float flux = min(magnitude * max(0.8, gain), 2.2) * visible;
      vec3 tint = blackbody(mix(3200.0, 16000.0, hash31(key + 91.0)));
      stars += tint * flux * (core + halo);
    }
    return stars * stable;
  }

  // ray is normalized; its derivatives come from uniform control flow.
  vec3 skyColor(vec3 ray, vec3 dx, vec3 dy, float pixelAngle) {
    vec3 galaxyNormal = normalize(vec3(-0.32, 0.80, 0.31));
    float latitude = abs(dot(ray, galaxyNormal));
    // The Jacobian's Frobenius norm bounds both axes and is rotation invariant.
    float footprint = sqrt(dot(dx, dx) + dot(dy, dy));
    // Share the resolved detail octave between band colour and dust absorption.
    float cloud = 0.5, detail = 0.5;
    if (footprint * 9.0 < 0.65) cloud = skyNoise(ray * 9.0 + 3.7, footprint * 9.0);
    if (footprint * 27.0 < 0.65) detail = skyNoise(ray * 27.0 - 8.1, footprint * 27.0);
    cloud = 0.5 + 0.6 * (cloud - 0.5) + 0.2 * (detail - 0.5);
    detail = 0.5 + 0.65 * (detail - 0.5);
    float latitudeVariance = (pow(dot(dx, galaxyNormal), 2.0) + pow(dot(dy, galaxyNormal), 2.0)) / 12.0;
    float bandWidth = 1.0 + 76.0 * latitudeVariance;
    float band = exp(-latitude * latitude * 38.0 / bandWidth) / sqrt(bandWidth);
    float dust = 0.95 - 0.7 * smoothstep(0.38, 0.62, cloud + 0.3 * (detail - 0.5));
    vec3 skyLight = vec3(0.0016, 0.0022, 0.0038);
    skyLight += mix(vec3(0.018, 0.024, 0.044), vec3(0.095, 0.065, 0.042), detail) * band * dust * 0.52;
    // Overlap neighbouring cube faces so a point core survives every face border.
    vec3 ar = abs(ray);
    float major = max(ar.x, max(ar.y, ar.z));
    float overlap = 0.075;
    if (ar.x >= major - overlap) skyLight += starFace(ray, dx, dy, vec3(sign(ray.x),0,0), vec3(0,0,1), vec3(0,1,0), pixelAngle);
    if (ar.y >= major - overlap) skyLight += starFace(ray, dx, dy, vec3(0,sign(ray.y),0), vec3(1,0,0), vec3(0,0,1), pixelAngle);
    if (ar.z >= major - overlap) skyLight += starFace(ray, dx, dy, vec3(0,0,sign(ray.z)), vec3(1,0,0), vec3(0,1,0), pixelAngle);

    // Resolve this source only near alignment; off-axis images use the point profile.
    vec3 alignmentStar = normalize(vec3(0.0, -5.8, -21.0));
    float alignmentDistance = length(cross(ray, alignmentStar));
    float alignment = smoothstep(0.99995, 0.999995, dot(-normalize(uCameraPosition), alignmentStar));
    vec2 delta = vec2(dot(alignmentStar - ray, dx), dot(alignmentStar - ray, dy));
    float xx = dot(dx, dx), xy = dot(dx, dy), yy = dot(dy, dy);
    float determinant = xx * yy - xy * xy;
    vec2 offset = vec2(yy * delta.x - xy * delta.y, xx * delta.y - xy * delta.x)
      / max(determinant, 1e-20) / uPixelRatio;
    float point = determinant > 1e-20 ? 1.0 - smoothstep(0.65, 2.25, length(offset)) : 0.0;
    float resolved = exp(-pow(alignmentDistance / 0.0028, 2.0));
    float stable = 1.0 - smoothstep(0.008, 0.02, footprint);
    float source = mix(point * stable, resolved, alignment) * step(0.0, dot(ray, alignmentStar));
    skyLight += vec3(0.72, 0.83, 1.0) * source * 2.2;
    return skyLight;
  }

  float filteredNoise(vec2 p, float footprint) {
    if (footprint >= 1.0) return 0.5;
    return mix(noiseGradient(p).x, 0.5, smoothstep(0.65, 1.0, footprint));
  }

  float projectedFootprint(vec2 gradient, vec2 radial, vec2 rayPlane, float incidence, float pixel) {
    vec2 worldGradient = gradient.x * radial + gradient.y * vec2(-radial.y, radial.x);
    float along = dot(worldGradient, rayPlane) / incidence;
    // The projected norm bounds both screen directions, including grazing stretch.
    return pixel * sqrt(dot(worldGradient, worldGradient) + along * along);
  }

  float flowFootprint(vec2 flow, vec2 shear, vec2 radial, vec2 rayPlane, float incidence, float pixel) {
    // Each lattice axis has its own projected gradient, including differential shear.
    vec2 tangent = vec2(-flow.y, flow.x);
    float x = projectedFootprint(vec2(flow.x + shear.x * tangent.x, shear.y * tangent.x), radial, rayPlane, incidence, pixel);
    float y = projectedFootprint(vec2(flow.y + shear.x * tangent.y, shear.y * tangent.y), radial, rayPlane, incidence, pixel);
    return length(vec2(x, y));
  }

  vec2 gasPattern(float r, float angle, float orbit, vec2 rayPlane, float incidence, float pixel) {
    vec2 radial = vec2(cos(angle), sin(angle));
    vec2 flow = vec2(cos(angle + orbit), sin(angle + orbit));
    vec2 tangent = vec2(-flow.y, flow.x);
    float fluidPixel = flowFootprint(flow, vec2(-1.5 * orbit, 1.0), radial, rayPlane, incidence, pixel);
    vec3 clumpNoise = noiseGradient(r * flow * 0.65 + 9.1);
    vec3 eddyNoise = noiseGradient(r * flow * 1.8 - 3.7);
    float clumpWeight = 1.0 - smoothstep(0.65, 1.0, fluidPixel * 0.65);
    float eddyWeight = 1.0 - smoothstep(0.65, 1.0, fluidPixel * 1.8);
    float clump = mix(0.5, clumpNoise.x, clumpWeight);
    float eddy = mix(0.5, eddyNoise.x, eddyWeight);
    vec2 warpGradient = 0.12 * 0.65 * clumpWeight * clumpNoise.yz + 0.025 * 1.8 * eddyWeight * eddyNoise.yz;
    // Advect Cartesian noise without repeatedly wrapping its lattice with radius.
    vec2 winding = vec2(-1.5 * orbit, 1.0)
      + r * vec2(dot(warpGradient, flow - 1.5 * orbit * tangent), dot(warpGradient, tangent));
    float woundAngle = angle + orbit + 0.12 * (clump - 0.5) + 0.025 * (eddy - 0.5);
    vec2 wound = vec2(cos(woundAngle), sin(woundAngle));
    float threadPixel = flowFootprint(wound, winding, radial, rayPlane, incidence, pixel);
    float filament = filteredNoise(r * wound * 0.7 + 21.8, threadPixel * 0.7);
    float threads = filteredNoise(r * wound * 1.6 - 11.3, threadPixel * 1.6);
    float fine = filteredNoise(r * wound * 3.5 + 4.2, threadPixel * 3.5);
    float lane = 1.0 - smoothstep(0.12, 0.3, filament);
    float bright = smoothstep(0.62, 0.85, threads);
    // Filaments lose contrast before the edge; only irregular gas survives there.
    float outer = smoothstep(5.8, 7.25, r);
    float structure = (0.36 + filament * 0.45 + threads * 0.7 + fine * 0.4 + bright * 0.32) * (1.0 - lane * 0.65);
    float density = (0.58 + clump * 0.65 + eddy * 0.3)
      * mix(structure, 1.12, outer);
    float edgeGas = 0.5 + 0.08 * (clump - 0.5) + 0.04 * (eddy - 0.5);
    return vec2(mix(filament, edgeGas, outer), density);
  }

  vec3 diskEmission(vec3 position, vec3 ray, vec3 normal, float pixelFootprint) {
    float r = length(position);
    float inner = 2.95 - 0.35 * uSpin;
    float footprint = pixelFootprint / max(abs(dot(normalize(ray), normal)), 0.035);
    if (r < inner - footprint || r > 8.6 + footprint) return vec3(0.0);
    vec3 axisY = normalize(cross(normal, vec3(1.0, 0.0, 0.0)));
    vec2 p = vec2(position.x, dot(position, axisY));
    vec2 rayPlane = vec2(ray.x, dot(ray, axisY));
    float incidence = max(abs(dot(ray, normal)), 0.001);
    float angle = atan(p.y, p.x);
    float rate = (0.22 + uSpin * 0.08) / pow(r / 3.0, 1.5);
    // Renew eddies at zero blend weight so indefinite shear never erases all detail.
    float age = mod(uTime, 16.0);
    float blend = 0.5 - 0.5 * cos(age * (2.0 * PI / 16.0));
    vec2 gas = mix(gasPattern(r, angle, mod(uTime + 8.0, 16.0) * rate, rayPlane, incidence, pixelFootprint),
      gasPattern(r, angle, age * rate, rayPlane, incidence, pixelFootprint), blend);
    float filament = gas.x;
    float density = gas.y;
    float aa = max(footprint * 0.5, 0.003);
    float edge = smoothstep(inner - aa, inner + aa, r)
      * (1.0 - smoothstep(7.1 - aa, 8.35 + aa, r));
    density *= mix(1.0, 0.12 + 1.8 * filament * filament, smoothstep(6.5, 8.3, r));
    if (edge <= 0.0) return vec3(0.0);
    float radial = pow(inner / r, 2.35);
    vec3 tangent = normalize(cross(normal, position));
    float direction = uSpin < -0.01 ? -1.0 : 1.0;
    float beta = min(0.56, sqrt(0.5 / max(r - 1.0, 0.1))) * (0.85 + abs(uSpin) * 0.15);
    float toward = dot(tangent * direction, -normalize(ray));
    float doppler = sqrt(1.0 - beta * beta) / max(0.2, 1.0 - beta * toward);
    float gravitationalShift = sqrt((1.0 - uLensing / r) / (1.0 - uLensing / length(uCameraPosition)));
    float shift = doppler * gravitationalShift;
    float temperature = uTemperature * pow(inner / r, 0.62) * shift;
    vec3 color = blackbody(temperature);
    float grazing = 1.0 + 0.32 * pow(1.0 - abs(dot(normalize(ray), normal)), 3.0);
    float rimWidth = max(0.13, footprint);
    float hotEdge = exp(-pow((r - inner - 0.14) / rimWidth, 2.0)) * 0.24 * 0.13 / rimWidth;
    return color * (radial * density + hotEdge) * edge * pow(doppler, 3.0) * grazing * 1.75 * uDiskIntensity;
  }

  float ellipsoidHit(vec3 origin, vec3 direction, vec3 axes) {
    vec3 p = origin / axes;
    vec3 d = direction / axes;
    float a = dot(d, d);
    float b = dot(p, d);
    float c = dot(p, p) - 1.0;
    float discriminant = b * b - a * c;
    if (discriminant < 0.0) return -1.0;
    return (-b - sqrt(discriminant)) / a;
  }

  vec3 probeColor(float g) {
    vec3 red = vec3(1.0, 0.018, 0.002);
    vec3 amber = vec3(1.0, 0.32, 0.025);
    vec3 cyan = vec3(0.65, 0.92, 1.0);
    return g < 0.5 ? mix(red, amber, smoothstep(0.02, 0.5, g))
      : mix(amber, cyan, smoothstep(0.5, 0.95, g));
  }

  float probeGlow(vec3 origin, vec3 direction, float segmentLength, vec3 center, float width) {
    float along = dot(center - origin, direction);
    float closest = clamp(along, 0.0, segmentLength);
    float offset = length(origin + direction * closest - center) / width;
    // Only the segment containing the closest approach contributes to the beacon.
    return along >= 0.0 && along < segmentLength && offset < 4.0 ? exp(-offset * offset * 0.5) : 0.0;
  }

  float probeGlint(vec3 origin, vec3 direction, float segmentLength, float pixelWidth) {
    float along = dot(uProbePosition - origin, direction);
    if (along < 0.0 || along >= segmentLength) return 0.0;
    vec3 offset = origin + direction * along - uProbePosition;
    // Keep both glint axes perpendicular to the local bent ray to bound its footprint.
    vec3 right = uCameraRight - direction * dot(uCameraRight, direction);
    if (length(right) < 0.001) right = uCameraUp - direction * dot(uCameraUp, direction);
    right = normalize(right);
    vec2 p = abs(vec2(dot(offset, right), dot(offset, cross(direction, right)))) / pixelWidth;
    return (exp(-p.x * 0.28 - p.y * 2.4) + exp(-p.y * 0.28 - p.x * 2.4))
      * (1.0 - smoothstep(12.0, 16.0, length(p)));
  }

  vec3 probeEmission(vec3 origin, vec3 direction, float segmentLength) {
    if (uProbeRadius < 0.0) return vec3(0.0);
    float pixelAngle = ${2 * Math.tan(G.halfFov)} / uResolution.y;
    float cameraDistance = distance(uCameraPosition, uProbePosition);
    // A coincident camera has no projected craft direction.
    if (cameraDistance < 0.000001) return vec3(0.0);
    float observerLapse = sqrt(1.0 - uLensing / length(uCameraPosition));
    float worldPixel = cameraDistance * pixelAngle / observerLapse;
    // The bound includes all past flash positions, even when they are far from the hull.
    if (distance(origin, uProbePosition) > segmentLength + max(uProbeExtent, 24.0 * worldPixel)) return vec3(0.0);
    // Bound angular hull size even when the view passes through the craft.
    float hullScale = min(1.0, worldPixel * 9.0 / 0.15);
    float apparentSignal = sqrt(clamp(uProbeSignal, 0.0, 1.0));
    float beaconWidth = worldPixel * mix(1.2, 4.0, apparentSignal);
    vec3 light = vec3(0.0);
    if (distance(origin, uProbePosition) < segmentLength + max(0.2 * hullScale, 24.0 * worldPixel)) {
      vec3 radial = normalize(uProbePosition);
      vec3 side = normalize(cross(radial, vec3(0.0, 1.0, 0.001)));
      vec3 up = cross(side, radial);
      vec3 relative = origin - uProbePosition;
      vec3 localOrigin = vec3(dot(relative, side), dot(relative, up), dot(relative, radial));
      vec3 localDirection = vec3(dot(direction, side), dot(direction, up), dot(direction, radial));
      float hull = ellipsoidHit(localOrigin, localDirection, vec3(0.035, 0.025, 0.13) * hullScale);
      float wing = ellipsoidHit(localOrigin, localDirection, vec3(0.15, 0.014, 0.027) * hullScale);
      float hit = (hull > 0.0 && hull < segmentLength) || (wing > 0.0 && wing < segmentLength) ? 1.0 : 0.0;
      float glow = probeGlow(origin, direction, segmentLength, uProbePosition, beaconWidth);
      float brightness = max(pow(uProbeSignal, 3.0), 0.045);
      float glint = probeGlint(origin, direction, segmentLength, worldPixel * mix(0.6, 1.0, apparentSignal));
      light += probeColor(uProbeSignal) * brightness
        * (hit * (1.4 + 2.0 * uProbePulse) + glow * (0.55 + 4.0 * uProbePulse) + glint * 3.0 * uProbePulse);
    }
    for (int i = 0; i < 8; i++) {
      if (i >= uProbeTrailCount) break;
      vec3 center = uProbeTrail[i].xyz;
      float width = max(distance(uCameraPosition, center), 0.00001) * pixelAngle / observerLapse * 1.25;
      if (distance(origin, center) > segmentLength + 4.0 * width) continue;
      float glow = probeGlow(origin, direction, segmentLength, center, width);
      float fade = 0.65 * pow(max(0.0, 1.0 - uProbeTrailAge[i] / 12.0), 1.5);
      light += probeColor(uProbeTrail[i].w) * max(pow(uProbeTrail[i].w, 3.0), 0.08) * glow * fade;
    }
    // Keep the beacon below bloom's threshold, including in a fully dark view.
    return light / max(1.0, max(light.r, max(light.g, light.b)) / 1.05);
  }

  vec3 observedSky(vec3 ray, vec3 dx, vec3 dy, float pixelAngle, float observerShift) {
    if (uLayers.y < 0.5) return vec3(0.0);
    float gain = min(pow(observerShift, 0.75), 2.8);
    vec3 tint = mix(vec3(1.0), vec3(0.85, 0.96, 1.15), clamp((observerShift - 1.0) * 0.2, 0.0, 1.0));
    vec3 sky = skyColor(ray, dx, dy, pixelAngle);
    return min(sky * gain * tint, max(sky, vec3(1.8, 2.2, 2.8))) * uLayers.y;
  }

  vec3 observedSky(vec3 ray, float pixelAngle, float observerShift) {
    ray = normalize(ray);
    return observedSky(ray, dFdx(ray), dFdy(ray), pixelAngle, observerShift);
  }

  // Vacuum remainder to infinity; the cutoff guarantees b/r <= 1/2.
  float escapeAngle(float u, float b) {
    float z = b * u;
    float z2 = z * z;
    float c = sqrt(1.0 - z2);
    float first = z2 * z2 / (c * (1.0 + c) * (1.0 + c));
    float second = z * z2 * z2 * z2 * (1.0 / 7.0 + z2 * (5.0 / 18.0 + z2 * (35.0 / 88.0 + z2 * (105.0 / 208.0 + z2 * 77.0 / 128.0))));
    float epsilon = uLensing / b;
    return asin(z) - epsilon * first / 2.0 + 3.0 * epsilon * epsilon * second / 8.0;
  }

  vec3 worldRadiance(int world, vec3 position, vec3 normal, vec3 direction, float footprint) {
    float terrain = 0.65 * skyNoise(normal * 2.0 + 7.3, footprint * 2.0)
      + 0.35 * skyNoise(normal * 4.0 - 3.1, footprint * 4.0);
    vec3 albedo = uWorldTint[world] * mix(0.78, 1.06, terrain);
    float lambert = max(0.0, dot(normal, -normalize(position)));
    float radius = length(position);
    // Soften inverse-square light to keep the distant world's day side readable.
    float falloff = (1.0 + pow(6.0 / uWorldLightRadius, 2.0))
      / (1.0 + pow(radius / uWorldLightRadius, 2.0));
    float limb = pow(1.0 - max(0.0, dot(normal, -direction)), 10.0);
    vec3 light = albedo * (0.012 + blackbody(uTemperature) * falloff * (1.25 * lambert + 0.045 * limb));
    return light / max(1.0, max(light.r, max(light.g, light.b)) / 1.05);
  }

  bool worldHit(vec3 origin, vec3 direction, float segmentLength, bvec2 seen,
      out float nearest, out int world, out vec4 surface) {
    nearest = segmentLength + 1.0;
    world = 0;
    surface = vec4(0.0);
    bool hit = false;
    for (int j = 0; j < 2; j++) {
      if (j >= uWorldCount) break;
      if (seen[j]) continue;
      float radius = uWorldRadius[j];
      float cameraDistance = distance(uCameraPosition, uWorldCenter[j]);
      if (cameraDistance <= radius) continue;
      float pixelAngle = ${2 * Math.tan(G.halfFov)} / uResolution.y;
      float pixel = cameraDistance * pixelAngle / sqrt(1.0 - uLensing / length(uCameraPosition));
      vec3 relative = origin - uWorldCenter[j];
      if (length(relative) > segmentLength + radius + pixel * 0.5) continue;
      float along = dot(relative, direction);
      float perpendicular = length(relative - along * direction);
      float coverage = 1.0 - smoothstep(radius - pixel * 0.5, radius + pixel * 0.5, perpendicular);
      if (coverage <= 0.0) continue;
      float entry = -along - sqrt(max(0.0, radius * radius - perpendicular * perpendicular));
      if (entry < 0.0 && dot(relative, relative) <= radius * radius) entry = 0.0;
      if (entry >= 0.0 && entry <= segmentLength && entry < nearest) {
        nearest = entry;
        world = j;
        vec3 position = origin + direction * entry;
        vec3 normal = normalize(position - uWorldCenter[j]);
        surface = vec4(worldRadiance(j, position, normal, direction, pixel / radius), coverage);
        hit = true;
      }
    }
    return hit;
  }

  void worldLight(vec4 surface, inout vec3 light, inout float transmittance) {
    light += surface.rgb * transmittance * surface.a;
    transmittance *= 1.0 - surface.a;
  }

  bool worldNeedsIntegration(vec3 initialRay, float impact) {
    for (int j = 0; j < 2; j++) {
      if (j >= uWorldCount) break;
      vec3 relative = uWorldCenter[j] - uCameraPosition;
      float d = length(relative);
      if (d <= uWorldRadius[j]) continue;
      float cone = asin(uWorldRadius[j] / d) + 2.5 / impact + 0.02;
      if (dot(initialRay, relative / d) >= cos(min(PI, cone))) return true;
    }
    return false;
  }

  void main() {
    vec2 screen = (vUv * 2.0 - 1.0) + uScreenOffset * 2.0;
    screen.x *= uResolution.x / uResolution.y;
    vec3 initialRay = normalize(uCameraForward + tan(${G.halfFov}) * (screen.x * uCameraRight + screen.y * uCameraUp));
    float observerRadius = length(uCameraPosition);
    vec3 radial = uCameraPosition / observerRadius;
    float mu = clamp(dot(initialRay, -radial), -1.0, 1.0);
    vec3 transverse = initialRay + radial * mu;
    float sinPsi = length(transverse);
    vec3 tangent = sinPsi >= ${G.radialEpsilon.toFixed(6)} ? transverse / sinPsi : uCameraUp;
    float lapse = sqrt(1.0 - uLensing / observerRadius);
    float impact = observerRadius * sinPsi / lapse;
    float pixelAngle = ${2 * Math.tan(G.halfFov)} / uResolution.y;
    float surface = ${G.captureRadius} * max(1.0, uLensing);
    float photonSphere = 1.5 * uLensing;
    float critical = photonSphere >= surface ? ${G.criticalImpact} * uLensing
      : surface / sqrt(1.0 - uLensing / surface);
    float shadowSin = min(1.0, critical * lapse / observerRadius);
    float shadowCos = sqrt(max(0.0, 1.0 - shadowSin * shadowSin));
    if (observerRadius < photonSphere) shadowCos = -shadowCos;
    // The conserved impact parameter fixes fate even for unresolved critical orbits.
    bool captured = mu > shadowCos;
    float vignette = 1.0 - smoothstep(0.35, 1.9, length(vUv * 2.0 - 1.0)) * 0.18;
    if (sinPsi < ${G.radialEpsilon.toFixed(6)}) {
      float probeLength = mu > 0.0 ? max(0.0, observerRadius - surface) : observerRadius + 8.0;
      vec3 beacon = uLayers.w > 0.5 ? probeEmission(uCameraPosition, initialRay, probeLength) : vec3(0.0);
      if (uWorldCount > 0) {
        float hitDistance;
        int world;
        vec4 surfaceLight;
        float worldLength = mu > 0.0 ? probeLength : 1000000.0;
        if (worldHit(uCameraPosition, initialRay, worldLength, bvec2(false), hitDistance, world, surfaceLight)) {
          vec3 light = vec3(0.0);
          float transmittance = 1.0;
          worldLight(surfaceLight, light, transmittance);
          gl_FragColor = vec4((light + ((captured ? vec3(0.0) : observedSky(initialRay, pixelAngle, 1.0 / lapse)) + beacon) * transmittance) * vignette, 1.0);
          return;
        }
      }
      gl_FragColor = vec4((captured ? vec3(0.0) : observedSky(initialRay, pixelAngle, 1.0 / lapse)) * vignette + beacon * vignette, 1.0);
      return;
    }

    // Local orthonormal directions map to coordinate directions with tan(psi') = tan(psi)/lapse.
    vec3 coordinateRay = normalize(-radial * mu + transverse / lapse);
    float radialDot = dot(radial, coordinateRay);
    vec3 impactDirection = normalize(radial - coordinateRay * radialDot);
    float finiteDistance = 1.0 - radialDot;
    float deflection = finiteDistance * uLensing / impact
      + (15.0 * PI / 32.0) * finiteDistance * uLensing * uLensing / (impact * impact);
    vec3 weakRay = normalize(coordinateRay * cos(deflection) - impactDirection * sin(deflection));
    // Both gates use the same normalized ray and footprint before any cone split.
    vec3 weakSkyRay = normalize(weakRay);
    vec3 weakSkyDx = dFdx(weakSkyRay), weakSkyDy = dFdy(weakSkyRay);
    bool integrateWorld = false;
    if (uWorldCount > 0 && impact >= ${G.weakEnd.toFixed(1)}) integrateWorld = worldNeedsIntegration(initialRay, impact);
    bool weakShortcut = impact >= ${G.weakEnd.toFixed(1)} && !integrateWorld;

    float tilt = uTilt * PI / 180.0;
    vec3 normal = vec3(0.0, cos(tilt), -sin(tilt));
    vec3 light = vec3(0.0);
    float transmittance = 1.0;
    bvec2 worldSeen = bvec2(false);
    vec3 outgoing = initialRay;
    if (!weakShortcut) {
      vec3 coronaColor = blackbody(uTemperature * 0.8) * uDiskIntensity * 0.01;
      int limit = uQuality < 0.5 ? ${G.performanceSteps} : (uQuality < 1.5 ? ${G.balancedSteps} : ${G.highSteps});
      float maxAngle = uQuality < 0.5 ? ${G.performanceAngle} : (uQuality < 1.5 ? ${G.balancedAngle} : ${G.highAngle});
      float criticalAngle = uQuality < 0.5 ? ${G.performanceCriticalAngle} : (uQuality < 1.5 ? ${G.balancedCriticalAngle} : ${G.highCriticalAngle});
      float criticalDistance = min(1.0, ${G.criticalImpactScale.toFixed(1)} * abs(impact / critical - 1.0));
      float escapeU = 1.0 / max(${G.escapeRadius.toFixed(1)}, ${G.escapeImpact.toFixed(1)} * impact);
      float u = 1.0 / observerRadius;
      float v = mu / impact;
      vec3 orbitRadial = radial;
      vec3 orbitTangent = tangent;
      vec3 position = uCameraPosition;

      // RK4 solves u'' + u = 1.5 L u^2; the reference uses identical stages and step rules.
      for (int i = 0; i < ${G.highSteps}; i++) {
        if (i >= limit || u >= 1.0 / surface) break;
        if (v < 0.0 && u < escapeU) {
          float tail = escapeAngle(u, impact);
          outgoing = orbitRadial * cos(tail) + orbitTangent * sin(tail);
          break;
        }
        float angularLimit = min(min(maxAngle, ${G.flatAngle} + uLensing), criticalAngle + ${G.criticalStep} * abs(1.0 - 1.5 * uLensing * u) * criticalDistance);
        float h = min(angularLimit, max(${G.minimumAngle.toFixed(6)}, ${G.radialStep} * u / max(abs(v), u)));
        float a1 = 1.5 * uLensing * u * u - u;
        float u2 = u + v * h * 0.5;
        float v2 = v + a1 * h * 0.5;
        float a2 = 1.5 * uLensing * u2 * u2 - u2;
        float u3 = u + v2 * h * 0.5;
        float v3 = v + a2 * h * 0.5;
        float a3 = 1.5 * uLensing * u3 * u3 - u3;
        float u4 = u + v3 * h;
        float v4 = v + a3 * h;
        float a4 = 1.5 * uLensing * u4 * u4 - u4;
        float nextU = u + h / 6.0 * (v + 2.0 * v2 + 2.0 * v3 + v4);
        float nextV = v + h / 6.0 * (a1 + 2.0 * a2 + 2.0 * a3 + a4);
        if (nextU <= 0.0) {
          float tail = h * u / (u - nextU);
          outgoing = orbitRadial * cos(tail) + orbitTangent * sin(tail);
          break;
        }
        // Bounded-angle Taylor rotations avoid transcendental work in the orbit loop.
        float h2 = h * h;
        float s = h * (1.0 + h2 * (-1.0 / 6.0 + h2 * (1.0 / 120.0 - h2 / 5040.0)));
        float c = 1.0 + h2 * (-1.0 / 2.0 + h2 * (1.0 / 24.0 - h2 / 720.0));
        vec3 nextRadial = orbitRadial * c + orbitTangent * s;
        vec3 nextTangent = -orbitRadial * s + orbitTangent * c;
        vec3 nextPosition = nextRadial / nextU;
        vec3 nextVelocity = normalize(-nextV * nextRadial + nextU * nextTangent);
        vec3 segment = nextPosition - position;
        float segmentLength = length(segment);
        float plane0 = dot(position, normal);
        float plane1 = dot(nextPosition, normal);
        float worldDistance = segmentLength + 1.0;
        vec4 worldSurface = vec4(0.0);
        int worldIndex;
        bool hitWorld = false;
        bool worldFirst = false;
        if (uWorldCount > 0 && transmittance > 0.0 && segmentLength > 0.0) {
          hitWorld = worldHit(position, segment / segmentLength, segmentLength, worldSeen, worldDistance, worldIndex, worldSurface);
          if (hitWorld) worldSeen[worldIndex] = true;
          float diskDistance = plane0 * plane1 < 0.0 ? segmentLength * plane0 / (plane0 - plane1) : segmentLength + 1.0;
          worldFirst = hitWorld && worldDistance <= diskDistance;
          if (worldFirst) worldLight(worldSurface, light, transmittance);
        }
        if (uLayers.x > 0.5 && plane0 * plane1 < 0.0) {
          // The orbital plane fixes the crossing angle independently of radius.
          float planeRadial = dot(orbitRadial, normal);
          float planeTangent = dot(orbitTangent, normal);
          float fraction = atan(abs(planeRadial), abs(planeTangent)) / h;
          float slope0 = h * v, slope1 = h * nextV;
          float quadratic = 3.0 * (nextU - u) - 2.0 * slope0 - slope1;
          float cubic = 2.0 * (u - nextU) + slope0 + slope1;
          float crossingU = u + fraction * (slope0 + fraction * (quadratic + fraction * cubic));
          float crossingV = (slope0 + fraction * (2.0 * quadratic + fraction * 3.0 * cubic)) / h;
          vec3 crossingRadial = normalize(orbitRadial * abs(planeTangent) + orbitTangent * abs(planeRadial));
          vec3 crossingTangent = normalize(-orbitRadial * abs(planeRadial) + orbitTangent * abs(planeTangent));
          vec3 crossing = crossingRadial / crossingU;
          vec3 crossingVelocity = normalize(-crossingV * crossingRadial + crossingU * crossingTangent);
          float diskPixel = pixelAngle * observerRadius / lapse * (1.0 + 0.2 / max(abs(impact - critical), 0.03));
          vec3 emission = diskEmission(crossing, crossingVelocity, normal, diskPixel);
          light += emission * transmittance;
          transmittance *= exp(-18.0 * length(emission));
        }
        if (uWorldCount > 0 && hitWorld && !worldFirst) worldLight(worldSurface, light, transmittance);
        // Continue the vacuum ray after occlusion so neighbouring sky derivatives stay valid.
        if (uLayers.w > 0.5 && uProbeRadius > 0.0 && segmentLength > 0.0) light += probeEmission(position, segment / segmentLength, segmentLength) * transmittance;
        float radius = length(position);
        if (uLayers.x > 0.5 && radius < 8.5 && abs(plane0) < 0.7) {
          float coronaOffset = (radius - 4.1) / 2.0;
          float corona = exp(-abs(plane0) * 15.0) * exp(-coronaOffset * coronaOffset);
          light += coronaColor * corona * segmentLength * transmittance;
        }
        position = nextPosition;
        orbitRadial = nextRadial;
        orbitTangent = nextTangent;
        outgoing = nextVelocity;
        u = nextU;
        v = nextV;
      }

      if (uWorldCount > 0 && transmittance > 0.0 && !captured && v < 0.0) {
        float hitDistance;
        int world;
        vec4 surfaceLight;
        if (worldHit(position, normalize(outgoing), 1000000.0, worldSeen, hitDistance, world, surfaceLight)) worldLight(surfaceLight, light, transmittance);
      }
    }

    // Shortcut lanes rejoin before derivatives so impact=weakEnd has valid neighbours.
    outgoing = normalize(mix(outgoing, weakRay, smoothstep(${G.weakStart.toFixed(1)}, ${G.weakEnd.toFixed(1)}, impact)));
    vec3 skyRay = impact >= ${G.weakEnd.toFixed(1)} ? weakSkyRay : normalize(outgoing);
    vec3 skyDx = dFdx(skyRay), skyDy = dFdy(skyRay);
    if (impact >= ${G.weakEnd.toFixed(1)}) {
      skyDx = weakSkyDx;
      skyDy = weakSkyDy;
    }
    vec3 background = observedSky(skyRay, skyDx, skyDy, pixelAngle, 1.0 / lapse);
    if (weakShortcut) {
      gl_FragColor = vec4(background * vignette, 1.0);
      return;
    }
    float shadowPixel = max(fwidth(mu - shadowCos), 1e-7);
    float skyCoverage = smoothstep(-shadowPixel * 0.5, shadowPixel * 0.5, shadowCos - mu);
    light += background * transmittance * skyCoverage;
    float ringWidth = max(0.006, fwidth(impact) * 0.55);
    float ringOffset = (impact - critical) / ringWidth;
    float photonRing = exp(-ringOffset * ringOffset);
    vec3 ringPosition = uCameraRight * screen.x + uCameraUp * screen.y;
    vec3 ringTangent = cross(normal, ringPosition);
    ringTangent /= max(length(ringTangent), 1e-6);
    float ringToward = dot(ringTangent, -initialRay);
    float ringDoppler = sqrt(1.0 - 0.48 * 0.48) / (1.0 - 0.48 * ringToward);
    float ringShift = ringDoppler * sqrt(max(0.01, 1.0 - uLensing / (2.95 - 0.35 * uSpin))) / lapse;
    bool ringSide = observerRadius >= photonSphere ? mu >= 0.0 : mu <= 0.0;
    if (ringSide) light += blackbody(uTemperature * ringShift) * photonRing * pow(ringDoppler, 3.0) * 0.19
      * transmittance * transmittance * smoothstep(0.5, 0.9, uLensing) * uDiskIntensity * uLayers.z;
    gl_FragColor = vec4(light * vignette, 1.0);
  }
`;

// Reuse only procedural display helpers; the default export above is immutable.
export const kerrFragmentShader = fragmentShader.slice(0, fragmentShader.indexOf('  vec3 diskEmission('))
  + fragmentShader.slice(fragmentShader.indexOf('  vec3 observedSky('), fragmentShader.indexOf('  // Vacuum remainder'))
  + fragmentShader.slice(fragmentShader.indexOf('  // Vacuum remainder'), fragmentShader.indexOf('  vec3 worldRadiance('))
  + /* glsl */ `
  uniform vec3 uKerrPosition;
  uniform vec4 uKerrObserver;
  uniform vec4 uKerrRadial;
  uniform vec4 uKerrPolar;
  uniform vec4 uKerrAzimuth;
  uniform vec3 uKerrScenePolar;
  uniform vec3 uKerrSceneAzimuth;
  uniform float uKerrInner;
  uniform float uKerrLapse;
  uniform vec2 uKerrWorldPhase;
  uniform vec2 uKerrWorldOrbit;
  uniform int uKerrProbeCount;
  uniform vec4 uKerrProbeEvent[48];
  uniform vec4 uKerrProbeU[48];
  uniform float uKerrProbeTau[48];

  float kerrRadius(vec3 x, float a) {
    float q = dot(x, x) - a * a;
    return sqrt(0.5 * (q + sqrt(q * q + 4.0 * a * a * x.z * x.z)));
  }
  ${kerrFlowGLSL}

  vec3 kerrWorldCenter(float radius, float phase, float time, float a) {
    float omega = sqrt(0.5) / (pow(radius, 1.5) + a * sqrt(0.5));
    float phi = phase + PI * 0.5 + omega * time;
    float rho = sqrt(radius * radius + a * a);
    return vec3(rho * cos(phi), rho * sin(phi), 0.0);
  }

  float kerrInnerProduct(vec3 x, float a, vec4 u, vec4 v) {
    float r = kerrRadius(x, a);
    vec4 l = vec4(1.0, -(r * x.x - a * x.y) / (r * r + a * a),
      -(r * x.y + a * x.x) / (r * r + a * a), -x.z / r);
    float f = r * r * r / (pow(r, 4.0) + a * a * x.z * x.z);
    return -u.x * v.x + dot(u.yzw, v.yzw) + f * dot(l, u) * dot(l, v);
  }

  float kerrWorldShift(vec3 x, vec3 p, float pt, float radius, float a) {
    float omega = sqrt(0.5) / (pow(radius, 1.5) + a * sqrt(0.5));
    vec4 v = vec4(1.0, -omega * x.y, omega * x.x, 0.0);
    float ut = inversesqrt(-kerrInnerProduct(x, a, v, v));
    return 1.0 / (ut * (pt + omega * (x.x * p.y - x.y * p.x)));
  }

  float kerrMovingHit(vec3 start, vec3 end, vec3 c0, vec3 c1, vec3 axes) {
    vec3 relative = (start - c0) / axes;
    vec3 delta = ((end - start) - (c1 - c0)) / axes;
    float A = dot(delta, delta), B = dot(relative, delta), C = dot(relative, relative) - 1.0;
    float D = B * B - A * C;
    if (D < 0.0 || A <= 0.0) return -1.0;
    float near = (-B - sqrt(D)) / A, far = (-B + sqrt(D)) / A;
    float fraction = near >= 0.0 ? near : far;
    return fraction <= 1.0 ? fraction : -1.0;
  }

  float kerrWorldHit(vec3 start, vec3 end, vec3 c0, vec3 c1, float radius, float pixel, out float coverage) {
    vec3 relative = start - c0, delta = (end - start) - (c1 - c0);
    float A = dot(delta, delta), B = dot(relative, delta), C = dot(relative, relative);
    coverage = 0.0;
    if (A <= 0.0) return -1.0;
    float perpendicular = sqrt(max(0.0, C - B * B / A));
    coverage = 1.0 - smoothstep(radius - pixel * 0.5, radius + pixel * 0.5, perpendicular);
    float root = sqrt(max(0.0, B * B - A * (C - radius * radius)));
    float near = (-B - root) / A, far = (-B + root) / A;
    float fraction = near >= 0.0 ? near : far;
    return coverage > 0.0 && fraction >= 0.0 && fraction <= 1.0 ? fraction : -1.0;
  }

  vec3 kerrWorldLight(int world, vec3 x, vec3 center, vec3 direction, float g, float footprint) {
    vec3 normal = normalize(x - center);
    float terrain = 0.65 * skyNoise(normal * 2.0 + 7.3, footprint * 2.0)
      + 0.35 * skyNoise(normal * 4.0 - 3.1, footprint * 4.0);
    vec3 albedo = uWorldTint[world] * mix(0.78, 1.06, terrain);
    float lambert = max(0.0, dot(normal, -normalize(x)));
    float radius = length(x);
    float falloff = (1.0 + pow(6.0 / uWorldLightRadius, 2.0)) / (1.0 + pow(radius / uWorldLightRadius, 2.0));
    float limb = pow(1.0 - max(0.0, dot(normal, -direction)), 10.0);
    vec3 light = albedo * (0.012 + blackbody(uTemperature * g) * falloff * (1.25 * lambert + 0.045 * limb)) * pow(g, 3.0);
    return light / max(1.0, max(light.r, max(light.g, light.b)) / 1.05);
  }

  bool kerrProbeAt(float time, out vec3 x, out vec4 u, out float tau) {
    x = vec3(0.0); u = vec4(0.0); tau = 0.0;
    if (uKerrProbeCount < 2 || time < uKerrProbeEvent[0].w || time > uKerrProbeEvent[uKerrProbeCount - 1].w) return false;
    int low = 0, high = uKerrProbeCount - 1;
    for (int j = 0; j < 6; j++) {
      if (high - low <= 1) break;
      int mid = (low + high) / 2;
      if (uKerrProbeEvent[mid].w <= time) low = mid; else high = mid;
    }
    vec4 a = uKerrProbeEvent[low], b = uKerrProbeEvent[high];
    vec4 ua = uKerrProbeU[low], ub = uKerrProbeU[high];
    float dt = b.w - a.w, s = clamp((time - a.w) / dt, 0.0, 1.0);
    x = (2.0 * s * s * s - 3.0 * s * s + 1.0) * a.xyz
      + (s * s * s - 2.0 * s * s + s) * dt * ua.yzw / ua.x
      + (-2.0 * s * s * s + 3.0 * s * s) * b.xyz + (s * s * s - s * s) * dt * ub.yzw / ub.x;
    u = mix(ua, ub, s);
    tau = mix(uKerrProbeTau[low], uKerrProbeTau[high], s);
    return true;
  }

  float kerrProbeShift(vec3 p, float pt, vec4 u) {
    return 1.0 / (pt * u.x + dot(p, u.yzw));
  }

  vec3 kerrProbeLight(float g, float tau) {
    vec3 red = vec3(1.0, 0.018, 0.002), amber = vec3(1.0, 0.32, 0.025), cyan = vec3(0.65, 0.92, 1.0);
    vec3 color = g < 0.5 ? mix(red, amber, smoothstep(0.02, 0.5, g)) : mix(amber, cyan, smoothstep(0.5, 0.95, g));
    float pulse = 1.0 - smoothstep(0.0, 0.22, fract(tau));
    vec3 light = color * max(pow(g, 3.0), 0.045) * (1.4 + 2.0 * pulse);
    return light / max(1.0, max(light.r, max(light.g, light.b)) / 1.05);
  }

  vec3 kerrTail(vec3 x, vec3 p, float pt, float a) {
    float rho = length(x);
    vec3 radial = x / rho;
    float b = length(cross(x, p)) / abs(pt);
    if (b < 1e-7) return radial;
    vec3 velocity, force;
    kerrFlow(x, p, pt, a, velocity, force);
    vec3 tangent = normalize(velocity - dot(velocity, radial) * radial);
    float angle = escapeAngle(1.0 / rho, b);
    return normalize(radial * cos(angle) + tangent * sin(angle));
  }

  vec3 kerrDisk(vec3 x, vec3 p, float pt, float a, float pixel, vec3 velocity) {
    float r = kerrRadius(x, a);
    if (r < uKerrInner || r > 8.6) return vec3(0.0);
    float omega = sqrt(0.5) / (pow(r, 1.5) + a * sqrt(0.5));
    float ut = (pow(r, 1.5) + a * sqrt(0.5))
      / (pow(r, 0.75) * sqrt(pow(r, 1.5) - 1.5 * sqrt(r) + 2.0 * a * sqrt(0.5)));
    float lz = x.x * p.y - x.y * p.x;
    // The local past-ray energy is one; g > 1 raises temperature and radiance.
    float g = 1.0 / (ut * (pt + omega * lz));
    float angle = atan(x.y, x.x);
    vec3 ray = normalize(velocity);
    float incidence = max(abs(ray.z), 0.001);
    float footprint = pixel / max(abs(ray.z), 0.035);
    float age = mod(uTime, 16.0);
    float blend = 0.5 - 0.5 * cos(age * (2.0 * PI / 16.0));
    // Sampling phi - Omega t advects the gas in the prograde velocity direction.
    vec2 gas = mix(gasPattern(r, angle, -mod(uTime + 8.0, 16.0) * omega, ray.xy, incidence, pixel),
      gasPattern(r, angle, -age * omega, ray.xy, incidence, pixel), blend);
    float aa = max(footprint * 0.5, 0.003);
    float edge = smoothstep(uKerrInner, uKerrInner + aa, r)
      * (1.0 - smoothstep(7.1 - aa, 8.35 + aa, r));
    float density = gas.y * mix(1.0, 0.12 + 1.8 * gas.x * gas.x, smoothstep(6.5, 8.3, r));
    float radial = pow(uKerrInner / r, 2.35);
    float rimWidth = max(0.13, footprint);
    float hotEdge = exp(-pow((r - uKerrInner - 0.14) / rimWidth, 2.0)) * 0.24 * 0.13 / rimWidth;
    float grazing = 1.0 + 0.32 * pow(1.0 - abs(ray.z), 3.0);
    return blackbody(uTemperature * pow(uKerrInner / r, 0.62) * g)
      * (radial * density + hotEdge) * edge * pow(g, 3.0) * grazing * 1.75 * uDiskIntensity;
  }

  void main() {
    vec2 screen = (vUv * 2.0 - 1.0) + uScreenOffset * 2.0;
    screen.x *= uResolution.x / uResolution.y;
    vec3 initialRay = normalize(uCameraForward + tan(${G.halfFov}) * (screen.x * uCameraRight + screen.y * uCameraUp));
    vec3 n = vec3(dot(initialRay, normalize(uCameraPosition)), dot(initialRay, uKerrScenePolar), dot(initialRay, uKerrSceneAzimuth));
    vec4 momentum = -uKerrObserver + n.x * uKerrRadial + n.y * uKerrPolar + n.z * uKerrAzimuth;
    vec3 x = uKerrPosition, p = momentum.yzw;
    float pt = momentum.x, a = uSpin * 0.5;
    float rp = 0.5 + sqrt(0.25 - a * a);
    int limit = uQuality < 0.5 ? ${K.performanceSteps} : (uQuality < 1.5 ? ${K.balancedSteps} : ${K.highSteps});
    float c = uQuality < 0.5 ? ${K.performanceC} : (uQuality < 1.5 ? ${K.balancedC} : ${K.highC});
    float pixelAngle = ${2 * Math.tan(G.halfFov)} / uResolution.y;
    vec3 light = vec3(0.0), outgoing = initialRay;
    float transmittance = 1.0, rayTime = 0.0;
    bvec2 seenWorld = bvec2(false);
    bool seenProbe = false;
    bool escaped = false;
    int hits = 0;
    for (int i = 0; i < ${K.highSteps}; i++) {
      if (i >= limit) break;
      float r = kerrRadius(x, a);
      if (r < rp + ${K.epsilon}) break;
      vec3 velocity, force;
      kerrFlow(x, p, pt, a, velocity, force);
      if (r > ${K.outerRadius.toFixed(1)} && dot(x, velocity) > 0.0) {
        // KS (X,Y,Z) = scene (z,x,y), preserving the prograde orientation.
        outgoing = kerrTail(x, p, pt, a).yzx;
        escaped = true;
        break;
      }
      vec3 previous = x, previousP = p;
      float previousTime = rayTime;
      float h = min(c * (r - rp), ${K.stepBound.toFixed(1)});
      kerrStep(x, p, rayTime, pt, a, h);
      float diskFraction = -1.0;
      if (uLayers.x > 0.5 && previous.z * x.z < 0.0 && hits < 3) {
        float t = previous.z / (previous.z - x.z);
        float radius = kerrRadius(mix(previous, x, t), a);
        if (radius >= uKerrInner && radius <= 8.6) diskFraction = t;
      }
      vec2 worldFraction = vec2(-1.0);
      vec2 worldCoverage = vec2(0.0);
      for (int j = 0; j < 2; j++) {
        if (j >= uWorldCount || seenWorld[j]) continue;
        vec3 c0 = kerrWorldCenter(uKerrWorldOrbit[j], uKerrWorldPhase[j], previousTime, a);
        vec3 c1 = kerrWorldCenter(uKerrWorldOrbit[j], uKerrWorldPhase[j], rayTime, a);
        float pixel = distance(uKerrPosition, mix(c0, c1, 0.5)) * pixelAngle / uKerrLapse;
        worldFraction[j] = kerrWorldHit(previous, x, c0, c1, uWorldRadius[j], pixel, worldCoverage[j]);
      }
      float probeFraction = -1.0;
      vec3 pc0, pc1; vec4 pu0, pu1; float tau0, tau1;
      if (uLayers.w > 0.5 && !seenProbe && uKerrProbeCount > 1) {
        bool valid0 = kerrProbeAt(max(previousTime, uKerrProbeEvent[0].w), pc0, pu0, tau0);
        bool valid1 = kerrProbeAt(max(rayTime, uKerrProbeEvent[0].w), pc1, pu1, tau1);
        if (valid0 && valid1 && previousTime >= uKerrProbeEvent[0].w) {
          vec3 radial = normalize(pc0);
          vec3 side = normalize(cross(radial, vec3(0.0, 0.001, 1.0)));
          vec3 up = cross(side, radial);
          vec3 q0 = previous - pc0, q1 = x - pc1;
          vec3 local0 = vec3(dot(q0, side), dot(q0, up), dot(q0, radial));
          vec3 local1 = vec3(dot(q1, side), dot(q1, up), dot(q1, radial));
          float worldPixel = distance(uKerrPosition, pc0) * pixelAngle * (1.0 / uKerrLapse);
          float hullScale = min(1.0, worldPixel * 9.0 / 0.15);
          float hull = kerrMovingHit(local0, local1, vec3(0.0), vec3(0.0), vec3(0.035, 0.025, 0.13) * hullScale);
          float wing = kerrMovingHit(local0, local1, vec3(0.0), vec3(0.0), vec3(0.15, 0.014, 0.027) * hullScale);
          probeFraction = hull >= 0.0 && wing >= 0.0 ? min(hull, wing) : max(hull, wing);
        }
      }
      // Process all crossings in ray order, including bodies on either side of the disk chord.
      for (int crossingIndex = 0; crossingIndex < 4; crossingIndex++) {
        float nearest = 2.0; int kind = -1;
        if (diskFraction >= 0.0) { nearest = diskFraction; kind = 0; }
        for (int j = 0; j < 2; j++) {
          if (worldFraction[j] >= 0.0 && worldFraction[j] < nearest) { nearest = worldFraction[j]; kind = j + 1; }
        }
        if (probeFraction >= 0.0 && probeFraction < nearest) { nearest = probeFraction; kind = 3; }
        if (kind < 0) break;
        vec3 crossing = mix(previous, x, nearest), crossingP = mix(previousP, p, nearest);
        float time = mix(previousTime, rayTime, nearest);
        if (kind == 0) {
          float pixel = pixelAngle * length(uCameraPosition) * (1.0 / uKerrLapse);
          vec3 emission = kerrDisk(crossing, crossingP, pt, a, pixel, velocity);
          light += emission * transmittance;
          transmittance *= exp(-18.0 * length(emission));
          hits++; diskFraction = -1.0;
        } else if (kind == 3) {
          vec3 center; vec4 u; float tau;
          if (kerrProbeAt(time, center, u, tau)) {
            float g = kerrProbeShift(crossingP, pt, u);
            if (g >= 0.02) {
              light += kerrProbeLight(g, tau) * transmittance;
              transmittance = 0.0;
            }
          }
          seenProbe = true; probeFraction = -1.0;
        } else {
          int world = kind - 1;
          vec3 c0 = kerrWorldCenter(uKerrWorldOrbit[world], uKerrWorldPhase[world], previousTime, a);
          vec3 c1 = kerrWorldCenter(uKerrWorldOrbit[world], uKerrWorldPhase[world], rayTime, a);
          vec3 center = mix(c0, c1, nearest);
          float g = kerrWorldShift(crossing, crossingP, pt, uKerrWorldOrbit[world], a);
          float footprint = distance(uKerrPosition, center) * pixelAngle / (uKerrLapse * uWorldRadius[world]);
          light += kerrWorldLight(world, crossing, center, normalize(x - previous), g, footprint) * transmittance * worldCoverage[world];
          transmittance *= 1.0 - worldCoverage[world];
          seenWorld[world] = true; worldFraction[world] = -1.0;
        }
      }
      // Continue vacuum integration behind opaque surfaces: neighbouring sky
      // derivatives must use the same outgoing rays with worlds/probe on or off.
    }
    // Derivatives are evaluated after all lanes rejoin, including captured rays.
    vec3 skyRay = normalize(outgoing);
    vec3 background = observedSky(skyRay, dFdx(skyRay), dFdy(skyRay), pixelAngle, 1.0 / abs(pt));
    if (escaped) light += background * transmittance;
    float vignette = 1.0 - smoothstep(0.35, 1.9, length(vUv * 2.0 - 1.0)) * 0.18;
    gl_FragColor = vec4(light * vignette, 1.0);
  }
`;
