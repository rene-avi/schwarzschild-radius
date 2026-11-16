# Event Horizon

Inspired by https://www.reddit.com/r/DeepSeek/comments/1xf0vlu/deepseek_v41_flash_built_an_interstellarstyle/

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

The standalone file is approximately 550 KB. A small source `index.html` copied alone into Downloads is only the launcher and cannot find the simulation without its neighboring `dist/` directory. The complete file shows a startup panel before running any application code. If JavaScript is disabled, graphics initialization fails, or startup throws an error, it displays an explanation instead of leaving an empty page; share the text under **Startup details** when troubleshooting.

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

Drag with the left mouse button or one finger to orbit. During Fly in, dragging is persistent free look added to the automatic gaze. Scroll or pinch with two fingers to zoom over the same range; zoom stops the automatic approach. F again stops at the current position and retains the view and free look; R resets position and gaze. The dock, logo, clock, Cinematic, alignment and Shortcuts buttons provide the corresponding actions above.

Shortcuts work while a range slider has focus. Arrow keys, Home, End, PageUp and PageDown retain native slider behavior; Space on a focused button activates only that button. Text inputs, textareas, selects and editable text retain their keys. Pause stops disk motion, the local clock, and the probe; the camera remains available. The camera is a hovering static observer, with radii from `1.03 × max(1, lensing)` to 65 Schwarzschild radii. Cinematic mode follows a slow, repeating-height orbital path looking toward the hole. Press H for a clean recording view and capture it with your browser or screen recorder; there is no built-in video encoder.

The help dialog lists every shortcut; the one-line reminder shows C, F, P, Space and R. While help is open, other shortcuts and camera keys are ignored. Escape closes the dialog natively without changing camera mode; `/` also closes it.

The HUD reports mass, Schwarzschild radius, observer distance, SHADOW (percentage of the entire local sky covered by the shadow), local proper time, the received probe event and signal with both clocks, frame rate, and quality mode and scale. At widths of 760 px or less the panel starts closed and its toggle opens it. Above 760 px the panel is always visible. Crossing that breakpoint restores the new layout's default state.

### Parameters and presets

| Parameter | Range | Meaning |
| --- | --- | --- |
| Mass | 10–1,000,000,000 solar masses, logarithmic | Physical size reported by the HUD |
| Spin | 0–0.99 | Artistic disk rotation, inner edge, and orbital-beaming adjustment |
| Disk temperature | 2,000–20,000 K | Reference emission temperature |
| Disk tilt | −70° to +70° | Disk-plane rotation relative to the scene |
| Lensing strength | 0–2× | Effective Schwarzschild radius in ray geometry and static frequency shifts; 1× is the physical reference |
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

One solar mass gives approximately 2.953 km. Scene lengths use `r / rₛ`, so changing mass updates the physical scale without changing the dimensionless image or camera framing. At time scale 1, one simulation second is one rₛ/c; multiply dimensionless times by the reported Schwarzschild radius divided by c to obtain SI seconds. Changing mass leaves the animation rate unchanged.

A stationary clock outside the horizon ticks relative to a distant clock by

```text
dτ/dt = √(1 − rₛ/r)
```

The on-screen clock integrates this factor at the observer's radius, using the effective radius L when the lensing control differs from 1. Approaching the horizon visibly slows it. The utility returns zero at or inside the horizon as a display limit; a stationary observer cannot physically exist there. The probe separately solves a freely falling clock along a radial geodesic. The viewing camera remains a controlled static-observer view; its movement does not model velocity aberration.

### Curved rays, disk images, and the photon ring

Each fragment launches a direction in the hovering observer's local orthonormal frame. With `rₛ = 1`, `L = lensing`, and local angle `ψ` measured from the inward radial direction, the conserved impact parameter and equivalent coordinate angle are

```text
b = r sin(ψ) / √(1 − L/r)
ψ′ = atan2(sin(ψ) / √(1 − L/r), cos(ψ))
u″ + u = (3/2) L u²,  u = 1/r
u(0) = 1/r_observer,  u′(0) = cos(ψ)/b
```

The orbital equation and local-frame geometry are exact Schwarzschild null-ray geometry at `L = 1`; numerical RK4 steps approximate its solution. `src/geodesic.js` supplies the shader's constants and a pure reference with the same RK4 stages and adaptive angular step rule. Steps shrink near the photon sphere; outgoing rays beyond the disk and probe region finish with a second-order analytic vacuum remainder once `r > max(12, 2b)`. Incremental polynomial rotations advance the shader's orbital basis. The conserved **true** `b` determines capture, the added photon ring, and the weak-field shortcut. Capture is masked analytically, including unresolved near-critical orbits. The capture surface is `1.015 × max(1, L)`; the camera remains outside it and outside `r = L`. At `L = 0`, the view is flat with an opaque black ball. At small nonzero L where the photon sphere lies inside the capture surface, that surface determines the shadow boundary.

