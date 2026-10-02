# Lights, camera, environment

Evidence marks: [case] = measured in the case study; [measured] = measured by this repository's examples and tests (three.js r185, Godot 4.7.stable.official.5b4e0cb0f, Metal and Forward+, Apple M1; values are in `examples/*/expected.json`); [source] = read from the GLTFExporter source (r185); [unverified] = from documentation or memory, check before relying on it.

`scripts/dump-settings.mjs` writes everything below to `settings.json`. `scripts/godot/apply_settings.gd` rebuilds it in Godot.

## 1. The light unit: divide by PI

three.js (r155 and later) computes the diffuse light of a directional light as `color * intensity * N.L * albedo / PI`. Godot's light energy has no such division: for the built-in material the result is `color * energy * N.L * albedo`.

Result: **Godot energy = three.js intensity / PI**, for Lambert-like diffuse light, for directional and ambient light.

How this was measured [measured, example 01]: the same scene (plane, cube, cylinder, one directional and one ambient light) was rendered in three.js and in Godot with `energy = intensity / divisor`, and compared on three shots.

| divisor | mean abs difference, top view (0 to 255) | lit-floor difference, front view (L*) |
| --- | --- | --- |
| 1 (energy = intensity) | 88.96 | 34.19 |
| 2 | 30.31 | 11.93 |
| 3 | 3.01 | 1.25 |
| 3.14159 (PI) | 0.09 | 0.00 |
| 4 | 13.91 | 5.80 |
| 6 | 34.20 | 14.34 |

PI appears twice in this skill, and it is not a double division. The light's energy is set to `intensity / PI` because three.js divides its diffuse term by PI. A custom `light()` function (as in `shaders/toon.gdshader`) then divides `LIGHT_COLOR` by `PI` only to cancel the PI that Godot multiplies into `LIGHT_COLOR`; the shader's result is `color * energy * step`, which equals three.js's `color * intensity * step / PI`. Count one division in total.

The comparison is sharp: a divisor 4.5 percent below PI already shows a mean difference of 3. The case study found the same factor with a custom toon shader (road L* 54.7 against 55.0) [case].

The glTF importer does **not** convert: a three.js directional light with intensity 2.5 arrives as a `DirectionalLight3D` with `light_energy = 2.5` [measured, `test_example01.gd`]. Imported lights are therefore about PI times too bright. `build_scene.gd` strips lights that came inside the glTF and rebuilds them from `settings.json` with the division. Pass `{"light_unit": "raw"}` to see the difference, or `{"light_divisor": n}` to sweep.

Point and spot lights use candela in three.js (inverse-square falloff) and a different attenuation model in Godot. `apply_settings.gd` copies range and cone angle and divides the intensity by PI, but this was not measured [unverified]. Check it with `compare-shots.mjs` before trusting it.

## 2. Lights

| three.js | glTF export | Godot import | Rebuild |
| --- | --- | --- | --- |
| `DirectionalLight` | `KHR_lights_punctual` directional with color and intensity [source]. The aim is written only if `light.target` is a child of the light at (0, 0, -1); otherwise the exporter warns (L13) [source] | `DirectionalLight3D`, position kept, **no rotation**, `light_energy` equals the three.js intensity, `shadow_enabled` false [measured] | Aim from `settings.json` `direction`; `apply_settings.gd` does it |
| `PointLight`, `SpotLight` | punctual lights with range and cone angles; decay other than 2 is warned (L07) [source] | not measured | `OmniLight3D`, `SpotLight3D` (best effort, see above) |
| `AmbientLight` | not exported; the exporter warns (L06) [source]. Arrives as an empty node [measured] | none | `Environment.ambient_light_*` with energy = intensity / PI [measured] |
| `HemisphereLight` | not exported (L06) [source] | none | See section 3 |
| `RectAreaLight`, `LightProbe` | not exported (L06) [source] | none | No direct counterpart [unverified] |
| `light.castShadow`, `mesh.castShadow`, `mesh.receiveShadow` | not written (L08) [source] | Meshes cast shadows by default and imported lights do not [measured]; Godot has no per-mesh receive flag [unverified] | `shadow_enabled` on lights; `cast_shadow` per mesh from `settings.json` `objects[]` |

Light colors: pass the sRGB hex to `light_color`. The example matches to about 0.05 L* [measured].

## 3. Hemisphere light

three.js blends a sky color and a ground color by the surface normal's up component. Godot has no such light. Three ways were measured on a gray scene (three.js hemisphere intensity 2.0; surfaces: up-facing floor, top and bottom of a sphere, side of a box; L* values, three.js against Godot) [measured, scratch scene, not part of the shipped examples]:

| Approximation | floor | sphere top | sphere bottom | box side |
| --- | --- | --- | --- | --- |
| `hemisphere: flat` (sky and ground averaged, one ambient color, energy intensity / PI) | 50.8 / 34.8 | 48.9 / 34.8 | 28.4 / 34.8 | 39.4 / 34.8 |
| `hemisphere: sky` (procedural sky, `sky_energy_multiplier` = intensity / PI) | 50.8 / 38.6 | 48.9 / 37.4 | 28.4 / 27.6 | 39.4 / 32.3 |
| `hemisphere: sky` with `hemisphere_scale` 1.3 | 50.8 / 49.9 | 48.9 / 47.9 | 28.4 / 30.8 | 39.4 / 39.3 |

