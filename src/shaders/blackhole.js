import { GEODESIC as G } from '../geodesic.js';

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

  vec3 skyColor(vec3 ray, float pixelAngle) {
    ray = normalize(ray);
    vec3 dx = dFdx(ray), dy = dFdy(ray);
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
    return pixel * sqrt(dot(worldGradient, worldGradient) + along * along);
  }

  float flowFootprint(vec2 flow, vec2 shear, vec2 radial, vec2 rayPlane, float incidence, float pixel) {
    // Each lattice axis has its own projected gradient, including differential shear.
    vec2 tangent = vec2(-flow.y, flow.x);
    float x = projectedFootprint(vec2(flow.x + shear.x * tangent.x, shear.y * tangent.x), radial, rayPlane, incidence, pixel);
    float y = projectedFootprint(vec2(flow.y + shear.x * tangent.y, shear.y * tangent.y), radial, rayPlane, incidence, pixel);
    return max(x, y);
  }

  vec2 gasPattern(float r, float inner, float angle, float orbit, vec2 rayPlane, float incidence, float pixel) {
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
    // Constant-phase strands trail the flow, with a smaller pitch at the inner rim.
    vec2 winding = vec2(-22.0 - 8.0 * inner / r - 1.5 * orbit, 1.0)
      + r * vec2(dot(warpGradient, flow - 1.5 * orbit * tangent), dot(warpGradient, tangent));
    float woundAngle = angle + orbit - 22.0 * log(r / inner) - 8.0 * (1.0 - inner / r)
      + 0.12 * (clump - 0.5) + 0.025 * (eddy - 0.5);
    vec2 wound = vec2(cos(woundAngle), sin(woundAngle));
    float threadPixel = flowFootprint(wound, winding, radial, rayPlane, incidence, pixel);
    float filament = filteredNoise(r * wound * 0.7 + 21.8, threadPixel * 0.7);
    float threads = filteredNoise(r * wound * 1.6 - 11.3, threadPixel * 1.6);
    float fine = filteredNoise(r * wound * 3.5 + 4.2, threadPixel * 3.5);
    float lane = 1.0 - smoothstep(0.12, 0.3, filament);
    float bright = smoothstep(0.62, 0.85, threads);
    float density = (0.58 + clump * 0.65 + eddy * 0.3)
      * (0.36 + filament * 0.45 + threads * 0.7 + fine * 0.4 + bright * 0.32) * (1.0 - lane * 0.65);
    return vec2(filament, density);
  }

  vec3 diskEmission(vec3 position, vec3 ray, vec3 normal, float pixelFootprint) {
    float r = length(position);
    float inner = 2.95 - 0.35 * uSpin;
    float footprint = pixelFootprint / max(abs(dot(normalize(ray), normal)), 0.035);
    if (r < inner - footprint || r > 8.6 + footprint) return vec3(0.0);
    vec3 axisY = normalize(cross(normal, vec3(1.0, 0.0, 0.0)));
    vec2 p = vec2(position.x, dot(position, axisY));
    vec2 rayPlane = vec2(ray.x, dot(ray, axisY));
    float incidence = max(abs(dot(ray, normal)), 0.035);
    float angle = atan(p.y, p.x);
    float rate = (0.22 + uSpin * 0.08) / pow(r / 3.0, 1.5);
    // Renew eddies at zero blend weight so indefinite shear never erases all detail.
    float age = mod(uTime, 16.0);
    float blend = 0.5 - 0.5 * cos(age * (2.0 * PI / 16.0));
    vec2 gas = mix(gasPattern(r, inner, angle, mod(uTime + 8.0, 16.0) * rate, rayPlane, incidence, pixelFootprint),
      gasPattern(r, inner, angle, age * rate, rayPlane, incidence, pixelFootprint), blend);
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

  vec3 observedSky(vec3 ray, float pixelAngle, float observerShift) {
    if (uLayers.y < 0.5) return vec3(0.0);
    float gain = min(pow(observerShift, 0.75), 2.8);
    vec3 tint = mix(vec3(1.0), vec3(0.85, 0.96, 1.15), clamp((observerShift - 1.0) * 0.2, 0.0, 1.0));
    vec3 sky = skyColor(ray, pixelAngle);
    return min(sky * gain * tint, max(sky, vec3(1.8, 2.2, 2.8))) * uLayers.y;
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
    if (impact >= ${G.weakEnd.toFixed(1)}) {
      gl_FragColor = vec4(observedSky(weakRay, pixelAngle, 1.0 / lapse) * vignette, 1.0);
      return;
    }

    float tilt = uTilt * PI / 180.0;
    vec3 normal = vec3(0.0, cos(tilt), -sin(tilt));
    vec3 light = vec3(0.0);
    float transmittance = 1.0;
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
    vec3 velocity = coordinateRay;
    vec3 outgoing = initialRay;

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
      if (uLayers.x > 0.5 && plane0 * plane1 < 0.0) {
        float fraction = plane0 / (plane0 - plane1);
        vec3 crossing = mix(position, nextPosition, fraction);
        float diskPixel = pixelAngle * observerRadius / lapse * (1.0 + 0.2 / max(abs(impact - critical), 0.03));
        vec3 emission = diskEmission(crossing, velocity, normal, diskPixel);
        light += emission * transmittance;
        transmittance *= exp(-18.0 * length(emission));
      }
      if (uLayers.w > 0.5 && uProbeRadius > 0.0 && segmentLength > 0.0) light += probeEmission(position, segment / segmentLength, segmentLength) * transmittance;
      float radius = length(position);
      if (uLayers.x > 0.5 && radius < 8.5 && abs(plane0) < 0.7) {
        float coronaOffset = (radius - 4.1) / 2.0;
        float corona = exp(-abs(plane0) * 15.0) * exp(-coronaOffset * coronaOffset);
        light += coronaColor * corona * segmentLength * transmittance;
      }
      position = nextPosition;
      velocity = nextVelocity;
      orbitRadial = nextRadial;
      orbitTangent = nextTangent;
      outgoing = nextVelocity;
      u = nextU;
      v = nextV;
    }

    // Evaluate derivatives on both sides of the analytic boundary before coverage.
    outgoing = normalize(mix(outgoing, weakRay, smoothstep(${G.weakStart.toFixed(1)}, ${G.weakEnd.toFixed(1)}, impact)));
    vec3 background = observedSky(outgoing, pixelAngle, 1.0 / lapse);
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
