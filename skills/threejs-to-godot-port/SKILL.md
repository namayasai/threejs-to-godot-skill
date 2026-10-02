---
name: threejs-to-godot-port
description: Port a three.js scene or game to Godot 4 (GDScript) and prove the port matches. Use when migrating three.js or WebGL code, glTF scenes exported from three.js, or three.js lights, materials and cameras to Godot 4.x, or when asked to compare a three.js render with a Godot render. Gives a staged workflow with a pass or fail check at each stage - freeze the three.js reference from fixed viewpoints, carry geometry by glTF or by porting the scene-building code, rebuild materials, lights and environment in Godot, capture the same viewpoints and compare numerically, then re-verify physics instead of assuming it ports. Includes scripts that list what glTF export loses, dump light, camera, fog and background settings to JSON, build the Godot environment from that JSON, and diff paired screenshots. Tested with three.js 0.185.1 and Godot 4.7.
license: MIT
compatibility: Needs Node.js 22 and Playwright Chromium for the three.js side, and Godot 4.7 (GDScript) with a window for captures. Tested on macOS (Apple Silicon) only.
metadata:
  tested-with: "three 0.185.1; Godot 4.7.stable.official.5b4e0cb0f; Playwright 1.63.0 (Chromium 153)"
  repository: "https://github.com/namayasai/threejs-to-godot-skill"
---

# three.js to Godot 4: port and prove it

A port is done when numbers and opened images say so, not when the Godot scene looks plausible. This skill gives the order of work, the check that ends each stage, and tools for the checks.

Paths below are relative to this skill's folder, except `examples/` and `docs/case-study/`. Those two are at the repository root, next to `skills/`, and are lost if you copy only the skill folder (which is what `npx skills add` does). Everything the tools need is inside the skill folder; the examples teach and test the tools. When a step names an example, take it from the repository (https://github.com/namayasai/threejs-to-godot-skill). Evidence marks in the references: [case] measured in the case study, [measured] measured by this repository's examples, [source] read from the exporter source, [unverified] not checked.

## 1. When to use it

Use it to move a three.js scene or game to Godot 4 with GDScript, or to compare a three.js render with a Godot render.

