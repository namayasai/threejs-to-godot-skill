# Materials: what carries over, what to rebuild

Evidence marks used in every table:

- [case] measured in the case study (`docs/case-study/`): three.js 0.185.1, Godot 4.7.stable, Apple M1, macOS.
- [measured] measured by this repository's examples or tests with the versions named in `examples/*/expected.json`.
- [source] read from the three.js GLTFExporter source (r185, `examples/jsm/exporters/GLTFExporter.js`).
- [unverified] from documentation or memory. Treat as a hypothesis and check it on a small sample first.

The export tool (`scripts/export-scene.mjs`) reports the loss rules named below (L01 to L13) for your scene.

## 1. Material classes

| three.js | What GLTFExporter writes | What Godot 4.7 does with it | Rebuild in Godot |
| --- | --- | --- | --- |
| `MeshStandardMaterial` | `pbrMetallicRoughness` with color, metalness, roughness, maps [source] | Arrives as `StandardMaterial3D`. Color, roughness and metallic survive; in example 01 the albedo equals the original sRGB color within 1/255 [measured] | Usually nothing. Switch `diffuse_mode` to Lambert (below) |
| `MeshPhysicalMaterial` | Standard fields plus extensions: clearcoat, sheen, transmission, ior, specular, iridescence, volume, dispersion, anisotropy [source] | Clearcoat has a Godot property. No sheen or transmission equivalent in the importer [unverified] | Check each extension you use on a sample. Rebuild missing ones with a shader |
| `MeshBasicMaterial` | `KHR_materials_unlit` [source] | Unlit shading [unverified] | Nothing |
| `MeshLambertMaterial`, `MeshPhongMaterial` | Exported as a standard material and the exporter warns [source] (rule L02) | `StandardMaterial3D` [unverified for the shading change] | Set Lambert diffuse; Phong specular needs a tuned `roughness` |
| `MeshToonMaterial` | Exported as a standard material with a warning (L02). `gradientMap` is dropped silently (L03) [source] | Standard material; no toon look | `shaders/toon.gdshader` plus a nearest-filtered gradient texture. Example 02 [measured] |
| `ShaderMaterial` / `RawShaderMaterial` | The exporter warns and writes no material (L01) [source] | The mesh arrives without it | Rewrite the shader (section 3) |
| `onBeforeCompile` patches | Dropped without a warning (L04) [source] | Not present | Reproduce the patched code in a Godot shader |
| `side: BackSide` | Not written; only `DoubleSide` sets `doubleSided` (L05) [source] | The mesh arrives front-face only. A back-face outline shell becomes a body-sized duplicate that hides the body | Delete the duplicate and rebuild the outline (section 4) |
| `InstancedMesh`, `Points`, `Line`, `Sprite`, `SkinnedMesh` | Instancing uses `EXT_mesh_gpu_instancing`; lines and points are written as glTF line and point primitives [source] | Not measured (L11). Hooks and `apply_settings.gd` match meshes by node name, so an instanced mesh may be missed; `dump-settings.mjs` and `apply_settings.gd` warn | Import a small sample first. A hook should report every mesh it cannot find (example 02's hook does) |
| Vertex colors | `COLOR_0` is written whenever the geometry has a `color` attribute, whatever `material.vertexColors` says (L10) [source] | Vertex colors are kept in the mesh arrays [measured in example 02: the box keeps its colors through the shader] | Use them as linear data (section 4) |

## 2. Material properties

| three.js property | glTF | Notes |
| --- | --- | --- |
| `color`, `opacity` | `baseColorFactor` | Written in linear space [source]. Godot's `albedo_color` accepts the sRGB color you would type as hex [measured: example 01 colors match to 1/255] |
| `transparent`, `alphaTest` | `alphaMode` BLEND or MASK, `alphaCutoff` [source] | Check sorting and shadows on a sample |
| `side` | `doubleSided` only for `DoubleSide` | Front and back culling need to be set by hand |
| `depthWrite`, `depthTest`, `blending`, `flatShading`, `fog`, `toneMapped` | not written | Set in Godot (`BaseMaterial3D` or shader `render_mode`) |
| `wireframe` | Triangles are written as lines [source] | Usually unwanted; check |
| `map`, `normalMap`, `emissiveMap`, `aoMap`, metalness and roughness maps | Textures [source] | Check color space (sRGB vs linear) and `flipY`. glTF has its own convention; the importer handles it [unverified] |
| Texture `repeat`, `offset`, `rotation` | `KHR_texture_transform` [source] | Importer support is [unverified] |
| Mipmaps, anisotropy, filtering | not written | Set in the Godot texture import settings |

## 3. Shader rewrites: GLSL (three.js) to Godot shading language

| three.js / GLSL | Godot | Evidence |
| --- | --- | --- |
| Final clip position `gl_Position` | Override `POSITION` in `vertex()` | [case] |
| Clip space y points up | Godot's clip space y points down (Vulkan and Metal). If you compute a screen-space offset in clip space, flip y | [case] outline missing at the top and bottom edges until flipped; [measured] example 02 |
| `normalMatrix * normal` | `MODELVIEW_NORMAL_MATRIX * NORMAL` | [measured] example 02 outline |
| Per-light diffuse `irradiance * albedo / PI` | In `light()`, `LIGHT_COLOR` already carries a factor of PI; divide by `PI` to get `color * energy` | [case] road brightness L* 54.7 against 55.0 with intensity / PI |
| `uniform` colors given as hex | `uniform vec3 c : source_color` converts from sRGB. Feed it sRGB hex, not the linear array | [measured] example 02 control: linear values into `source_color` fail the comparison by a large margin |
| Texture lookup `texture2D` | `texture(sampler, uv)` | |
| `onBeforeCompile` string replacement | A complete Godot shader | [source] |
| `render_mode` | `cull_front` for back-face shells, `unshaded`, `cull_disabled` for two-sided | [measured] example 02 |

## 4. Recipes

### 4.1 Toon shading (three.js `MeshToonMaterial`)

three.js samples the gradient at `x = dot(N, L) * 0.5 + 0.5` and uses the red channel as the direct-light factor [source]. Without a `gradientMap` it uses a smooth two-step ramp around 0.7 [source]. The direct term is `irradiance * diffuse / PI` [source].

`shaders/toon.gdshader` does the same: it samples a nearest-filtered gradient texture at `dot(NORMAL, LIGHT) * 0.5 + 0.5` and divides by `PI` in `light()`. Build the texture from `settings.json` (`materials[].gradientMap.values`) with `scripts/godot/hull.gd: gradient_texture()`. The values are recorded only when the gradient is a `DataTexture`. For a gradient loaded from an image, `dump-settings.mjs` warns and writes no `gradientMap`; read the few pixel values yourself and add them, or build the texture by hand. The Godot light energy is the three.js intensity divided by PI. Example 02 matches the three.js render within the thresholds in `examples/02-toon-outline/expected.json` [measured].

A hemisphere light is added in `fragment()` as `EMISSION = albedo * mix(ground, sky, 0.5 * n.y + 0.5) * intensity / PI` (the `hemisphere_energy` uniform). This is the route that matched in the case [case] and in example 02 [measured].

### 4.2 Outlines with an inverted hull

A second copy of the mesh is drawn with back faces only and pushed outward by a fixed number of screen pixels along the view-space normal. `shaders/outline.gdshader` does this. Points to get right:

- Use `cull_front` so only the back faces draw. Flip the normal's y when you add the offset in clip space (clip space y points down in Godot) [case].
- Give the hull averaged normals. A box with per-face normals tears at its edges. `hull.gd: smooth_hull()` averages normals over vertices that share a position (rounded to 1 mm). Example 02 tests that a box corner normal points along the diagonal [measured].
- The thickness is given in pixels at 720 lines and scales with the viewport height. The three.js side must use the same rule or the pixel counts differ.
- Delete the imported duplicate shells (L05). Their material arrives front-face only and covers the body.
- In the case the Godot outline looked thinner than the three.js one at the same nominal width, and the width was raised from 2.0 to 2.4 pixels [case]. In example 02 the dark-pixel count in the Godot render is 0.81 to 0.85 times the three.js count at 4 pixels per 720 lines [measured]. Treat the thickness as something to calibrate against the comparison tool, not a constant.
- Hulls cast no shadows (`cast_shadow = OFF`).

### 4.3 Vertex colors

three.js stores vertex colors in linear space (a `Color` object holds linear values). The glTF `COLOR_0` carries them as they are. In a Godot shader use `COLOR.rgb` directly as a linear reflectance. Do not convert it again [measured in example 02: vertex-color box matches]. In the case, the sRGB hex colors were converted to linear when the Godot mesh was built so the same shader rule held [case].

### 4.4 Fading objects

An object that fades in and out needs a transparent material only while it is faded. A transparent material also stops casting shadows and outlines the way an opaque one does. In the case the poles lost their shadow and outline until the code swapped to an opaque material whenever the opacity was 1 [case].

### 4.5 Diffuse model

Godot's `StandardMaterial3D` uses Burley diffuse by default. three.js uses Lambert. With the light energy correct (intensity divided by PI), a roughness-1 floor seen at grazing angles was 3 to 5 levels (of 255) brighter in Godot and the frame's mean L* differed by 1.88 against the three.js render. Setting `diffuse_mode = DIFFUSE_LAMBERT` brought it to 0.04 [measured, example 01]. `build_scene.gd` has the option `imported_lambert`.

Setting `metallic_specular = 0` made the floor 3 levels darker than three.js in the same scene, so leave it at its default for `MeshStandardMaterial` imports [measured].

## 5. What Godot needs that three.js did not

- Triangle winding: Godot treats clockwise as the front face; glTF is counter-clockwise and the importer handles it. For meshes you build in code, flip the winding or build with outward normals. A wrong winding makes the outline hull cover the body and the surface turn black [case] (pitfall P08).
- Two-sided surfaces need `cull_disabled` (or `BaseMaterial3D.CULL_DISABLED`). three.js `DoubleSide` has no equivalent unless you set it.
