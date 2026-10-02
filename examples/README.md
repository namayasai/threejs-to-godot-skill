# Examples

Three small examples. Each one is run by a script, and each one fails loudly if something is wrong.

| Example | What it shows |
| --- | --- |
| `01-basic-lit/` | A plane, a cube and a cylinder under a directional and an ambient light. Exported to glTF, rebuilt in Godot from `settings.json`, compared on three viewpoints. Measures the light unit (Godot energy = three.js intensity / PI) and the Burley against Lambert difference |
| `02-toon-outline/` | Toon shading with a 3-step gradient map, inverted-hull outlines, vertex colors and a hemisphere light. None of it survives glTF export; the Godot side rebuilds it with `toon.gdshader` and `outline.gdshader` in `godot/port_hook.gd` |
| `03-physics-recheck/` | Godot only. The protocol for re-verifying physics: path hashes over fresh worlds and across processes, an engine fingerprint to prove which engine ran, and an end-position check against a reference |

## Run

```
export GODOT=/path/to/Godot          # Godot 4.7 executable
(cd ../skills/threejs-to-godot-port/scripts && npm ci && npx playwright install chromium)
./run-all.sh                          # all three; add --record to refresh expected.json and expected/*.png
./run-example.sh 01-basic-lit --controls    # one example, with negative controls
```

A window opens briefly for each Godot capture. Outputs go to `<example>/out/` (ignored by git).

## What a run does (examples 01 and 02)

1. `export-scene.mjs` writes `scene.glb` and the lost-in-translation list.
2. `dump-settings.mjs` writes `scene.settings.json`.
3. `capture-three.mjs` captures the three.js side. It runs twice and the two captures must agree (the reference-stability step).
4. The Godot tests run headless (`godot/tests/cases/`). They check what the importer does and what the port rebuilds.
5. `capture_godot.gd` captures the Godot side from the same `shots.json`.
6. `compare-shots.mjs` compares the two with the example's `thresholds.json`.
7. With `--controls`: deliberately wrong Godot sides are captured and compared. Each must fail, and its worst visual check must be at least 2 times past its limit. A camera-metadata failure alone cannot certify image sensitivity. If a control passes, the thresholds are too loose.

| Control | Mistake | Example |
| --- | --- | --- |
| `no-pi` | Light energy set equal to the three.js intensity | 01, 02 |
| `fov-plus-5` | Field of view 5 degrees off | 01 |
| `no-shadows` | Shadows left off | 01 |
| `linear-colors-as-srgb` | Linear color arrays fed to `source_color` uniforms | 02 |
| `no-outline` | Outline hulls not added | 02 |

## Files in each example

| File | Purpose |
| --- | --- |
| `three/scene.mjs` | The three.js scene (`createScene({ THREE, canvas, width, height })`) |
| `shots.json` | The viewpoints, probe points and flags |
| `example.json` | Hook, options and the list of controls |
| `thresholds.json` | The comparison limits for this example |
| `expected.json` | What was measured on the machine that recorded it, next to the limits |
| `expected/<shot>.png` | The comparison images of a passing run (three.js on top, Godot below) |
| `godot/` | The Godot project. `tg_port/` is copied in at run time and is not committed |

## About the thresholds

They were set to at least twice the measured value on one machine (Apple M1, Metal, Chromium 153, Godot 4.7). Another GPU or driver may need looser limits. The measured values are in `expected.json`; start there when a run fails on a new machine, and write down the reason when you loosen a limit.
