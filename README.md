# Event Horizon

A real-time black hole observatory built with Three.js, GLSL, and Vite. Orbit a turbulent accretion disk, approach the horizon, or release a probe and watch its signal redshift. The stars, galaxy, disk, ship, film grain, and HUD graphics are procedural. The application loads no external images, textures, models, fonts, or services.

## Run

### Open directly as a local HTML file

Open **`dist/index.html`** in Safari, Firefox, or Chromium. This production file contains all JavaScript and CSS, including Three.js; it can be copied or renamed and opened by double-click without a server, network connection, or neighboring asset files. The browser still needs WebGL 2 and hardware acceleration for smooth rendering.

When working from the source repository, generate that file first:

```sh
npm ci
npm run build
```

The repository's root `index.html` is a launcher: opening it locally forwards to `dist/index.html`, so keep the build directory next to it. To share the simulation, send the built `dist/index.html` alone.

The standalone file is approximately 530 KB. A small source `index.html` copied alone into Downloads is only the launcher and cannot find the simulation without its neighboring `dist/` directory. The complete file shows a startup panel before running any application code. If JavaScript is disabled, graphics initialization fails, or startup throws an error, it displays an explanation instead of leaving an empty page; share the text under **Startup details** when troubleshooting.

### Development server

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Vite prints the development-server address. For a production bundle:

```sh
npm test
npm run build
npm run preview
```

The same `dist/index.html` also works on a static web server, including in a subdirectory. Dependencies are version-pinned in `package-lock.json`; `npm ci` preserves that lockfile. No API keys or environment variables are required. Network access is needed for dependency installation, but the built application has no external asset requests.

Earlier builds used external ES modules and absolute `/assets/` paths, which required HTTP serving and could not be opened directly as files. The current build embeds a classic script after the page's DOM and all styles in the document head, avoiding local-file module and CORS restrictions.

## Explore

| Action | Control |
| --- | --- |
| Orbit | Drag the scene with the left mouse button; A/D also rotate |
| Zoom / thrust | Mouse wheel or W/S |
| Approach the horizon | **Fly in** or F; press again to stop approaching |
| Release / replace the probe | **Drop a probe** or P |
| Scripted cinematic orbit | **Cinematic** or C |
| Align the background star / Einstein ring | **Align a background star** or E |
| Hide / reveal the HUD | H |
| Pause / resume simulated time | Space or the clock's pause button |
| Reset camera, probe, and clock | **Orbit**, the logo, or R |
| Return to manual orbit | Escape; dragging or scrolling also restores manual control |
| Help | **Shortcuts**; `/` displays a compact control reminder |

Keyboard shortcuts are ignored while editing a control. Pause stops disk motion, the local clock, and the probe; the camera remains available. The camera stays outside the horizon, from 1.055 to 65 Schwarzschild radii. Cinematic mode follows a slow, repeating-height orbital path. Press H for a clean recording view and capture it with your browser or screen recorder; there is no built-in video encoder.

The HUD reports mass, Schwarzschild radius, observer distance, local proper time, probe dilation, frame rate, and current adaptive quality.

### Parameters and presets

| Parameter | Range | Meaning |
| --- | --- | --- |
| Mass | 10–1,000,000,000 solar masses, logarithmic | Physical size reported by the HUD |
| Spin | 0–0.99 | Artistic disk rotation, inner edge, and orbital-beaming adjustment |
| Disk temperature | 2,000–20,000 K | Reference emission temperature |
| Disk tilt | −70° to +70° | Disk-plane rotation relative to the scene |
| Lensing strength | 0–2× | Multiplier on ray deflection; 1× is the reference model |
| Time scale | 0–4× | Disk, clock, and probe simulation speed |

| Preset | Mass (M☉) | Spin | Temperature | Tilt | Lensing | Time scale |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Gargantua | 100,000,000 | 0.85 | 7,500 K | 8° | 1× | 1× |
| Sagittarius A* | 4,300,000 | 0.55 | 11,000 K | 18° | 1.15× | 0.8× |
| Quiet | 10 | 0.08 | 3,500 K | 4° | 0.85× | 0.25× |

