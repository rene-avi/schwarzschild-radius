# Event Horizon

Insired by https://www.reddit.com/r/DeepSeek/comments/1xf0vlu/deepseek_v41_flash_built_an_interstellarstyle/

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

### GitHub Pages

The publication target is **https://rene-avi.github.io/schwarzschild-radius/**. The site becomes available after a successful **Deploy Event Horizon to GitHub Pages** workflow run; a saved workflow alone does not mean it is live.

The workflow in `.github/workflows/pages.yml` runs on pushes to `main` and can also be started manually from GitHub Actions. It installs the locked dependencies with Node.js 24, runs the tests, builds `dist/`, and deploys that directory. In the repository's **Settings → Pages**, the deployment source must be **GitHub Actions**. Deployment uses GitHub's built-in token and requires no additional secrets. Open the resulting HTTPS address directly in Safari or Chrome on a phone, avoiding local-file preview limitations.

## Explore

| Control | Action |
| --- | --- |
| C | Toggle cinematic flight |
| F | Toggle horizon approach |
| P | Release or replace probe |
| Space | Pause or resume simulation |
| R | Reset camera, probe and clock |
| E | Align a background star |
| H | Hide or reveal HUD |
| Escape | Return to manual orbit |
| W | Thrust inward |
| S | Thrust outward |
| A | Rotate left |
| D | Rotate right |
| / | Toggle shortcuts and control reminder |

Drag the scene with the left mouse button to orbit, and use the mouse wheel to zoom; both restore manual orbit. The dock, logo, clock, Cinematic, alignment and Shortcuts buttons provide the corresponding actions above.

Shortcuts work while a range slider has focus. Arrow keys, Home, End, PageUp and PageDown retain native slider behavior; Space on a focused button activates only that button. Text inputs, textareas, selects and editable text retain their keys. Pause stops disk motion, the local clock, and the probe; the camera remains available. The camera stays outside the horizon, from 1.055 to 65 Schwarzschild radii. Cinematic mode follows a slow, repeating-height orbital path. Press H for a clean recording view and capture it with your browser or screen recorder; there is no built-in video encoder.

The help dialog lists every shortcut; the one-line reminder shows C, F, P, Space and R. While help is open, other shortcuts and camera keys are ignored. Escape closes the dialog natively without changing camera mode; `/` also closes it.

The HUD reports mass, Schwarzschild radius, observer distance, local proper time, probe dilation, frame rate, and quality mode and scale. At widths of 760 px or less the panel starts closed and its toggle opens it. Above 760 px the panel is always visible. Crossing that breakpoint restores the new layout's default state.

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

The presets are visual studies, not measured accretion-disk reconstructions. Selecting one restores its settings and camera position. Parameters that differ from the selected preset clear its pressed state and show “Custom parameters” while retaining its name. Returning all parameters to that preset restores its description and pressed state.

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

The target is 60 fps on a hardware-accelerated desktop browser. Render resolution is capped independently of display DPI. **Auto** quality starts at 100% scale. Three seconds of measured rates below 50 fps trigger a 12 percentage point reduction. If throughput does not improve by at least 12% during the following measurement, a second reduction is tried where the 40% floor allows it: vsync can hide the first gain. If the available trials do not improve throughput, the pre-probe scale is restored and the observed rate is remembered as a frame cap. Further reductions target 85% of that cap; a rate more than 20% above it clears the cap. Twelve seconds at 58 fps (or 97% of a known cap) allow recovery; a failed upward trial waits 60 seconds before another attempt. Long frame gaps reset the measurement without changing quality.

The **Quality** control also offers fixed **High** (100%), **Balanced** (76%) and **Performance** (52%) modes, which disable adaptation. High uses 88 integration steps, Balanced 72, and Performance 56. Auto uses those same budgets at scales of at least 90%, at least 60%, and below 60%, respectively, with a floor of 40%. Returning to Auto starts again at 100%. The status bar reads, for example, `AUTO · HIGH · 100%` or `FIXED · BALANCED · 76%`. Distant sky rays use a smoothly blended weak-deflection approximation.

Actual performance depends on GPU, resolution, driver, browser, and other workloads. The quality floor preserves a useful image but cannot guarantee 60 fps on every machine; software WebGL renderers can be substantially slower. Reducing the browser window size can help when recording on a limited GPU.

## Code and checks

```text
src/main.js                 Application loop, actions, telemetry, quality application
src/quality.js              Pure adaptive controller and fixed quality modes
src/shortcuts.js            Shared shortcut table and keyboard focus policy
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
tests/quality.test.js       Simulated caps, GPU limits, hitches, suspension, fixed modes
tests/shortcuts.test.js     Keyboard focus policy and README shortcut consistency
tests/run.mjs               Named in-process Node test runner
tests/browser/run.mjs       Standalone Chromium interaction checks
```

`npm test` runs every `tests/*.test.js` through `node tests/run.mjs`, using Node's programmatic test API in one process. It prints `TOTAL <n> pass <p> fail <f>` and fails if any test fails or none run. Tests cover physics, presets, shortcut policy and documentation, and at least 120 simulated seconds per quality device scenario, without wall-clock performance thresholds. The build regression compiles the actual application under `tmp/` and checks that only one HTML file remains, with embedded styles and JavaScript that parses as a classic script.

`npm run test:browser` builds a standalone file under `tmp/`, serves it on an ephemeral localhost port and runs all modules in `tests/browser/checks/` with the installed Playwright Chromium. No browser downloads are performed. It checks responsive controls, keyboard focus behavior, custom parameters, complete help, fixed quality modes, console errors and foreign requests. Failed checks save screenshots in `tests/browser/out/`; review screenshots at 375 px and the quality panel on a real GPU for visual acceptance.

For a manual rendering check, confirm a luminous disk and dark shadow, orbit to reveal the secondary disk image, compare the bright and dim sides, switch all presets, release a probe, and try fly-in and cinematic modes. Monitor the console for shader errors and the HUD for frame rate. `window.eventHorizon.getState()` exposes a copy of the current simulation telemetry for browser automation without allowing direct mutation, including `qualityMode` (`auto`, `high`, `balanced`, `performance`) and `frameCap` (fps or `null`).

### Validation in the cloud environment

A clean `npm ci`, all 19 unit tests, and the production build passed. The production bundle was opened in Chromium and passed 26 browser checks: all presets and sliders, orbit/zoom, fly-in dilation, cinematic mode, pause, HUD hiding, responsive controls, automatic quality reduction, and the probe reaching its frozen state. No JavaScript/GLSL errors or external asset requests were observed. The lensed disk and aligned background star's Einstein ring were visually inspected.

The initial Chromium checks used ANGLE/SwiftShader software rendering, reaching about 13 fps at the tested 640×480 viewport after adaptive scaling; larger views were slower. **60 fps on a hardware-accelerated desktop remains to be benchmarked.** These checks validate rendering and interactions, not that performance target.

For the local-file compatibility fix, all **20 tests** and the standalone production build passed. Firefox ESR 140 opened and rendered all three entry paths directly over `file://`: the built page, the root launcher's redirect, and an independent copy in a directory containing spaces. Each had an advancing clock, no JavaScript/GLSL errors, and no subresource requests. Rendering used Mesa software graphics. Chromium also rendered the embedded page offline on an opaque origin; both Vite development and production HTTP serving were rechecked. Direct file navigation is blocked by this cloud Chromium's administrator policy, so that specific check used Firefox. Actual Safari/macOS is not available in this Linux environment.
