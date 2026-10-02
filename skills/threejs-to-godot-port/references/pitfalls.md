# Pitfalls: symptom, cause, fix

Look up by symptom. Each row says how it was found. Marks: [case] = hit during the case study (three.js 0.185.1 to Godot 4.7.stable, Apple M1); [measured] = measured by this repository's examples or tests; [observed] = seen while building this repository, cause not investigated; [unverified] = a worry recorded in the case, not tested.

## Rendering

| ID | Symptom | Cause | Fix | Found by |
| --- | --- | --- | --- | --- |
| P06 | Outline missing on the top and bottom edges of shapes | Godot's clip space has y pointing down. A screen-space offset written in clip space needs y flipped | `vec2 dir = vec2(n.x, -n.y)` before adding the offset in `vertex()` | [case] screenshot review; [measured] example 02 |
| P07 | Everything is about 3.14 times too bright or too dark | A custom `light()` receives `LIGHT_COLOR` with a factor of PI. Or Godot's energy was set equal to the three.js intensity | Godot energy = three.js intensity / PI. In a custom `light()` divide by `PI` | [case] road L* 54.7 against 55.0; [measured] example 01 sweep (divisor PI: mean difference 0.09; divisor 1: 88.96) |
| P21 | Imported scene is too bright and the sun shines horizontally | The glTF importer copies the intensity into `light_energy` without conversion and drops the light's aim. The exporter cannot write the aim unless `light.target` is a child of the light | Strip imported lights; rebuild from `settings.json` (`build_scene.gd` does it) | [measured] `test_example01.gd`: energy 2.5 stays 2.5, rotation is identity |
| P22 | Floor looks lighter toward the horizon; frame mean off by about 2 L* | `StandardMaterial3D` uses Burley diffuse; three.js uses Lambert | `diffuse_mode = DIFFUSE_LAMBERT` (`imported_lambert` option) | [measured] example 01: mean L* difference 1.88 with Burley, 0.04 with Lambert |
| P08 | A roof or surface turns black when an outline hull is added | A mesh with reversed triangle winding. three.js drew it with both sides so it looked fine. Godot's front face is clockwise, and the hull (back faces only) drew over the body | Make normals outward and winding consistent. Check that the hull draws only behind the body | [case] roof of a car |
| P10 | Poles lose their shadow and outline | A fading object kept a transparent material even at full opacity | Use an opaque material while opacity is 1; switch to the transparent one only while fading | [case] |
| P09 | Shadows jagged, missing, or fine on one view and bad on another | A Godot directional shadow follows the camera: max distance, split count, softness. three.js used a fixed box | Tune per view; raise `directional_shadow_max_distance` for high views; use two splits and the highest soft-shadow quality as a start | [case]; [measured] example 01 shadow match with 2 splits and 40 m |
| P23 | Hemisphere ambient does not respond to `ambient_light_energy` | With a sky ambient source, the sky's energy multiplier sets the strength; the environment's ambient energy had no effect | Set `ProceduralSkyMaterial.sky_energy_multiplier`; calibrate against the three.js render | [measured] energy 0.1 and 3 gave the same pixels |
| P24 | Colors too dark after feeding the linear arrays to a shader | `source_color` uniforms convert from sRGB. The linear array was treated as sRGB | Feed sRGB hex to `source_color` uniforms; feed linear data only to non-color uniforms | [measured] example 02 control (fails by 19.9 times the limit) |
| P20 | Vertex colors too bright or too dark | three.js keeps vertex colors linear. If you build the Godot mesh from sRGB hex, convert to linear first. In a shader use `COLOR.rgb` as linear reflectance | Convert once, at mesh build time | [case] design; [measured] example 02 box |
| P25 | A directional light aimed straight down fails or points the wrong way | `Basis.looking_at(dir, Vector3.UP)` fails when `dir` is parallel to up | Use another up vector (`Vector3.FORWARD`) when `abs(dir.dot(up)) > 0.999` | [measured] `test_apply_settings.gd` aims a light straight down |

## Godot scripting