- `flat` loses all orientation dependence.
- `sky` keeps it. With a sky ambient source, `Environment.ambient_light_energy` had no effect in these runs; the sky's energy multiplier carries the intensity.
- The scale that matched (1.3) is an empirical value for this scene. It is not a constant. Calibrate with `compare-shots.mjs`.
- A custom shader that adds the hemisphere term itself (the route in `shaders/toon.gdshader`) matched in the case [case] and in example 02 [measured]. Set `hemisphere: none` so `apply_settings.gd` does not add it twice.

## 4. Shadows

| Topic | three.js | Godot | Evidence |
| --- | --- | --- | --- |
| Range | A fixed orthographic box set by `shadow.camera` | A directional light's shadow follows the camera: `directional_shadow_max_distance`, split count, blend | [case] |
| Resolution | `shadow.mapSize` | Project setting `rendering/lights_and_shadows/directional_shadow/size`, soft shadow filter quality | [case] |
| Bias | `shadow.bias`, `normalBias` | `shadow_bias`, `shadow_normal_bias`; the numbers do not translate | [case] |
| Edges | PCF variants | Softer by default | [case], [measured: edge pixels dominate the block differences] |

What matched in example 01 [measured]: with two shadow splits, a 40 m maximum distance and the project settings in `examples/01-basic-lit/godot/project.godot`, the shadow footprint matched within the examples' thresholds (shade ratio difference at most 0.0001). In the case, the first settings gave jagged edges. They were fixed by two splits, a split offset of 0.5, a maximum distance of 45 m (140 m for high views) and the highest soft-shadow quality [case]. Settings that work for one camera distance can fail for another; set the maximum distance per view.

Self-shadow noise ("shadow acne") shows on curved surfaces near the terminator in three.js; a small `normalBias` (0.03 in example 02) removes it. In `outline-closeup`, the shaded side of a cylinder was darker in Godot than in three.js [measured: visible in `examples/02-toon-outline/expected/outline-closeup.png`; cause not investigated].

## 5. Camera

| three.js | Godot | Evidence |
| --- | --- | --- |
| `PerspectiveCamera.fov` is the vertical field of view in degrees | `Camera3D.fov` is vertical when `keep_aspect = KEEP_HEIGHT` | [measured] position, orientation and fov match exactly in examples 01 and 02 |
| `near`, `far`, `aspect` | `near`, `far`; aspect follows the viewport | [measured] |
| Right-handed, y up, the camera looks down -z | The same. No axis conversion is needed between three.js world coordinates and Godot, nor for glTF | [measured] `camera.lookAt` and `Basis.looking_at` give the same quaternion |
| Quaternion order (x, y, z, w) | `Quaternion(x, y, z, w)` | [measured] |
| `OrthographicCamera` | `Camera3D` with `PROJECTION_ORTHOGONAL` and `size` | [unverified]. Not supported by the tools: `dump-settings.mjs` writes it and warns, `apply_settings.gd` falls back to a perspective camera and says so in its notes, `shots.json` requires a `fov`, and `capture-three.mjs` refuses it |

A camera that looks straight up or down is a special case: `lookAt` has no single answer, and three.js and Godot choose a different roll. `shots.json` rejects it; offset the position a little or give a quaternion.

If your application uses its own world axes (for example east, north, up), that mapping is application code, not part of the three.js to Godot step. Write it as one function and test it with a round trip [case].

## 6. Environment and output

| Topic | three.js | Godot | Evidence |
| --- | --- | --- | --- |
| Background color | `scene.background = Color` | `Environment.background_mode = BG_COLOR` with `background_color` (sRGB hex) | [measured] the top corner pixels are identical in every shot |
| Tone mapping | `renderer.toneMapping` | `Environment.tonemap_mode`: LINEAR, REINHARDT, FILMIC, ACES, AGX exist in 4.7 [measured: ClassDB]. `NoToneMapping` maps to LINEAR and matched [measured] | other mappings: names map by name only [unverified] |
| Exposure | `toneMappingExposure` | `tonemap_exposure` | [unverified] |
| Output color space | sRGB | Standard sRGB output | [measured] |
| Fog | `Fog(near, far)` blends with `smoothstep(near, far, depth)`; `FogExp2` with `1 - exp(-density^2 * depth^2)` [source] | `fog_mode` has EXPONENTIAL and DEPTH in 4.7 [measured: ClassDB]. `Fog` maps to depth fog (curve set by `fog_depth_curve`); `FogExp2` maps to exponential fog with its own curve. `dump-settings.mjs` warns | brightness match [unverified] |
| Anti-aliasing | `antialias: true` (browser MSAA) | `SubViewport.msaa_3d = MSAA_4X` or the project setting | [case], [measured] |
| Glow, SSAO, SSR | none by default | off by default; keep them off | [case] |
| Renderer | WebGL | Forward+ drew correctly on Metal; fall back to Mobile if it does not | [case], [measured] |

glTF carries none of this (L09). `settings.json` has all of it.

## 7. Capture conditions that make the comparison fair

- Render the Godot image into a `SubViewport` of the exact size in `shots.json`. The window size and the display's pixel ratio then do not matter [case], [measured].
- Headless Godot does not draw. Use a window (`--windowed`) for captures and `--headless` for tests only [case], [measured].
- Draw two frames after changing the camera before reading the image back [measured: `capture_godot.gd`].
- Capture the three.js side twice; the two images should be identical or nearly so. In the examples they were identical (mean absolute difference 0) [measured, Chromium 153.0.8010.12 headless]. If they differ, remove time, randomness and animation from the scene before comparing anything else.