For the exposed photon sphere, the shadow's angular radius satisfies

```text
sin(α) = (3√3 L / 2r) √(1 − L/r)
α ≤ 90° outside r = 1.5 L; α = 180° − asin(...) inside
shadow fraction = (1 − cos(α)) / 2
```

At `L = 1`, α is 6.342807° at r=23, 17.685065° at r=8, 45° at r=3, 90° at r=1.5, and 154.501741° at r=1.03. The shadow covers about 0.3%, 50%, and 95.1% of the entire sky at r=23, 1.5, and 1.03 respectively.

Fly in descends for about 60 seconds to a final hover. Over its first seconds the path eases to 21° from the tilted disk plane on its starting side, clearing the emitting sheet during the approach from the default radius. Inside the disk's inner edge it sinks towards 8° from that plane. At the reference lensing strength, the gaze starts turning away from the disk side below r=6, reaches 90° at the photon sphere r=1.5, and looks straight out at r=1.03. The outside universe then occupies a disc of angular radius 25.498259°. Notices mark the disk's inner edge, the photon sphere and final hover. W/S thrust can change the approach, including leaving the hover; A/D steers around the disk normal. A rotation-based camera basis stays stable when looking straight in or out. This is a controlled hovering-camera path, not a freely falling observer or an aberration model.

Disk-plane crossings accumulate optically thin emission. A bent ray can cross the disk more than once, revealing its far side above and below the central shadow. Layered noise and animated radial filaments supply turbulence. A faint procedural corona softens the thin disk.

The Schwarzschild photon sphere lies at `1.5 rₛ`; its critical impact parameter is `√27/2 × rₛ ≈ 2.598 rₛ`. An analytical narrow glow supplements unresolved higher-order images around this critical boundary. This photon ring is distinct from a background star's Einstein ring.

Despite the spin control, the spacetime remains **Schwarzschild**, not Kerr. Spin changes the disk's visual motion, inner edge, and beaming; it does not implement frame dragging or a rotating event horizon.

### Doppler beaming and color

For an emitter moving at `β = v/c`, the relativistic Doppler factor is

```text
δ = √(1 − β²) / (1 − β cos θ)
```

Here `cos θ = +1` means motion toward the observer. The approaching disk is brighter and shifted toward blue; the receding side is dimmer and shifted toward red. The shader multiplies specific intensity by `δ³`. For a static emitter at r_e and observer at r_o the gravitational frequency ratio is `g = √[(1 − L/r_e)/(1 − L/r_o)]`; the disk's reference color temperature is multiplied by `δg`. Equal static radii give g=1; an observer at infinity recovers the emitter's redshift. The sky receives the observer's blueshift `1/√(1 − L/r_o)` through a bounded brightening and slight blue tint. These static frequency ratios and the geometry are exact at L=1; the displayed colour/intensity mapping, disk velocity prescription and blackbody fit are illustrative. Bolometric beaming would use `δ⁴`; this is not a spectrally integrated radiative-transfer calculation.

### Stars, galaxy, and alignment

Hashed angular cells create point stars; fractal noise creates the galaxy band and dust. Both are evaluated at the **bent outgoing ray**, so the background visibly warps as the camera moves. A brighter directional star at `normalize(0, −5.8, −21)` provides an alignment target: orbit until the black hole lies between the observer and that direction to obtain an Einstein-ring configuration. The default camera is near this axis. Its visibility depends on alignment, disk emission, and render resolution; the star ring is produced by ray bending rather than a separately drawn circle.

### The probe

The probe falls radially from rest at r₀=7 in a Schwarzschild spacetime with rₛ=c=1. Its trajectory and onboard proper clock use the exact cycloid:

```text
E = √(1 − 1/r₀), f = 1 − 1/r
r = (r₀/2)(1 + cos η)
τ = (r₀^1.5/2)(η + sin η)
(dr/dτ)² = E² − f, dt/dτ = E/f
```

The onboard clock reaches the horizon at τ=28.3939046925 and r=0 at τ=29.0915550872. Schwarzschild coordinate time t diverges logarithmically at the horizon. An analytic expression for t(r), followed by bisection, determines the received emission event. Reception time T starts when the observer **sees the release**, so pressing P immediately starts the visible fall and both probe-panel clocks:

```text
r*(r) = r + ln(r − 1)
absolute arrival = t_emission + r*(r_observer) − r*(r_emission)
release light delay = r*(r_observer) − r*(r₀)
T = absolute arrival − release light delay = t_emission + r*(r₀) − r*(r_emission)
g = ν_received/ν_emitted = f / [(E + √(E² − f)) √(1 − 1/r_observer)]
```