Do not use it for Godot 3, for a one-off model conversion (Blender's glTF import is enough), or when no three.js build can be run to produce reference images. Without a runnable reference, stage 1 cannot be done: tell the human, and do only what does not need it.

**Stop and ask the human** if a Godot window cannot open, if a decision changes the game (for example accepting a different physics result), or if the three.js scene still cannot be rendered the same way twice after you tried to remove time, randomness and animation (stage 1: remove them first; stop and ask only when that fails).

## 2. Ground rules

1. Capture the three.js reference before changing anything in Godot.
2. Write "same" or "matches" only with a number from `compare-shots.mjs` or a named image you opened.
3. Open every comparison image yourself. Write one line per image about overlaps, missing glyphs, missing outlines, crushed colors, missing shadows, stripes.
4. Change one thing at a time and compare after each change.
5. Record versions and the machine in every report.
6. Do not assume physics matches. It is a new system to measure (stage 5).
7. Keep unexplained differences in the report as unexplained. Do not invent a cause.

## 3. Set up

```
export GODOT=/path/to/Godot_4.7_executable
(cd scripts && npm ci && npx playwright install chromium)
node scripts/doctor.mjs
```

Set `TG_CHROMIUM_EXECUTABLE=/path/to/chromium` only when intentionally using an existing Chromium instead of the pinned download; record its actual version.

`doctor.mjs` checks the Node version, three, Chromium with WebGL, the Godot version, and a windowed Godot draw (a test image read back from a `SubViewport`). Check the free disk space first: Chromium and node_modules take several hundred megabytes (estimate).

**Done when** every line of `doctor.mjs` says OK. If one fails, fix it before going on.

## 4. Stage 0: take inventory and choose the carrying path

Give the tools a way to reach the scene.

- Module mode: an ES module that exports `createScene({ THREE, canvas, width, height })` and returns `{ scene, camera, renderer, step?, ready? }`. Use this for scenes you can isolate. See `examples/01-basic-lit/three/scene.mjs`. Only `three` and `three/addons/...` imports are resolved. Any other bare import (for example `cannon-es`) stops with an error that says so; copy or bundle such packages next to the scene file and import them by relative path, or use page mode.
- Page mode: your app's page sets `window.__tgScene`, `window.__tgCamera`, `window.__tgRenderer` (and optionally `window.__tgStep(n)` and `window.__tgReady`). Three lines in your app. `--page <url>` then reads the live scene. If the app runs its own loop (`requestAnimationFrame`, timers), make it stop changing the scene by itself, for example with a flag the loop checks; let `window.__tgStep(n)` advance the scene by n fixed steps, or the scene keeps moving between captures.

```
node scripts/export-scene.mjs --module scene.mjs --out out --name scene
node scripts/dump-settings.mjs --module scene.mjs --out out/scene.settings.json
```

`export-scene.mjs` writes `scene.glb`, `scene.lost.json` and `scene.lost.md`: what the glTF export loses, by rule id (L01 to L13). `dump-settings.mjs` writes lights, camera, fog, background, tone mapping, shadow settings, a material inventory and shadow flags in world space.

Read the lost list. Give every finding a handling: rebuild in Godot, drop, or out of scope. Rules and handlings are in `references/materials.md` and `references/lights-camera-environment.md`.

Choose how geometry will travel:

| Path | Use when | Evidence |
| --- | --- | --- |
| A. glTF | Authored or static meshes and textures. The export shows no geometry findings | Examples 01 and 02 [measured] |
| B. Port the generator code | The scene is built by code with randomness, batching or custom shaders, or the exact layout matters. Port function by function in the same order, draw random numbers in the same order | The case study carried a 40,000-triangle street this way and got the same scene [case] |
| C. Share the data | The scene is described by a data file you can read in Godot. Read the same file; do not convert it | Used for the layout tables in the case [case] |

For path B, write the equality tests before the port: first values of the random sequence, vertex and triangle counts, bounding boxes. A test that reads a table in the source language as text and compares each line to the port's table is cheap and caught mistakes in the case.

**Done when** each finding has a handling, the path is chosen with a reason in one or two lines, and the sources of randomness and time are known.

## 5. Stage 1: freeze the reference

Write `shots.json` with 3 to 13 viewpoints. Format: `scripts/lib/shots.mjs`, example `examples/01-basic-lit/shots.json`. Each shot has a purpose. Choose:

- one overview and one "hero" view
- one near view of a flat lit surface (for brightness and light units) and one near view of a shadow
- one near view for each distinct material kind
- text, thin lines or outlines if the scene has them
- moments that depend on state, named by event and not by clock time

The shot camera uses world-space position/orientation and an effective vertical `fov`; use `camera.getEffectiveFOV()` when deriving it from a zoomed source camera. Fixed capture clears source zoom/view cropping and sizes the render canvas to the sheet.

Add probe points (7 by 7 pixels) at the lit floor, a shaded floor, and each material. Name two of them as the shadow and the light for the shade ratio: `"flags": { "shadeRatio": { "shade": "<probe name>", "lit": "<probe name>" } }`. Other flags: `flatBackground` (checks the two top corners) and `outline` (checks the share of dark pixels).

**`at.step`.** An optional integer per shot: the number of steps to advance before that shot, counted from the scene's current state. The scene is not reloaded between shots, so steps add up in sheet order (a shot at 40 followed by a shot at 66 is captured after 106 steps in all). Order the sheet by time. `--only <id>` limits saved images; both capture tools still traverse the complete sheet and advance skipped shots so the requested timeline remains the same. On the three.js side the harness calls your scene's `step(n)` once with that number; what a step is (its length) is up to your `step` function. On the Godot side n is n physics ticks (`physics_ticks_per_second`); with `--fixed-fps 120` the two draw frames before the image is read add one or two more ticks [measured; without `--fixed-fps` they added 3 to 12], so expect the Godot image to be 1 to 2 ticks past step n for state that changes every tick. Make your three.js steps the same length as the Godot ticks. The tools read only the number. Name the moment by its event in the shot's `id` and `purpose` ("contact"), and keep a table from event names to step numbers in your scene code.

```
node scripts/capture-three.mjs --module scene.mjs --shots shots.json --out out/three
node scripts/capture-three.mjs --module scene.mjs --shots shots.json --out out/three-again
echo '{"meanAbsDiff": 0.1, "meanLDiff": 0.05, "blockLMax": 0.5, "blockLP95": 0.2}' > out/stability.json
node scripts/compare-shots.mjs --ref out/three --test out/three-again --shots shots.json --thresholds out/stability.json --out out/stability
```

The defaults of `compare-shots.mjs` (for example 5 for the mean absolute difference) are for comparing two engines. They are far too loose for checking that one engine repeats itself, so pass the strict limits above. The examples use a fuller set, `examples/stability.json` (repository root), with the same 0.1. In the examples the two captures were identical (difference 0).

**Done when** the two captures pass those limits and you have opened every image. If they differ, remove time, randomness and animation from the scene first: fix seeds, use a fixed time step, stop animations that run by themselves, wait for assets. Only if you cannot remove the cause, stop and ask the human (section 1). Do not go on with an unstable reference.

## 6. Stage 2: carry the shapes

Path A: load `scene.glb` with `scripts/godot/build_scene.gd` (it uses `GLTFDocument` at run time, so no import step is needed). Compare against the three.js scene: mesh and triangle counts, bounding boxes (initial limit: relative 1e-3), node names, scale. Look at an untextured view for gaps and flipped faces.

Path B: write the port and its equality tests.

Godot treats clockwise winding as the front face. A reversed winding turns surfaces black as soon as a back-face outline is added (pitfall P08).

**Done when** counts and bounding boxes agree, no surface is black, and the tests (if any) pass.

## 7. Stage 3: rebuild what glTF cannot carry

Copy `scripts/godot/` into the Godot project as `res://tg_port/`. Build lights, environment and camera from the settings:

```gdscript
const BuildScene := preload("res://tg_port/build_scene.gd")
var settings: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("/path/scene.settings.json"))
var built := BuildScene.build(self, "/path/scene.glb", settings, {"imported_lambert": true})
```

`build_scene.gd` loads the glb, removes lights and cameras that came inside it, and calls `apply_settings.gd` (options are listed at the top of that file). Rebuild materials in a hook (see `examples/02-toon-outline/godot/port_hook.gd`).

Do it in this order, comparing after each step: flat colors, then lights, shadows, outlines, then tone mapping and anti-aliasing.

Rules to apply, with evidence:

- **Light unit: Godot energy = three.js intensity / PI** for directional and ambient light. The glTF importer does not divide, so imported lights are about PI times too bright and lose their aim. Measured: dividing by PI gave a mean difference of 0.09 (scale 0 to 255); a divisor 4.5 percent below PI gave 3.0.
- **Diffuse model:** set Lambert (`imported_lambert`). Godot's default is Burley. Measured: mean L* difference 1.88 with Burley and 0.04 with Lambert.
- **Colors:** pass sRGB hex to `source_color` uniforms and Godot colors; use linear data only for data.
- **Shadows:** set the range per view. The three.js box is fixed; Godot's follows the camera.
- **Toon and outline:** `scripts/godot/shaders/toon.gdshader`, `outline.gdshader`, helpers in `hull.gd`. Delete the duplicate shells the exporter writes for back-face outlines.
- **Hemisphere light:** no Godot counterpart. Use the shader route or calibrate a sky approximation; measured results are in `references/lights-camera-environment.md`.

Keep a short `port-notes.md` in the project: one line per rule you added and why.

**Done when** each step's comparison is better or equal to the previous step's. A step that makes things worse is reverted and investigated.

## 8. Stage 4: capture the same viewpoints and compare

```
$GODOT --path <project> --rendering-method forward_plus --resolution 640x360 --windowed --fixed-fps 120 --audio-driver Dummy \
  res://tg_port/capture.tscn -- --shots shots.json --settings out/scene.settings.json --glb out/scene.glb --out out/godot \
  [--hook res://port_hook.gd] [--opt key=value ...]
node scripts/compare-shots.mjs --ref out/three --test out/godot --shots shots.json --out out/compare --diff
```

Run Godot with a timeout and send its output to a log file. Headless mode does not draw, so captures need a window; tests can be headless.

`compare-shots.mjs` requires valid `<id>.json` sidecars with camera type/pose and `captureDefinition` matching the current size and full ordered camera/step timeline. Missing/malformed sidecars and stale captures are tool errors, not PASS. Re-capture older outputs; use `--image-only` only for an explicitly image-only comparison and report that camera/provenance checks were skipped. It checks, per shot: image size, camera pose and fov, mean absolute difference, mean L*, 16 by 9 block L* (maximum and 95th percentile), hue shares, probe patches, shadow ratio, background corners, dark-pixel ratio for outlines. Exit code 0 means all pass, 3 means a check failed, 1 means the tool failed. The defaults are initial proposals, not derived statistically. In the examples each threshold was set to at least twice the measured value (the dark-pixel ratio is a band), and every visual negative control must fail an image check by at least 2 times its limit; camera metadata alone does not establish image-threshold sensitivity. Calibrate on your scene, and say so when you loosen a limit.

Open every image under `out/compare/compare/` (reference on top, Godot below). One line per image.

If a difference is large, first check that the probes point at the same place in both images. In the case, a large unexplained difference may have been a mis-placed measurement window.

**Done when** every shot passes, or each failing check is written down as a known difference with its cause marked confirmed, probable or unknown. All images must have been opened.

## 9. Stage 5: behavior and physics: re-verify, do not port

Read `references/physics.md`. The short version:

- If you need the same result for the same input, prediction lines that equal the real path, replays or server validation, keep your own fixed-step calculation, port it as code, and use Godot only to draw.
- If the game's feel depends on rules no engine setting gives (falling over on landing, direction-dependent deceleration), keep those rules in code.
- Otherwise measure the built-in engines (Jolt and Godot Physics) with the same scripted inputs as the reference: end positions, time to rest, tunneling, rest jitter, repeats in fresh worlds and in other processes, predictions from a cloned world, cost per step, first contact. Report untuned and tuned values side by side, and say a fit to the reported cases is not a generalization.

The tolerance is the human's decision.

**Done when** a measurement table exists with machine, build and conditions, and a list says what was not measured.

## 10. Stage 6: report

Use three groups, always:

- **Done**: what is finished, with its check.
- **In progress**: what is running or half done.
- **Not verified**: what was skipped, what could not be measured, what was assumed.

For each claim, the number or the image behind it. Include versions, the machine, commands run, known differences with causes, the questions you need answered and what you will do while waiting.

## 11. Tool reference

| Tool | Input | Output |
| --- | --- | --- |
| `scripts/export-scene.mjs` | `--module <file>` or `--page <url>`, `--out <dir>`, `--name`, `--fail-on lost` | `<name>.glb`, `<name>.lost.json`, `<name>.lost.md`. Exit 0 done, 1 failure, 2 findings of severity lost with `--fail-on lost` |
| `scripts/dump-settings.mjs` | `--module` or `--page`, `--out <file>` | `settings.json` (schema 1): renderer, camera, background, fog, lights, objects, materials, and a `warnings` list for what the Godot side cannot carry yet (the CLI prints it to standard error) |
| `scripts/capture-three.mjs` | `--module` or `--page`, `--shots`, `--out`, `--only` | `<id>.png`, `<id>.json` per shot |
| `scripts/godot/capture_godot.gd` (via `capture.tscn`) | see stage 4 | `<id>.png`, `<id>.json` per shot. `--probe` draws a test image |
| `scripts/godot/apply_settings.gd`, `build_scene.gd` | settings dictionary, glb path, options | environment, lights, camera as Godot nodes; a list of approximations |
| `scripts/compare-shots.mjs` | `--ref`, `--test`, `--shots`, `--out`, `--thresholds`, `--diff`, `--image-only` | `compare/<id>.png`, `diff/<id>.png`, `report.json`, `report.md`. Exit 0 pass, 3 fail, 1 tool failure |
| `scripts/doctor.mjs` | `--skip-godot` | OK or NG per check |
| `scripts/godot/run_tests.gd` | `--cases`, `--only` | `ALL TESTS PASSED (...)` or `FAILED (...)` |

Every tool prints its usage with `--help`. Outputs hold no absolute paths and no timestamps, so identical input gives identical output.

Run the tests of the tools themselves: `cd scripts && npm test` (Chromium needed for some) and `GODOT=... scripts/test-godot.sh`. Examples: `examples/run-all.sh` (needs `GODOT`, Chromium and a window).

## 12. Known gaps

Where a tool can detect the case it warns or stops with a message; for the rest, you have to notice. None of these is handled.

| Case | What happens | What to do |
| --- | --- | --- |
| `InstancedMesh` | The exporter writes it with `EXT_mesh_gpu_instancing`. How Godot imports it was not measured. Materials and shadow flags are matched by node name, so an instanced mesh can be missed. `dump-settings.mjs` warns; `apply_settings.gd` notes it | Import a small sample first and look at the node tree. Handle instances in a hook; report any mesh the hook could not find |
| `gradientMap` made from an image | The pixel values are recorded only for a `DataTexture`. For an image texture `dump-settings.mjs` warns and writes no `gradientMap`, so a hook that reads it would fail | Read the values yourself (a gradient has few pixels) and add them, or build the Godot gradient by hand |
| `OrthographicCamera` | `dump-settings.mjs` writes it, but the Godot side falls back to a perspective camera, `shots.json` requires a `fov`, and `capture-three.mjs` refuses it | Not supported by the capture and compare tools. Say so in the report; compare with a perspective camera if you can |
| A camera that looks straight up or down | `lookAt` has no single answer there and three.js and Godot choose a different roll. `shots.json` is rejected with a message | Move the position a little to the side, or give `camera.quaternion` |
| `Fog` and `FogExp2` | The settings carry them, but the curves differ: three.js `Fog` blends with `smoothstep(near, far, depth)` and `FogExp2` with `1 - exp(-density^2 * depth^2)` [source]; Godot has its own. The brightness match was not measured. `dump-settings.mjs` warns | Compare a shot with fog and tune `fog_depth_curve` or the density by eye and by number |
| A JavaScript physics engine in the original (for example `cannon-es`) | There is no tool to record its behavior. Module mode cannot import it (see stage 0) | Record the reference as described in `references/physics.md`, section 6 |

Not tested: three.js before r155 (its light units differ, so the PI rule may not hold), and end-to-end rendering parity on operating systems other than macOS. Linux headless/unit regressions do not establish rendered parity.

## 13. Looking up a symptom

| Symptom | See |
| --- | --- |
| Colors too dark or too light | P24, P20, P22 |
| Everything about 3 times too bright | P07, P21 |
| A black surface | P08 |
| Outline missing at the top and bottom, or a shell covering the body | P06, P08, L05 |
| Shadows jagged, missing, or wrong on a far view | P09, P10 |
| Light shines from the wrong side after import | P21, L13 |
| An impulse does nothing | P05 |
| Different results every run | P18 |
| Screenshot blank | P11 |
| A script hangs or a loop stops | P27, P28 |

All rows: `references/pitfalls.md`.
