# Event Horizon

Event Horizon is a real-time black hole observatory for the browser, built with Three.js 0.180, GLSL and Vite 7. Orbit an accretion disk, approach the horizon or follow a falling probe, with procedural stars, galaxy, disk, craft and HUD and no external assets, fonts or services.

Inspired by [this black hole visualization](https://www.reddit.com/r/DeepSeek/comments/1xf0vlu/deepseek_v41_flash_built_an_interstellarstyle/).

## Run

Use Node.js **22 or newer** and npm; CI uses Node.js 24. Install the locked dependencies and build:

```sh
npm ci
npm run build
```

Open **`dist/index.html`** directly with a WebGL 2 browser. It contains all JavaScript and CSS, including Three.js, and works from `file://` without a server or network connection; copy or rename that single file to share it. The repository's root `index.html` forwards local-file opens to the adjacent `dist/index.html`, so build first. Startup failures appear in the page's **Startup details** panel.

For development, run `npm run dev` and open the address Vite prints. `npm run preview` serves the production build. Dependency installation needs network access; the built application requires no API keys or environment variables. Hardware acceleration is recommended; speed depends on the GPU, browser and render resolution.

Run the checks with:

```sh
npm test
npx playwright install chromium
npm run test:browser
```

Chromium installation is a one-time setup for the installed Playwright version. On Linux, use `npx playwright install --with-deps chromium` to also install browser system dependencies. The browser runner itself downloads nothing, builds under `tmp/` and serves on an ephemeral localhost port.

### Continuous integration and GitHub Pages

[CI](.github/workflows/ci.yml) runs on pushes and pull requests to every branch with read-only repository permissions. Its `test` job installs dependencies, runs `npm test`, builds and uploads `dist/index.html` as the **event-horizon-standalone** artifact. Its separate `browser` job installs Chromium and runs `npm run test:browser`. CI does not require GitHub Pages.

[Pages deployment](.github/workflows/pages.yml) builds and deploys `dist/` on pushes to `main` or manual dispatch. First enable **Settings → Pages → Source: GitHub Actions** in the repository. A successful deployment publishes to [rene-avi.github.io/schwarzschild-radius](https://rene-avi.github.io/schwarzschild-radius/); the workflow uses GitHub's built-in token. Pages setup or deployment failures do not prevent the separate CI workflow from running.

## Explore

The controls below share their labels and descriptions with `src/shortcuts.js`; the consistency test checks every entry.

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

Drag with the left mouse button or one finger to orbit. Scroll or pinch with two fingers to zoom; zoom also stops Fly in. The dock and HUD buttons offer the corresponding actions. At widths up to 760 px the controls panel starts closed; its toggle opens it. Wider layouts keep it visible.

Shortcuts also work with a focused range slider; arrows, Home, End, PageUp and PageDown retain native slider editing. Space on a focused button activates that button. Text fields retain their keys. The Shortcuts dialog lists every binding; while it is open, other shortcuts are ignored. Escape closes the dialog without changing camera mode. Pause stops the disk, local clock and probe while leaving the camera available.

### Parameters and quality

| Parameter | Range | Effect |
| --- | --- | --- |
| Mass | 10–1,000,000,000 M☉, logarithmic | Physical size in the HUD; normalized geometry stays unchanged |
| Spin | 0–0.99 | Illustrative disk motion, inner edge and beaming |
| Disk temperature | 2,000–20,000 K | Reference emission temperature |
| Disk tilt | −70° to +70° | Disk-plane orientation |
| Lensing strength | 0–2× | Effective Schwarzschild radius for rays and the observer clock; 1× is the physical reference |
| Time scale | 0–4× | Disk, clock and probe simulation speed |

**Gargantua**, **Sagittarius A*** and **Quiet** are visual presets, not measured disk reconstructions. Selecting one restores its parameters and camera and clears the probe. Editing a parameter shows **Custom parameters**; restoring all of that preset's values restores its selected state.

**Auto** starts at 100% render scale, adapts down to a 40% floor under sustained load and tries to recover when capacity returns. It tests whether lower resolution improves throughput before treating a slow rate as a frame cap. Fixed **High** (100%), **Balanced** (76%) and **Performance** (52%) disable adaptation and use progressively smaller ray-integration budgets. Returning to Auto starts at 100%. No mode guarantees a particular frame rate.

### Fly in and the probe

**F / Fly in** approaches a final hover over roughly 60 seconds of active camera updates. At lensing 1× it stops at `r = 1.03 rₛ`, turning from the hole toward the outside universe as it passes the photon sphere at `1.5 rₛ`. Dragging adds persistent free look; W/S changes radius and A/D steers. F again stops at the current position and retains the gaze; R restores the starting view. This is a controlled hovering observer; camera movement does not include velocity aberration.

**P / Drop a probe** releases or replaces a craft falling radially from rest at `r = 7 rₛ`. Its receiver is fixed at the camera's release radius, with a minimum of `7 rₛ`; later camera motion changes the view. The visible timeline starts when the receiver sees release, with the initial light delay subtracted. **SEEN AT** is the received emission radius, **SIGNAL** is the received/emitted frequency ratio, **PROBE CLOCK** is received onboard proper time, and **YOUR CLOCK** is receiver proper time since seeing release.

The beacon flashes at each whole unit of onboard proper time. Received flashes become farther apart as the signal redshifts; the HUD light and **FLASH n of 28** use that same received clock. Status changes to **SIGNAL FADING** below a frequency ratio of 0.25 and **SIGNAL LOST** at 0.02. The last readouts remain after loss; reset clears them. Pause and time scale apply to the probe timeline.

## Physics and rendering

Distances use Schwarzschild radii, `rₛ = 2GM/c²`, with `rₛ = c = 1` in the equations. One solar mass gives about 2.953 km. Dimensionless clock values convert to SI seconds by multiplying by `rₛ/c`; at time scale 1, one simulation second is one such unit. Mass changes the physical scale without changing the dimensionless image or animation rate. **SHADOW** reports the fraction of the entire local sky covered by the shadow.

| Component | Model and limits |
| --- | --- |
| Observer optics and shadow size | Exact Schwarzschild local static-observer optics, gravitational frequency ratios and analytic shadow angle at lensing 1×. The photon sphere is at 1.5 rₛ and critical impact parameter is √27/2 rₛ. |
| Ray integration | Exact Schwarzschild null-geodesic equation at lensing 1×, solved approximately with adaptive RK4 steps and finite quality budgets. Capture is analytic; outgoing rays and distant weak deflection use second-order approximations. |
| Probe trajectory and clocks | Exact radial Schwarzschild free fall from rest at 7 rₛ, using the analytic cycloid and Schwarzschild coordinate time, with numerical inversion to find the received event. The main observer clock uses the exact static lapse √(1 − 1/r) at lensing 1×. |
| Probe signal and delay | Exact outward radial photon model for a fixed static receiver, including gravitational and infaller Doppler shifts and retarded light-travel delay. The off-axis craft image reuses that signal history; it does not solve separate delays for bent rays or reception by a moving observer. |
| Spin | Illustrative disk rotation, inner edge and beaming; the spacetime remains Schwarzschild, with no Kerr frame dragging. |
| Disk emission, colours and exposure | Illustrative turbulence, velocity prescription, blackbody colour fit, bounded sky brightness, added photon-ring glow, bloom and automatic exposure. These are display models, not a full radiative-transfer solution; probe glow, trails and signal-loss cutoff are also display choices. |
| Lensing-strength slider | Illustrative variation of the effective radius for ray geometry and static frequency shifts; use 1× for the Schwarzschild reference. Probe physics always uses rₛ = 1 independently of this slider. |

Bent rays can cross the emitting disk repeatedly, showing its far side above and below the shadow. **E** aligns a resolved background source to reveal an Einstein ring; its source-size transition is illustrative. The added glow at the critical impact parameter represents unresolved higher-order images and is distinct from that Einstein ring.

## Code map and checks

| Files | Responsibility |
| --- | --- |
| `src/main.js`, `src/quality.js` | Loop, actions, telemetry and adaptive/fixed quality |
| `src/scene.js`, `src/shaders/blackhole.js`, `src/shaders/post.js` | Render pipeline, rays, procedural scene and post-processing |
| `src/physics.js`, `src/geodesic.js` | Units, presets, exact radial probe model, null-ray reference and shared constants |
| `src/camera.js` | Orbit, touch, fly-in and static-observer gaze |
| `src/ui.js`, `src/style.css`, `src/shortcuts.js` | Responsive HUD, controls, help and shared keyboard policy |
| `build/standalone.js` | Relocatable single-HTML production bundle |
| `tests/*.test.js`, `tests/run.mjs` | Node checks and in-process test runner |
| `tests/browser/run.mjs`, `tests/browser/checks/`, `tests/browser/pixels.mjs` | Standalone Chromium checks, screenshots and pixel measurements |

`npm test` checks units, probe geodesics/clocks/signals/delay, local optics, shadow boundaries, escape directions, camera behavior, presets, keyboard/README consistency, exposure utilities and simulated quality-controller scenarios. The standalone regression builds the application and checks that only one HTML file remains, with embedded CSS and JavaScript that parses as a classic script. Its summary is `TOTAL <n> pass <p> fail <f>`; any failure or zero tests gives a nonzero exit.

`npm run test:browser` checks responsive controls, keyboard focus, presets, help, quality modes, real two-finger touch, readable HUD text, console errors and foreign requests. With hardware GL it also measures rendered shadow boundaries, star shape/density/brightness, highlights and colour, and probe visibility, size and received pixel pulses. Picture checks wait for exposure to settle before measuring. Screenshots and numerical diagnostics are saved under `tmp/browser-out/`.

The runner prints the WebGL renderer name. On **SwiftShader** or **llvmpipe** it skips only checks marked `gpu: true`, printing `skip <name> (software renderer)` for each; DOM, input and text-size checks still run. The summary is `TOTAL <n> pass <p> fail <f> skip <s>`, including skipped checks in the total, and zero executed checks fails. To launch without the macOS GPU flags, use:

```sh
EH_FORCE_SOFTWARE=1 node tests/browser/run.mjs
```

Skipping depends on the detected renderer, not the environment variable alone. Software-renderer CI covers interaction and startup; visual acceptance still requires inspecting the default view, presets, fly-in, alignment and probe on hardware GL. No automated checks impose frame-rate or wall-clock performance acceptance thresholds.

For manual inspection, orbit to reveal the secondary disk image, compare the bright and dim sides, try each preset, release a probe and fly toward the final hover. **H** hides the HUD for screenshots or a browser/screen recording. `window.eventHorizon.getState()` exposes copied telemetry; only `?debug=1` adds bounded camera/layer/pause/probe-step controls for the browser checks.