The presets are visual studies, not measured accretion-disk reconstructions. Selecting one restores its settings and camera position. Editing a slider clears the active preset selection.

## Physics and rendering

### Scale and time dilation

The Schwarzschild horizon radius is

```text
rₛ = 2GM / c²
G = 6.67430 × 10⁻¹¹ m³ kg⁻¹ s⁻²
c = 299,792,458 m/s
M☉ = 1.98847 × 10³⁰ kg
```

One solar mass gives approximately 2.953 km. Scene lengths use `r / rₛ`, so changing mass updates the physical scale without changing the dimensionless image or camera framing. The animation rate is an artistic control and does not automatically scale with `GM/c³`.

A stationary clock outside the horizon ticks relative to a distant clock by

```text
dτ/dt = √(1 − rₛ/r)
```

The on-screen clock integrates this factor at the observer's radius. Approaching the horizon visibly slows it. The utility returns zero at or inside the horizon as a display limit; a stationary observer cannot physically exist there. Moving observers and freely falling clocks require additional velocity and trajectory calculations, which this visualization does not solve.

### Curved rays, disk images, and the photon ring

Each fragment launches a ray from the orbiting camera and integrates its curved path with velocity Verlet steps. In units where `rₛ = 1`, the ray model uses

```text
L² = |x × v|²
d²x/dλ² = −(3/2) × lensing × L² × x / |x|⁵
```

This central-force form approximates Schwarzschild null-ray bending in the ray's orbital plane. Finite integration steps, finite ray budgets, and the tunable lensing multiplier make it a real-time visualization rather than a precision relativistic ray tracer. Rays that reach `1.015 rₛ` are captured; escaping rays sample the procedural sky.

Disk-plane crossings accumulate optically thin emission. A bent ray can cross the disk more than once, revealing its far side above and below the central shadow. Layered noise and animated radial filaments supply turbulence. A faint procedural corona softens the thin disk.

The Schwarzschild photon sphere lies at `1.5 rₛ`; its critical impact parameter is `√27/2 × rₛ ≈ 2.598 rₛ`. An analytical narrow glow supplements unresolved higher-order images around this critical boundary. This photon ring is distinct from a background star's Einstein ring.

Despite the spin control, the spacetime remains **Schwarzschild**, not Kerr. Spin changes the disk's visual motion, inner edge, and beaming; it does not implement frame dragging or a rotating event horizon.

### Doppler beaming and color

For an emitter moving at `β = v/c`, the relativistic Doppler factor is

```text
δ = √(1 − β²) / (1 − β cos θ)
```

Here `cos θ = +1` means motion toward the observer. The approaching disk is brighter and shifted toward blue; the receding side is dimmer and shifted toward red. The shader multiplies specific intensity by `δ³` and shifts the reference color temperature by `δ √(1 − rₛ/r)`. Bolometric intensity would use `δ⁴`; the displayed RGB colors are a smooth artistic blackbody approximation, not a spectrally integrated radiative-transfer calculation.

### Stars, galaxy, and alignment

Hashed angular cells create point stars; fractal noise creates the galaxy band and dust. Both are evaluated at the **bent outgoing ray**, so the background visibly warps as the camera moves. A brighter directional star at `normalize(0, −5.8, −21)` provides an alignment target: orbit until the black hole lies between the observer and that direction to obtain an Einstein-ring configuration. The default camera is near this axis. Its visibility depends on alignment, disk emission, and render resolution; the star ring is produced by ray bending rather than a separately drawn circle.

Fly-in mode elongates the procedural stars as a cinematic cue. This streaking is an artistic approximation, not a complete relativistic aberration or exposure model.

### The probe

The ship is constructed from intersected procedural hull and wing ellipsoids. Its observer-facing radius follows

```text
r(t)/rₛ = 1.015 + (7 − 1.015) exp(−0.23t)
```

It stretches along its radial direction and fades toward red as its displayed dilation decreases. The animation freezes when it is within `0.003 rₛ` of the `1.015 rₛ` visual limit, after roughly 33 observer seconds at 1× speed. This is an illustrative depiction of coordinate-time freezing, not an exact timelike geodesic or a simulation of tidal structural failure. Its proper-time accumulator uses the stationary-clock factor, so it should not be interpreted as a physical freefall clock.