These frequency and delay expressions are exact for an outward radial photon received by a fixed static observer. The frequency includes both gravitational redshift and the infaller's Doppler shift; it starts at √(1−1/7)/√(1−1/r_observer), tends to zero, and has late-time ln(g) slope −1/2 against coordinate reception time T. The receiver is fixed at the camera's radius when released, or r=7 if the camera is inside the release sphere. Subsequent camera motion changes the view. Probe physics always uses rₛ=1, independent of the artistic lensing control.

With the default receiver at r=23, the release light delay is 17.2992829841 coordinate units. This remains in the absolute arrival model; the displayed timeline subtracts it. Every later emission still arrives with its additional light-travel delay relative to the release signal.

The panel shows **SEEN AT** (received emission radius), **SIGNAL** (g, three decimals), **PROBE CLOCK** (received onboard τ), and **YOUR CLOCK** (fixed receiver proper time T√(1−1/r_observer) since seeing release). Both clocks use rₛ/c. Status changes from **PROBE · FALLING** to **SIGNAL FADING** below g=0.25 and **SIGNAL LOST** at the g=0.02 cutoff. At the default radius, loss occurs at T≈47.596, receiver time≈46.550, and received onboard time≈28.353, just below the finite horizon value. The last four values remain after loss. Pause and time scale apply to the reception timeline; frame subdivision does not change the trajectory, clocks, pulses or received trail.

The beacon flashes at every whole unit of received onboard proper time, with a release pulse at τ=0. The HUD light follows the same pulse and **FLASH n of 28** counts received flashes 1 through 28. Their reception intervals lengthen as g falls: about 1.098 between flashes 1 and 2, and 4.191 between flashes 27 and 28. There is no flash 29 before the horizon. The pulse phase comes directly from the fractional received τ, so it freezes when paused.

The release direction is fixed relative to the camera at about 25° from the near-side radial axis, lifted above the disk plane in the default view. The hull and wings are procedural ellipsoids. A steady glow of roughly 10-pixel radius near g=1 shrinks with g; short flashes add a soft four-point glint. Up to eight dots mark past received flash positions from the last 12 coordinate units, fading with reception age. The hull's apparent size remains capped for close views. Glow size, pulse shape, trail persistence, white-cyan/amber/deep-red colours, g³ brightness with a visibility floor, and disappearance at the signal cutoff are display choices. The off-axis lensed image uses this single radial signal history; it does not calculate separate photon travel times or direction-dependent Doppler shifts for every bent ray, tidal structural damage, or communication with a moving receiver.

### Post-processing and performance

Three.js bloom spreads bright emission. A final pass applies an ACES-style tone curve, display gamma, vignette, and subtle procedural film grain. All intermediate images are generated render targets.

The target is 60 fps on a hardware-accelerated desktop browser. Render resolution is capped independently of display DPI. **Auto** quality starts at 100% scale. Three seconds of measured rates below 50 fps trigger a 12 percentage point reduction. If throughput does not improve by at least 12% during the following measurement, a second reduction is tried where the 40% floor allows it: vsync can hide the first gain. If the available trials do not improve throughput, the pre-probe scale is restored and the observed rate is remembered as a frame cap. Further reductions target 85% of that cap; a rate more than 20% above it clears the cap. Twelve seconds at 58 fps (or 97% of a known cap) allow recovery; a failed upward trial waits 60 seconds before another attempt. Long frame gaps reset the measurement without changing quality.

