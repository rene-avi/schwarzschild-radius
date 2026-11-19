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

[CI](.github/workflows/ci.yml) runs on pushes and pull requests to every branch with read-only repository permissions. Its `test` job installs dependencies, runs `npm test`, builds and uploads `dist/index.html` as the **event-horizon-standalone** artifact. Its separate `browser` job installs Chromium, runs `npm run test:browser` and uploads available screenshots and diagnostics from `tmp/browser-out/` as the **browser-out** artifact, even when checks fail. CI does not require GitHub Pages.

[Pages deployment](.github/workflows/pages.yml) builds and deploys `dist/` on pushes to `main` or manual dispatch. First enable **Settings → Pages → Source: GitHub Actions** in the repository. A successful deployment publishes to [rene-avi.github.io/schwarzschild-radius](https://rene-avi.github.io/schwarzschild-radius/); the workflow uses GitHub's built-in token. Pages setup or deployment failures do not prevent the separate CI workflow from running.

## Explore

The controls below share their labels and descriptions with `src/shortcuts.js`; the consistency test checks every entry.

| Control | Action |
| --- | --- |
| C | Toggle cinematic flight |
| F | Toggle horizon approach |
| P | Release or replace probe |
| M | Toggle Mission panel |
| Space | Pause or resume simulation |
| R | Reset camera, probe and observer clock |
| E | Align a background star |
| H | Hide or reveal HUD |
| Escape | Return to manual orbit |
| W | Thrust inward |
| S | Thrust outward |
| A | Rotate left |
| D | Rotate right |
| / | Toggle shortcuts and control reminder |

Drag with the left mouse button or one finger to orbit. Scroll or pinch with two fingers to zoom; zoom also stops Fly in. The dock and HUD buttons offer the corresponding actions. The Mission panel starts closed at every width; press **M** or its dock button to toggle it. Wider layouts place Mission immediately left of the visible controls. At widths up to 760 px the controls panel also starts closed; its toggle opens it. The two panels share that slot and opening one closes the other. Telemetry, object label and notices are hidden while either narrow panel is open; the observer clock and its pause button stay visible below the panel. The Mission dock button shows only its icon there. Resizing never opens Mission; Escape returns to manual orbit and leaves Mission open.

Shortcuts also work with a focused range slider; arrows, Home, End, PageUp and PageDown retain native slider editing. Space on a focused button activates that button. Text fields retain their keys. The Shortcuts dialog lists every binding; while it is open, other shortcuts are ignored. Escape closes the dialog without changing camera mode. Pause stops the disk, observer clock, probe and ledger clock while leaving the camera available. **R** resets the camera, probe and observer clock; it does not reset the ledger.

### Mission and the ledger

Mission starts in **Clocks**, listing **Ship, Far Shore, Lantern, Brink** in that order, with each orbit's radius in M, Home/here clock factor and the Home time corresponding to one hour there. Each card pairs the name with its radius, then the factor with its one-hour cost. On narrow layouts the Mission heading stays visible while its contents scroll. Choose a location to move the crew instantly; transfers take no time. The ledger shows elapsed **crew, Home, Brink, Lantern, Far Shore, ship** time. Crew starts at the ship and the ledger clock starts stopped. **Start** runs it at one crew hour per four real seconds at time scale 1 (900 crew seconds per real second); in Deep orbit at Brink, that is about **1.76 Home years per real second**. **Stop** freezes the ledger. **Reset ledger** zeros every ledger clock, returns the crew to the ship and stops it.

The **Map** tab shows all four orbits, the horizon and the dashed prograde photon orbit and ISCO. Brink shares the ISCO and its label. Map radius is logarithmic in height above the Kerr horizon, `h = r − r₊` in M: equal radial steps represent equal height ratios. The inner disc clamps heights at or below one tenth of the photon-orbit height; the photon ring sits exactly one decade outside that disc. The outer ring is the ship. The scale follows the spin, so compare positions within the current map. Dot angles are fixed for readability and do not show orbital phase or motion. Click a dot or label, or focus its group and press Enter or Space, to travel with the same instantaneous transfers as the cards. The crew's current orbit is highlighted in both views. Closing and reopening Mission keeps the selected tab.

The ledger clock keeps running with Mission closed, only while the page is visible, and follows pause and time scale. Frame steps are capped before time scaling, so a stalled frame cannot create a large catch-up jump. Preset and spin changes update factors and hour costs and affect future increments; they preserve elapsed ledger time and its running state. The separate **LOCAL PROPER TIME** readout remains the Schwarzschild static observer's clock, independent of the crew's Kerr orbit.

Opening Mission also draws Lantern and Far Shore in the picture at lensing 1×. Their phases accumulate on the picture's clock, including while Mission is closed, and follow pause and time scale. One simulation second is rₛ/c, independently of the ledger's accelerated crew clock. Changing spin changes future angular increments without resetting phase. **R** resets the picture clock and phases: Lantern starts at −0.9 rad on the near side and Far Shore at 1.82 rad, with both direct images in open picture space at 1440 × 900 and 1000 × 800 using the default camera. Phase increases in the disk's Doppler velocity direction. Map dot angles remain schematic.

### Parameters and quality

| Parameter | Range | Effect |
| --- | --- | --- |
| Mass | 10–1,000,000,000 M☉, logarithmic | Physical size in the HUD; normalized geometry stays unchanged |
| Spin | Logarithmic in 1 − a, from a = 0 towards a = 1 − 10⁻¹⁴ | Kerr world clocks and orbit map; illustrative disk motion, inner edge and beaming saturate at a = 0.99 |
| Disk temperature | 2,000–20,000 K | Reference emission temperature |
| Disk tilt | −70° to +70° | Disk-plane orientation |
| Lensing strength | 0–2× | Effective Schwarzschild radius for rays and the observer clock; 1× is the physical reference |
| Time scale | 0–4× | Disk, observer clock, probe and ledger clock speed |

**Gargantua**, **Sagittarius A***, **Quiet** and **Deep orbit** are parameter presets, not measured disk reconstructions. Deep orbit uses near-extremal spin (1 − a = 1.3×10⁻¹⁴), 100 million M☉, 6,500 K, 6° tilt, lensing 1× and time scale 1×. Selecting a preset restores its exact stored parameters and camera and clears the probe. Editing a parameter shows **Custom parameters**; returning every slider to that preset's thumb positions restores its selected state and exact stored values, including off-grid mass and spin values.

**Auto** starts at 100% render scale, adapts down to a 40% floor under sustained load and tries to recover when capacity returns. It tests whether lower resolution improves throughput before treating a slow rate as a frame cap. Fixed **High** (100%), **Balanced** (76%) and **Performance** (52%) disable adaptation and use progressively smaller ray-integration budgets. Returning to Auto starts at 100%. No mode guarantees a particular frame rate.

### Fly in and the probe

**F / Fly in** approaches a final hover over roughly 60 seconds of active camera updates. At lensing 1× it stops at `r = 1.03 rₛ`, turning from the hole toward the outside universe as it passes the photon sphere at `1.5 rₛ`. Dragging adds persistent free look; W/S changes radius and A/D steers. F again stops at the current position and retains the gaze; R restores the starting view. This is a controlled hovering observer; camera movement does not include velocity aberration.

**P / Drop a probe** releases or replaces a craft falling radially from rest at `r = 7 rₛ`. Its receiver is fixed at the camera's release radius, with a minimum of `7 rₛ`; later camera motion changes the view. The visible timeline starts when the receiver sees release, with the initial light delay subtracted. **SEEN AT** is the received emission radius, **SIGNAL** is the received/emitted frequency ratio, **PROBE CLOCK** is received onboard proper time, and **YOUR CLOCK** is receiver proper time since seeing release.

The beacon flashes at each whole unit of onboard proper time. Received flashes become farther apart as the signal redshifts; the HUD light and **FLASH n of 28** use that same received clock. Status changes to **SIGNAL FADING** below a frequency ratio of 0.25 and **SIGNAL LOST** at 0.02. The last readouts remain after loss; reset clears them. Pause and time scale apply to the probe timeline.

## Physics and rendering

Rendered distances use Schwarzschild radii, `rₛ = 2GM/c²`, with `rₛ = c = 1` in the rendering and probe equations. One solar mass gives about 2.953 km. Dimensionless observer/probe clock values convert to SI seconds by multiplying by `rₛ/c`; at time scale 1, one simulation second is one such unit. Mass changes the physical scale without changing the dimensionless image or animation rate. **SHADOW** reports the fraction of the entire local sky covered by the shadow.

| Component | Model and limits |
| --- | --- |
| Observer optics and shadow size | Exact Schwarzschild local static-observer optics, gravitational frequency ratios and analytic shadow angle at lensing 1×. The photon sphere is at 1.5 rₛ and critical impact parameter is √27/2 rₛ. |
| Ray integration | Exact Schwarzschild null-geodesic equation at lensing 1×, solved approximately with adaptive RK4 steps and finite quality budgets. Capture is analytic; outgoing rays and distant weak deflection use second-order approximations. |
| Probe trajectory and clocks | Exact radial Schwarzschild free fall from rest at 7 rₛ, using the analytic cycloid and Schwarzschild coordinate time, with numerical inversion to find the received event. The main observer clock uses the exact static lapse √(1 − 1/r) at lensing 1×. |
| Probe signal and delay | Exact outward radial photon model for a fixed static receiver, including gravitational and infaller Doppler shifts and retarded light-travel delay. The off-axis craft image reuses that signal history; it does not solve separate delays for bent rays or reception by a moving observer. |
| World orbits and clocks (Kerr) | `src/worlds.js` and `src/ledger.js` use the exact prograde equatorial circular orbits and clocks from `src/kerr.js` in gravitational units (M = 1, rₛ = 2M). Brink sits on the marginally stable ISCO; Lantern, Far Shore and the ship orbit at 12 M, 120 M and 400 M. Home is the distant static coordinate clock. |
| Orbit map | Schematic top-down layout using exact Kerr heights above the horizon on one logarithmic scale, with a clamped inner disc. Fixed dot angles are layout choices; they do not model orbital phase or a spatial embedding of the Kerr metric. |
| Worlds in the picture | Kerr orbit radii do not map into the Schwarzschild picture. In Deep orbit Brink lies at about 0.50002 rₛ, inside the drawn horizon, so it is never drawn; the Map shows it. Lantern and Far Shore are drawn while Mission is open, at lensing 1× only, where Kerr and Schwarzschild agree within 3% in angular speed and clock rate. Across the spin slider the maximum deviations are respectively 2.349% and 0.729% for Lantern, 0.076% and 0.002% for Far Shore. The picture, observer and probe remain Schwarzschild. Sizes are exaggerated: radii 0.18 rₛ and 0.6 rₛ. Lensing stretches the worlds' images tangentially near the hole. Positions are retarded by the straight-line light time to the direct image; secondary images and the Shapiro delay are not treated separately. Worlds move on the picture's clock (one simulation second = rₛ/c), independently of the accelerated ledger clock. Lantern's orbit lies inside the illustrative disk, whose gas pattern does not follow orbital speed. |
| Time ledger | Mission accumulates Home coordinate time, crew proper time and each orbiting body's proper time in SI seconds, independently of mass; mass sets orbit periods through GM/c³. Transfers are instantaneous and free. Spin changes affect future increments only. The ledger starts stopped at the ship; Start advances it from visible, unpaused simulation frames at 900 crew seconds per real second times time scale. |
| Rendered spin | Illustrative disk rotation, inner edge and beaming; the picture remains Schwarzschild, with no Kerr frame dragging. |
| Disk emission, colours and exposure | Illustrative turbulence, velocity prescription, blackbody colour fit, bounded sky brightness, added photon-ring glow, bloom and automatic exposure. These are display models, not a full radiative-transfer solution; probe glow, trails and signal-loss cutoff are also display choices. |
| Lensing-strength slider | Illustrative variation of the effective radius for ray geometry and static frequency shifts; use 1× for the Schwarzschild reference. Probe physics always uses rₛ = 1 independently of this slider. |

Bent rays can cross the emitting disk repeatedly, showing its far side above and below the shadow. **E** aligns a resolved background source to reveal an Einstein ring; its source-size transition is illustrative. The added glow at the critical impact parameter represents unresolved higher-order images and is distinct from that Einstein ring.

World centres use three fixed-point light-delay iterations followed by a residual correction. Start phases are −0.9 rad for Lantern and 1.82 rad for Far Shore. Spheres are opaque surfaces, tested on the integrated ray's chords and its straight escape tail; the nearer sphere entry or disk crossing is composited first. Limb coverage blends over one pixel footprint at the world's distance, including the observer's lapse. Vacuum integration continues behind opaque hits to preserve neighbouring sky derivatives. The weak-field sky approximation stays in use, with ray integration added inside conservative angular cones around worlds. A sphere containing the camera is ignored. At constant spin, orbital periods are 2π/Ω in M time units, or π/Ω on the picture clock: Lantern takes about 130.6–133.7 simulation seconds and Far Shore about 4,130.

Lantern is bluish-grey and Far Shore pale ochre, with two low-frequency procedural noise octaves on each sphere's own surface normal. The worlds have no emission: their display shading uses Lambert reflection toward the hole's centre, the disk temperature's blackbody colour fit, faint ambient light and a thin limb highlight. The light falloff on the worlds is illustrative: `(1 + (6/60)²) / (1 + (r/60)²)`, with `r` in rₛ, normalizes the direct light at Lantern and softens inverse-square attenuation over a scale of 60 rₛ so Far Shore stays visible. This is not illumination integrated over the disk. Each world's largest radiance channel is capped at 1.05 before post-processing, below the bloom threshold; lensed arcs retain the sphere's lit/night structure.

## Code map and checks

| Files | Responsibility |
| --- | --- |
| `src/main.js`, `src/quality.js` | Loop, actions, telemetry and adaptive/fixed quality |
| `src/scene.js`, `src/shaders/blackhole.js`, `src/shaders/post.js` | Render pipeline, rays, procedural scene and post-processing |
| `src/physics.js`, `src/geodesic.js` | Units, presets, exact radial probe model, null-ray reference and shared constants |
| `src/kerr.js`, `src/worlds.js`, `src/ledger.js` | Exact Kerr circular orbits, world clocks/periods and accumulated crew/Home/body times |
| `src/worldview.js` | Picture-world agreement decisions, accumulated phases, retarded centres and direct-null-image reference/projection |
| `src/orbitmap.js` | Pure logarithmic height mapping, inverse and orbit/label geometry |
| `src/mission.js` | Pure crew-clock step and accelerated mission rate |
| `src/camera.js` | Orbit, touch, fly-in and static-observer gaze |
| `src/ui.js`, `src/style.css`, `src/shortcuts.js` | Responsive HUD, controls, help and shared keyboard policy |
| `build/standalone.js` | Relocatable single-HTML production bundle |
| `tests/*.test.js`, `tests/run.mjs` | Node checks and in-process test runner |
| `tests/browser/run.mjs`, `tests/browser/checks/`, `tests/browser/pixels.mjs` | Standalone Chromium/WebKit checks, screenshots and pixel measurements |

`npm test` checks units, probe geodesics/clocks/signals/delay, local optics, shadow boundaries, escape directions, camera behavior, Kerr orbits, world stability/periods, picture-world agreement at every spin position, orbital plane/sense, accumulated and retarded phases, direct-image null rays and screen projection, orbit-map mapping/inverse and label collisions at every spin-slider position and both widths, ledger accumulation/formatting, Mission rate/pause/time scale, presets, keyboard/README consistency, exposure utilities and simulated quality-controller scenarios. The standalone regression builds the application and checks that only one HTML file remains, with embedded CSS and JavaScript that parses as a classic script. Its summary is `TOTAL <n> pass <p> fail <f>`; any failure or zero tests gives a nonzero exit.

`npm run test:browser` checks responsive controls and Mission placement, narrow-panel clearance, Kerr factors and ledger text, Mission start/pause/stop, orbit-map label bounds and collisions, click/keyboard travel and zero-spin radii, keyboard focus, presets, help, quality modes, real two-finger touch, readable HUD text, console errors and foreign requests. With hardware GL it also measures rendered shadow boundaries, star shape/density/brightness, highlights and colour, probe visibility, size and received pixel pulses, and picture-world gating, differences localized to solved limb polygons, direct-image positions/areas across the weak-field boundary and disk occlusion by colour and vertical order across the full silhouette. World shading checks isolate the surfaces in the default Deep orbit camera: Far Shore's mean lit-side display luminance at its default phase must reach 35% of quarter-lit Lantern's (seen phase 0), using only fully covered pixels with light cosine ≥ 0.35 for both worlds. Far Shore's stretched image must retain an illumination gradient. A quarter-lit Lantern must have at least 2× day/night display luminance. Worlds on/off must preserve settled default exposure within 1%; isolated worlds must leave no bloom halo beyond 1.5 silhouette radii at 2,000, 6,500 and 20,000 K. The starting world silhouettes also clear the HUD boxes at 1440 × 900 and 1000 × 800. Picture checks wait for exposure to settle before measuring. Screenshots and numerical diagnostics are saved under `tmp/browser-out/`, including Mission references after one crew hour at Brink and Map views for Deep orbit and Gargantua at 1440, 1000 and 375 px, plus sphere reference frames and measurements.

The runner prints the engine and WebGL renderer name. On **SwiftShader**, **llvmpipe** and other identified software renderers it skips only checks marked `gpu: true`, printing the reason for each; DOM, input and text-size checks still run. Software rendering uses device pixel ratio 0.25. Explicitly marked UI-only checks additionally cap the WebGL drawing buffers at 4,096 pixels through `?debug=1`; CSS layout, input coordinates, simulation updates and the real quality-controller values remain unchanged. Compatible software UI checks reuse a page after resetting presets, quality, pause, camera, probe, ledger, tabs, panels, scroll and focus through the UI/debug controls. Normal startup/console and absent-debug checks retain fresh pages. Hardware runs retain fresh pages and full rendering, including all pixel assertions.

Every executed check prints its wall time. `tmp/browser-out/timings.json` and `slowest-checks.md` record completed checks, including failures; CI includes the slowest ten in its step summary and keeps its 20-minute job limit. Set `EH_BROWSER_TIMING=1` for detailed `TIMING` JSON lines and events in `timings.json`: creation, load, boot, named wait predicates/timeouts, actions, screenshots, reset and cleanup. Nested event durations are inclusive; do not sum them. The summary is `TOTAL <n> pass <p> fail <f> skip <s>`, including skipped checks in the total, and zero executed checks fails. Force Chromium's SwiftShader backend for a software comparison with:

```sh
EH_FORCE_SOFTWARE=1 EH_BROWSER_TIMING=1 node tests/browser/run.mjs
```

Skipping depends on the detected renderer. For a hardware run, omit `EH_FORCE_SOFTWARE`. Optional host WebKit uses the same checks, including Mission, the worlds picture checks and native two-finger input:

```sh
node tests/browser/run.mjs --engine=webkit
```

WebKit must already be installed for the locked Playwright version (`npx playwright install webkit` is the separate one-time setup); the runner downloads nothing and CI installs only Chromium. `EH_BROWSER_ENGINE=webkit` is equivalent to the flag. WebKit runs pixel checks only when its renderer reports hardware GL, otherwise it prints a skip reason. Native WebKit multi-touch uses the pinned Playwright in-process page-proxy protocol because the public API offers only taps; an unavailable protocol fails the check instead of substituting synthetic events. Software-renderer CI covers interaction and startup; visual acceptance still requires inspecting the default view, presets, fly-in, alignment and probe on hardware GL. No automated checks impose frame-rate or wall-clock performance acceptance thresholds.

For manual inspection, orbit to reveal the secondary disk image, compare the bright and dim sides, try each preset, release a probe and fly toward the final hover. **H** hides the HUD for screenshots or a browser/screen recording. `window.eventHorizon.getState()` exposes copied telemetry, including `settings.spinDelta`, `simulationTime` on the picture clock, `ledger` (`location`, `homeSeconds`, `crewSeconds`, `bodySeconds`), `mission` (`open`, `running`) and `worlds` (entries with `id`, `drawn`, `center` in rₛ, `radius`). Only `?debug=1` adds camera/layer/pause/probe-step controls, `setWorldPhases({ lantern, farShore })` in radians, `setSimulationTime(seconds)` for the picture clock, `setRenderBudget(maxPixels)` for UI-check drawing-buffer limits, and ledger helpers `advanceCrew(seconds)` and `travel(location)` on `window.eventHorizon.debug`. `setLayers` also accepts `worlds`, which defaults to true; Mission and reference-lensing gates still apply. Setting the picture clock through the debug hook leaves the independently accumulated phases intact.