### Post-processing and performance

Three.js bloom spreads bright emission. A final pass applies an ACES-style tone curve, display gamma, vignette, and subtle procedural film grain. All intermediate images are generated render targets.

The target is 60 fps on a hardware-accelerated desktop browser. Render resolution is capped independently of display DPI. Sustained frame rates below **50 fps** reduce render scale and ray budgets; 12 seconds at 58 fps or above allow recovery. Quality uses 88, 72, or 56 integration steps, with a scale floor of 40%, and hysteresis avoids repeated switching at a threshold. Distant sky rays use a smoothly blended weak-deflection approximation. The HUD reports the active mode.

Actual performance depends on GPU, resolution, driver, browser, and other workloads. The quality floor preserves a useful image but cannot guarantee 60 fps on every machine; software WebGL renderers can be substantially slower. Reducing the browser window size can help when recording on a limited GPU.

## Code and checks

```text
src/main.js                 Application loop, actions, telemetry, adaptive quality
src/scene.js                Three.js render pipeline, uniforms, bloom, resolution
src/shaders/blackhole.js    Ray integration, disk, stars, galaxy, probe
src/shaders/post.js         Tone mapping and film grain
src/physics.js              Physical utilities, presets, probe trajectory
src/camera.js               Orbit, zoom, fly-in, scripted cinematic path
src/ui.js                   Controls, keyboard help, live readouts
src/style.css               HUD layout and responsive styling
build/standalone.js         Single-file HTML build and source-entry conversion
tests/physics.test.js       Units, limiting cases, Doppler shifts, probe behavior
tests/presets.test.js       Complete, bounded, immutable preset configurations
tests/standalone.test.js    Actual build portability and classic-script regression
```

`npm test` runs physics, preset, and standalone-build tests with Node's built-in test runner, using `--test-isolation=none` so the full suite also executes in the managed cloud runtime. Tests cover the known solar Schwarzschild radius, scale invariance, horizon/infinity time-dilation limits, approaching/receding/transverse Doppler shifts, invalid inputs, probe descent and pause behavior, and preset completeness and immutability. The build regression compiles the actual application into a temporary directory and checks that only one HTML file remains, with embedded styles and JavaScript that parses as a classic script. GLSL compilation still requires a WebGL-capable browser.

For a manual rendering check, confirm a luminous disk and dark shadow, orbit to reveal the secondary disk image, compare the bright and dim sides, switch all presets, release a probe, and try fly-in and cinematic modes. Monitor the console for shader errors and the HUD for frame rate. `window.eventHorizon.getState()` exposes a copy of the current simulation telemetry for browser automation without allowing direct mutation.

### Validation in the cloud environment

A clean `npm ci`, all 19 unit tests, and the production build passed. The production bundle was opened in Chromium and passed 26 browser checks: all presets and sliders, orbit/zoom, fly-in dilation, cinematic mode, pause, HUD hiding, responsive controls, automatic quality reduction, and the probe reaching its frozen state. No JavaScript/GLSL errors or external asset requests were observed. The lensed disk and aligned background star's Einstein ring were visually inspected.

The initial Chromium checks used ANGLE/SwiftShader software rendering, reaching about 13 fps at the tested 640×480 viewport after adaptive scaling; larger views were slower. **60 fps on a hardware-accelerated desktop remains to be benchmarked.** These checks validate rendering and interactions, not that performance target.

For the local-file compatibility fix, all **20 tests** and the standalone production build passed. Firefox ESR 140 opened and rendered all three entry paths directly over `file://`: the built page, the root launcher's redirect, and an independent copy in a directory containing spaces. Each had an advancing clock, no JavaScript/GLSL errors, and no subresource requests. Rendering used Mesa software graphics. Chromium also rendered the embedded page offline on an opaque origin; both Vite development and production HTTP serving were rechecked. Direct file navigation is blocked by this cloud Chromium's administrator policy, so that specific check used Firefox. Actual Safari/macOS is not available in this Linux environment.
