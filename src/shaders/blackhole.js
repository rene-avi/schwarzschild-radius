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
  uniform vec3 uCameraTarget;
  uniform float uTemperature;
  uniform float uSpin;
  uniform float uTilt;
  uniform float uLensing;
  uniform float uQuality;
  uniform float uFly;
  uniform float uDiskIntensity;
  uniform vec3 uProbePosition;
  uniform float uProbeRadius;
  uniform float uProbeDilation;

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
    vec3 stars = vec3(0.0);
      for (int ix = -1; ix <= 1; ix++) {
        if (ix != 0 && uFly < 0.02) continue;
        vec2 shift = vec2(float(ix), 0.0);
        vec2 id = cell + shift;
        float h = hash21(id + seed);
        // Insets contain ordinary point sources in their own cell; only the
        // horizontal neighbors are needed when fly-in trails become long.
        vec2 center = 0.18 + 0.64 * vec2(hash21(id + 13.7 + seed), hash21(id + 41.3 + seed));
        vec2 delta = f - shift - center;
        // Radial elongation during a fly-in is applied in sky longitude.
        delta.x /= 1.0 + uFly * 7.0;
        float radius = max(0.024 + 0.034 * h, pixelAngle * density * 0.15);
        float core = exp(-dot(delta, delta) / (radius * radius));
        float rare = step(0.992, h);
        float halo = exp(-length(delta) * 24.0) * rare;
        float visible = step(0.80, h);
        vec3 tint = mix(vec3(0.48, 0.64, 0.90), vec3(1.0, 0.79, 0.53), hash21(id + 88.0));
        stars += tint * (core * (0.19 + rare * 1.6) + halo * 0.12) * visible;
    }
    return stars;
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
    float gravitationalShift = sqrt(max(0.01, 1.0 - 1.0 / r));
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

  vec3 probeEmission(vec3 origin, vec3 direction, float segmentLength) {
    if (uProbeRadius < 0.0 || distance(origin, uProbePosition) > segmentLength + 0.7) return vec3(0.0);
    vec3 radial = normalize(uProbePosition);
    vec3 side = normalize(cross(radial, vec3(0.0, 1.0, 0.001)));
    vec3 up = cross(side, radial);
    vec3 relative = origin - uProbePosition;
    vec3 localOrigin = vec3(dot(relative, side), dot(relative, up), dot(relative, radial));
    vec3 localDirection = vec3(dot(direction, side), dot(direction, up), dot(direction, radial));
    float stretch = min(4.0, 0.8 + 0.22 / max(uProbeDilation, 0.04));
    float hull = ellipsoidHit(localOrigin, localDirection, vec3(0.035, 0.025, 0.13 * stretch));
    float wing = ellipsoidHit(localOrigin, localDirection, vec3(0.15 / sqrt(stretch), 0.014, 0.027 * stretch));
    float hit = 0.0;
    if (hull > 0.0 && hull < segmentLength) hit = 1.0;
    if (wing > 0.0 && wing < segmentLength) hit = 1.0;
    vec3 color = mix(vec3(1.0, 0.055, 0.004), vec3(0.5, 0.88, 1.0), smoothstep(0.06, 0.8, uProbeDilation));
    return color * hit * (1.0 + uProbeDilation * 3.0);
  }

  vec3 acceleration(vec3 position, float angularMomentumSquared) {
    float r2 = dot(position, position);
    return -1.5 * uLensing * angularMomentumSquared * position / max(r2 * r2 * sqrt(r2), 0.01);
  }

  void main() {
    vec2 screen = (vUv * 2.0 - 1.0) + uScreenOffset * 2.0;
    screen.x *= uResolution.x / uResolution.y;
    vec3 forward = normalize(uCameraTarget - uCameraPosition);
    vec3 right = normalize(cross(forward, vec3(0.0, 1.0, 0.0)));
    vec3 up = cross(right, forward);
    vec3 initialRay = normalize(forward + tan(21.0 * PI / 180.0) * (screen.x * right + screen.y * up));
    vec3 position = uCameraPosition;
    vec3 velocity = initialRay;
    float pixelAngle = 0.768 / uResolution.y;
    vec3 angularMomentum = cross(position, velocity);
    float angularMomentumSquared = dot(angularMomentum, angularMomentum);
    float tilt = uTilt * PI / 180.0;
    vec3 normal = vec3(0.0, cos(tilt), -sin(tilt));
    vec3 light = vec3(0.0);
    float transmittance = 1.0;
    bool captured = false;
    int limit = uQuality < 0.5 ? 56 : (uQuality < 1.5 ? 72 : 88);
    float impact = sqrt(angularMomentumSquared);
    float vignette = 1.0 - smoothstep(0.35, 1.9, length(vUv * 2.0 - 1.0)) * 0.18;
    float sphereB = dot(position, velocity);
    float observerRadius = length(position);
    vec3 impactDirection = (position - velocity * sphereB) / max(impact, 0.0001);
    float finiteDistance = 1.0 - sphereB / observerRadius;
    float deflection = finiteDistance * uLensing / max(impact, 1.0)
      + (15.0 * PI / 32.0) * finiteDistance * uLensing * uLensing / max(impact * impact, 1.0);
    vec3 weakRay = normalize(velocity * cos(deflection) - impactDirection * sin(deflection));
    // Rays this far from the shadow cannot intersect the disk or released probe.
    // Second-order weak deflection retains star lensing without a full orbit.
    if (impact >= 12.0) {
      gl_FragColor = vec4(skyColor(weakRay, pixelAngle) * vignette, 1.0);
      return;
    }
    vec3 coronaColor = blackbody(uTemperature * 0.8) * uDiskIntensity * 0.01;

    // Skip the empty space before the integration volume for distant cameras.
    float sphereC = dot(position, position) - 28.0 * 28.0;
    float sphereD = sphereB * sphereB - sphereC;
    if (sphereC > 0.0 && sphereD > 0.0 && sphereB < 0.0) {
      position += velocity * max(0.0, -sphereB - sqrt(sphereD));
    }
    // Verlet's endpoint force becomes the next step's starting force. Reusing
    // it saves one force evaluation per ray step without changing the orbit.
    vec3 cachedAcceleration = acceleration(position, angularMomentumSquared);

    for (int i = 0; i < 88; i++) {
      if (i >= limit) break;
      float radius = length(position);
      if (radius < 1.015) { captured = true; break; }
      if (radius > 29.0 && dot(position, velocity) > 0.0) break;
      float stepSize = clamp(radius * (uQuality < 0.5 ? 0.19 : 0.15), 0.065, 2.8);
      // Velocity Verlet conserves the orbital plane and angular momentum well
      // enough to retain both disk crossings around the photon sphere.
      vec3 nextPosition = position + velocity * stepSize + cachedAcceleration * stepSize * stepSize * 0.5;
      vec3 nextAcceleration = acceleration(nextPosition, angularMomentumSquared);
      vec3 nextVelocity = velocity + (cachedAcceleration + nextAcceleration) * stepSize * 0.5;
      vec3 segment = nextPosition - position;
      float segmentLength = length(segment);

      float plane0 = dot(position, normal);
      float plane1 = dot(nextPosition, normal);
      if (plane0 * plane1 < 0.0) {
        float fraction = plane0 / (plane0 - plane1);
        vec3 crossing = mix(position, nextPosition, fraction);
        vec3 emission = diskEmission(crossing, velocity, normal);
        light += emission * transmittance;
        // An optically thin disk leaves secondary and tertiary images visible.
        transmittance *= mix(1.0, 0.48, smoothstep(0.01, 0.5, length(emission)));
      }
      if (uProbeRadius > 0.0) light += probeEmission(position, segment / segmentLength, segmentLength) * transmittance;
      // A faint finite-height corona softens the razor-thin disk without hiding
      // its turbulent individual filaments.
      if (radius < 8.5 && abs(plane0) < 0.7) {
        float coronaOffset = (radius - 4.1) / 2.0;
        float corona = exp(-abs(plane0) * 15.0) * exp(-coronaOffset * coronaOffset);
        light += coronaColor * corona * stepSize * transmittance;
      }
      position = nextPosition;
      velocity = nextVelocity;
      cachedAcceleration = nextAcceleration;
    }

    // Long-lived near-critical rays accumulate around r = 1.5 r_s.
    if (!captured && length(position) < 2.0) captured = true;
    if (!captured) {
      vec3 outgoing = normalize(mix(normalize(velocity), weakRay, smoothstep(10.0, 12.0, impact)));
      light += skyColor(outgoing, pixelAngle) * transmittance;
    }

    // Resolve the subpixel higher-order photon images analytically. The critical
    // impact parameter is sqrt(27)/2 r_s for the Schwarzschild photon sphere.
    float critical = uLensing > 0.6667 ? 2.598076 * uLensing : inversesqrt(max(1.0 - uLensing, 0.01));
    float ringWidth = max(0.016, pixelAngle * length(uCameraPosition) * 0.7);
    float ringOffset = (impact - critical) / ringWidth;
    float photonRing = exp(-ringOffset * ringOffset);
    float ringAzimuth = atan(screen.y, screen.x);
    float ringBeaming = 0.65 + 0.40 * cos(ringAzimuth + 0.1);
    light += blackbody(uTemperature * 1.16) * photonRing * ringBeaming * 0.95 * smoothstep(0.5, 0.9, uLensing) * uDiskIntensity;

    gl_FragColor = vec4(light * vignette, 1.0);
  }
`;