The **Quality** control also offers fixed **High** (100%), **Balanced** (76%) and **Performance** (52%) modes, which disable adaptation. High allows up to 352 RK4 steps of at most 0.22 radians, Balanced 192 at 0.28, and Performance 144 at 0.34. Steps shrink with proximity to the critical impact parameter and photon sphere, down to angular caps of 0.055, 0.075 and 0.1 radians respectively; radial changes can require still smaller steps. Rays terminate on capture or finish with the outgoing vacuum remainder. Auto uses those same budgets at scales of at least 90%, at least 60%, and below 60%, respectively, with a floor of 40%. Returning to Auto starts again at 100%. The status bar reads, for example, `AUTO · HIGH · 100%` or `FIXED · BALANCED · 76%`. Sky rays blend into the second-order weak-deflection approximation between true impact parameters b=10 and b=12; beyond b=12 they bypass integration. The numerical reference integrates these rays instead of taking that shortcut, independently checking the weak-deflection limit.

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
src/camera.js               Static-observer gaze, orbit, pinch, fly-in, cinematic path
src/geodesic.js             Pure null-ray reference and shared shader constants
src/ui.js                   Controls, keyboard help, live readouts
src/style.css               HUD layout and responsive styling
build/standalone.js         Single-file HTML build and source-entry conversion
tests/physics.test.js       Units, limiting cases, probe behavior
tests/geodesic.test.js      Local mapping, shadow boundaries, weak bending, shifts
tests/camera.test.js        Gaze basis, hover/thrust, stop/reset, pinch and limits
tests/steps.test.js         Reference step grids and bounded quality budgets
tests/optics.test.js        Escape directions against fine angular integration
tests/presets.test.js       Complete, bounded, immutable preset configurations
tests/standalone.test.js    Actual build portability and classic-script regression
tests/quality.test.js       Simulated caps, GPU limits, hitches, suspension, fixed modes
tests/shortcuts.test.js     Keyboard focus policy and README shortcut consistency
tests/run.mjs               Named in-process Node test runner
tests/browser/run.mjs       Standalone Chromium interaction and pixel checks
tests/browser/checks/observer.mjs  Independent shadow measurements from screenshots
tests/browser/checks/touch.mjs     Real multi-touch CDP input in a touch context
tests/browser/checks/probe.mjs     Received signal, HUD, pixel pulses, colour, visibility and size
```

`npm test` runs every `tests/*.test.js` through `node tests/run.mjs`, using Node's programmatic test API in one process. It prints `TOTAL <n> pass <p> fail <f>` and fails if any test fails or none run. Tests cover physics, geodesics, camera behavior, presets, shortcut policy and documentation, and at least 120 simulated seconds per quality device scenario, without wall-clock performance thresholds. The build regression compiles the actual application under `tmp/` and checks that only one HTML file remains, with embedded styles and JavaScript that parses as a classic script.

`npm run test:browser` builds a standalone file under `tmp/`, serves it on an ephemeral localhost port and runs all modules in `tests/browser/checks/` with the installed Playwright Chromium. No browser downloads are performed. It checks responsive controls, keyboard focus behavior, custom parameters, complete help, fixed quality modes, console errors and foreign requests, plus shadow boundaries measured along eight azimuths at r=23, 8 and 3, the straight horizon at r=1.5, real two-finger pinch/free look, and probe visibility, colour progression, received clocks, pixel-brightness pulses and their growing intervals, HUD synchronization, loss and bounded close-up size. Failed checks and observer reference images are saved in `tmp/browser-out/`; review screenshots at 375 px and the quality panel on a real GPU for visual acceptance.

For a manual rendering check, confirm a luminous disk and dark shadow, orbit to reveal the secondary disk image, compare the bright and dim sides, switch all presets, release a probe, and try fly-in and cinematic modes. Monitor the console for shader errors and the HUD for frame rate. `window.eventHorizon.getState()` exposes a copy of the current simulation telemetry for browser automation without allowing direct mutation, including probe `radius`, `signal`, `properElapsed`, `observerElapsed`, coordinate `elapsed` since seeing release, `emissionTime` since emission of release, `observerRadius`, absolute `arrivalDelay`, shifted `lostTime`, `pulse`, `flashCount`, `flashTotal`, fixed `direction`, received flash `trail` (radius, proper time, signal, reception time and age) and `state` (`falling`, `fading`, `lost`), plus `qualityMode` (`auto`, `high`, `balanced`, `performance`), `frameCap` (fps or `null`), `renderedFrames`, and camera `gazeYaw`, `gazePitch` (radians), and `shadowFraction` (0–1). Only `?debug=1` enables `window.eventHorizon.debug`: `setCamera({ radius, theta, elevation, yaw, pitch })` jumps without easing (angles in radians), `setLayers({ disk, sky, ring, probe })` accepts booleans, `setPaused(bool)` sets simulation pause, and `advanceProbe(dt)` advances only the probe reception timeline by a nonnegative coordinate time step multiplied by the selected time scale (use while paused for deterministic screenshots). No URL code or expressions are executed. Pause leaves the camera available.

### Validation scope

The Node checks compare the capture boundary from numerical ray tracing with the analytic static-observer shadow to within 0.5°, and integrated weak deflection at b=20 and b=50 with the second-order expansion to within 2%. HIGH escape directions are compared with a fine fixed-step reference to within 0.001 radians, including rays near the shadow at the final hover. `node tests/steps.test.js` prints mean and maximum HIGH integration counts on 180×112 grids at r=23 and r=8, asserts a default-view mean of at most 40, and checks resolved rays against all three quality budgets. Camera tests check tilted-disk clearance on either starting side and continuous elevation and gaze. Browser checks measure rendered shadow angles to within 1.5%, and the r=1.5 horizon line to within 6 pixels. These are geometry and interaction checks; visual acceptance of the default view, fly-in sequence and Einstein ring still requires rendered inspection. There are no frame-rate or wall-clock performance acceptance thresholds in the tests.
