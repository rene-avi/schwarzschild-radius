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

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + 1.0), f.x), f.y);
  }

  float fbm(vec2 p) {
    float n = noise(p) * 0.57;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    n += noise(p + 7.3) * 0.28;
    n += noise(p * 2.1 - 8.7) * 0.15;
    return n;
  }

  // Smooth artistic black-body fit; the Doppler factor shifts the temperature.
  vec3 blackbody(float kelvin) {
    float t = clamp(kelvin / 6500.0, 0.15, 5.0);
    vec3 low = mix(vec3(1.0, 0.085, 0.012), vec3(1.0, 0.56, 0.19), smoothstep(0.15, 0.7, t));
    vec3 warm = mix(low, vec3(1.0, 0.91, 0.74), smoothstep(0.55, 1.15, t));
    return mix(warm, vec3(0.55, 0.74, 1.0), smoothstep(1.2, 3.0, t));
  }

  // Equal angular cells on a sphere: tiny point sources evaluated at the bent ray.
  vec3 starLayer(vec2 sky, float density, float seed, float pixelAngle) {
    vec2 grid = sky * vec2(density * 2.0, density);
    vec2 cell = floor(grid);
    vec2 f = fract(grid);
    float h = hash21(cell + seed);
    vec2 center = 0.18 + 0.64 * vec2(hash21(cell + 13.7 + seed), hash21(cell + 41.3 + seed));
    vec2 delta = f - center;
    float radius = max(0.024 + 0.034 * h, pixelAngle * density * 0.15);
    float core = exp(-dot(delta, delta) / (radius * radius));
    float rare = step(0.992, h);
    float halo = exp(-length(delta) * 24.0) * rare;
    float visible = step(0.80, h);
    vec3 tint = mix(vec3(0.48, 0.64, 0.90), vec3(1.0, 0.79, 0.53), hash21(cell + 88.0));
    return tint * (core * (0.19 + rare * 1.6) + halo * 0.12) * visible;
  }

  vec3 skyColor(vec3 ray, float pixelAngle) {
    ray = normalize(ray);
    vec2 sky = vec2(atan(ray.z, ray.x) / (2.0 * PI) + 0.5, asin(clamp(ray.y, -1.0, 1.0)) / PI + 0.5);
    vec3 galaxyNormal = normalize(vec3(-0.32, 0.80, 0.31));
    float latitude = abs(dot(ray, galaxyNormal));
    float cloud = fbm(sky * vec2(28.0, 18.0));
    float detail = fbm(sky * vec2(83.0, 45.0) + 5.7);
    float band = exp(-latitude * latitude * 38.0);
    float dust = smoothstep(0.28, 0.75, cloud + detail * 0.28);
    vec3 skyLight = vec3(0.0016, 0.0022, 0.0038);
    skyLight += mix(vec3(0.018, 0.022, 0.036), vec3(0.08, 0.058, 0.045), detail) * band * dust * 0.47;
    skyLight += starLayer(sky, 135.0, 3.1, pixelAngle);
    skyLight += starLayer(sky, 245.0, 19.2, pixelAngle) * 0.28;

    // A real directional background source: alignment turns its point image into
    // an Einstein ring through the same ray integration as every other star.
    vec3 alignmentStar = normalize(vec3(0.0, -5.8, -21.0));
    float alignmentDistance = length(cross(ray, alignmentStar));
    float aligned = exp(-pow(alignmentDistance / 0.0028, 2.0)) * step(0.0, dot(ray, alignmentStar));
    skyLight += vec3(0.72, 0.83, 1.0) * aligned * 3.5;
    return skyLight;
  }

  vec3 diskEmission(vec3 position, vec3 ray, vec3 normal) {
    float r = length(position);
    float inner = 2.95 - 0.35 * uSpin;
    float edge = smoothstep(inner, inner + 0.24, r) * (1.0 - smoothstep(7.0, 8.3, r));
    if (edge <= 0.0) return vec3(0.0);
    vec3 axisY = normalize(cross(normal, vec3(1.0, 0.0, 0.0)));
    vec2 p = vec2(position.x, dot(position, axisY));
    float angle = atan(p.y, p.x);
    float orbit = uTime * (0.22 + uSpin * 0.08) / pow(r / 3.0, 1.5);
    vec2 fluid = vec2(r * 4.0, (angle + orbit) * 2.5);
    float turbulence = fbm(fluid + vec2(0.0, noise(fluid * 0.7)));
    float filament = sin(r * 49.0 + turbulence * 13.0 + sin(angle * 5.0 + orbit) * 0.6);
    float fine = sin(r * 113.0 - turbulence * 9.0 + angle * 3.0);
    float threads = 0.55 + 0.32 * filament + 0.13 * fine;
    float density = (0.58 + turbulence * 0.82) * (0.62 + threads * 0.6);
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
    float hotEdge = exp(-(r - inner - 0.24) * (r - inner - 0.24) * 10.0) * 0.30;
    return color * (radial * density + hotEdge) * edge * pow(doppler, 3.0) * grazing * 1.45 * uDiskIntensity;
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
    return along >= 0.0 && along < segmentLength ? exp(-offset * offset * 0.5) : 0.0;
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
    return exp(-p.x * 0.28 - p.y * 2.4) + exp(-p.y * 0.28 - p.x * 2.4);
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
    return light;
  }

  vec3 observedSky(vec3 ray, float pixelAngle, float observerShift) {
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
        vec3 emission = diskEmission(crossing, velocity, normal);
        light += emission * transmittance;
        transmittance *= mix(1.0, 0.48, smoothstep(0.01, 0.5, length(emission)));
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

    if (!captured) {
      outgoing = normalize(mix(outgoing, weakRay, smoothstep(${G.weakStart.toFixed(1)}, ${G.weakEnd.toFixed(1)}, impact)));
      light += observedSky(outgoing, pixelAngle, 1.0 / lapse) * transmittance;
    }
    float ringWidth = max(0.016, pixelAngle * observerRadius / lapse * 0.7);
    float ringOffset = (impact - critical) / ringWidth;
    float photonRing = exp(-ringOffset * ringOffset);
    float ringAzimuth = atan(screen.y, screen.x);
    float ringBeaming = 0.65 + 0.40 * cos(ringAzimuth + 0.1);
    bool ringSide = observerRadius >= photonSphere ? mu >= 0.0 : mu <= 0.0;
    if (ringSide) light += blackbody(uTemperature * 1.16) * photonRing * ringBeaming * 0.95
      * smoothstep(0.5, 0.9, uLensing) * uDiskIntensity * uLayers.z;
    gl_FragColor = vec4(light * vignette, 1.0);
  }
`;