| ID | Symptom | Cause | Fix | Found by |
| --- | --- | --- | --- | --- |
| P01 | A formula written in double precision disagrees with the reference in the 7th digit | `Vector2` and `Vector3` hold 32-bit floats | Do double-precision math with `float` scalars (64-bit). The reference match reached 1e-9 only this way | [case] |
| P02 | `:=` fails: "cannot infer the type" | The right side is untyped (a dictionary value, a `Variant`) | Write the type: `var x: float = d["x"]` | [case] |
| P03 | An element appended to a Packed array disappears | A Packed array taken with `as` from a Variant is a copy. The exact rule was not investigated | Assign the array back after appending, or keep it in a typed variable | [case] |
| P04 | A node cannot be found by its name | Godot replaces `:` in node names | Use `_`. Look up by the sanitized name | [case] |
| P14 | `class_name` types are not found when a project is run without an import step | The class registry lives in `.godot/` | The case used `preload("res://path.gd")` constants instead and never hit the problem. Whether it would have failed was not tested | [unverified] |
| P26 | "ObjectDB instances leaked at exit" messages after a headless script | Nodes were not freed before `quit()` | Cosmetic. Call `free()` on the nodes you created before quitting to silence it | [measured] |
| P27 | A Godot process keeps running after an error in an async script, or hangs when piped to `head` | `quit()` is never reached when a coroutine stops on an error; a closed pipe can stall the process (cause not investigated) | Run Godot under a timeout (`perl -e 'alarm shift; exec @ARGV' 180 ...`) and write its output to a log file | [observed] |
| P28 | A shell loop that reads lines stops after the first Godot call | Godot reads standard input and ate the rest of the loop's input | Run Godot with `< /dev/null` | [observed] |
| P29 | A Godot test run prints `SCRIPT ERROR` and still ends with `ALL TESTS PASSED` | A runtime error inside a test (for example a call to a helper that does not exist) stops that line of the test but does not count as a failure in the runner | Search the log for `SCRIPT ERROR` and treat it as a failure (`test-godot.sh` and the example runners do) | [measured] found while writing example 03 |

## Physics and tests

| ID | Symptom | Cause | Fix | Found by |
| --- | --- | --- | --- | --- |
| P05 | The first impulse has no effect | An impulse given before the first physics step is ignored in both engines | Step the physics a few frames before placing bodies or applying impulses (`run_tests.gd` does 3) | [case] probe P3 |
| P11 | Screenshots are blank or missing under `--headless` | Headless uses a dummy renderer | Capture in a window (`--windowed`) and draw into a `SubViewport` of a fixed size. Use headless for tests only | [case]; [measured] doctor probe |
| P12 | No command-line switch for the physics engine, and the log does not name the engine | Godot 4.7 behavior | Write `override.cfg` with `physics/3d/physics_engine` before the run. Record a fingerprint (resting sink depth, time to sleep) to prove which engine ran | [case] probes P7 and P8 |
| P13 | Headless physics tests run in real time | Physics is paced by the clock | Add `--fixed-fps 120`. The case's test suite dropped from 13.4 s to 0.7 s | [case] |
| P15 | Friction or bounce is not what you set | Friction combines as the smaller value in both engines. Bounce adds (clamped to 0..1) in Jolt; Godot Physics gave a much smaller bounce for a ground drop | Measure the pair you use; set the ground friction to a neutral value so the body's value is the effective one | [case] probe P2 |
| P16 | A rolling cylinder never stops; fast rolls cap out | No rolling resistance in either engine. Jolt's default angular velocity limit is 47.12 rad/s | Add angular damping; raise the limit if the game needs faster spin | [case] probes P1 and P4 |
| P17 | A thin body sinks into the floor and never sleeps (Godot Physics) | Sinks 13 mm and keeps moving 7 to 10 cm after the "stopped" judgment. Jolt: 0 to 1 micrometer sink, sleeps at the threshold | Measure the shapes you use before choosing an engine | [case] |
| P18 | The same input gives a different path | Jolt, same process, 50 fresh-world repeats: one condition changed path from run 37. Across processes: all identical | Test repeats inside one process and across processes. The cause was not investigated | [case] |
| P19 | A body has already moved one step in the frame where the impulse "happens" | The physics step runs before the frame is drawn | Decide whether the impulse goes in the contact step or the next one, and record the choice. Compare at event markers, not clock times | [case] |
