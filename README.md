# threejs-to-godot-skill

An agent skill for porting a three.js scene or game to Godot 4 (GDScript), and for proving the port matches.

AI agents can write Godot code from three.js code. What they lack is a way to know the result is right. This skill gives an agent an order of work, a pass or fail check at each stage, and small tools for the checks:

1. Capture the three.js render from fixed viewpoints (the reference).
2. Carry the shapes, either through glTF or by porting the scene-building code.
3. Rebuild what glTF cannot carry (materials, lights, camera, fog, background, shadows) in Godot.
4. Capture the same viewpoints in Godot and compare them numerically, then open every image.
5. Treat physics and determinism as something to measure again, not to port.

It comes from a real port done by an AI agent. The record, with eight side-by-side images, is in [`docs/case-study/`](docs/case-study/README.md).

## What is in this repository

| Path | Purpose |
| --- | --- |
| `skills/threejs-to-godot-port/SKILL.md` | The skill: stages, the check that ends each stage, tool reference |
| `skills/threejs-to-godot-port/references/` | Material mapping, lights, camera and environment mapping, pitfalls (symptom, cause, fix), physics guidance |
| `skills/threejs-to-godot-port/scripts/` | The tools (below), their tests, and the Godot-side scripts and shaders |
| `examples/` | Two small scenes ported end to end, with a comparison that passes and negative controls that must fail |
| `docs/case-study/` | The case study and its physics numbers |
| `.claude-plugin/marketplace.json` | Makes the repository installable as a Claude Code plugin marketplace |

### Tools

| Tool | What it does |
| --- | --- |
| `export-scene.mjs` | Exports a three.js scene to `.glb`, collects the exporter's warnings, audits the scene, and writes a list of what is lost in translation |
| `dump-settings.mjs` | Writes lights, camera, fog, background, tone mapping, shadow settings and a material inventory to JSON |
| `godot/apply_settings.gd`, `godot/build_scene.gd` | Build the Godot environment, lights and camera from that JSON; load the `.glb` |
| `compare-shots.mjs` | Compares paired screenshots (brightness, color, blocks, probes, shadow ratio, outline pixels, camera pose) and writes a side-by-side image and a report |
| `capture-three.mjs`, `godot/capture_godot.gd` | Capture the two sides from one shot sheet |
| `doctor.mjs` | Checks the environment, including that a Godot window can draw |

## Install

Claude Code:

```
claude plugin marketplace add namayasai/threejs-to-godot-skill
claude plugin install threejs-to-godot-port@threejs-to-godot-skill
```

Other agents that read `SKILL.md` skills:

```
npx skills add namayasai/threejs-to-godot-skill
```

Or copy `skills/threejs-to-godot-port/` into your agent's skills folder.

**What an install of the skill folder contains.** The skill is the folder `skills/threejs-to-godot-port/`: `SKILL.md`, `references/` and `scripts/` (every tool, test and Godot script the workflow needs). `npx skills add` and a manual copy take only that folder. `examples/` and `docs/case-study/` are at the repository root, next to `skills/`, and are left behind. `SKILL.md` names them in places; take them from this repository when you want to run the examples or read the case study.

Status of these commands: the skill folder and the marketplace file pass `claude plugin validate`. Installing from GitHub was not tried before publication, so the commands above are untested.

## Requirements

- Node.js 22 (tested with 22.14.0), then `cd skills/threejs-to-godot-port/scripts && npm ci && npx playwright install chromium`
- Godot 4.7 (tested with 4.7.stable.official.5b4e0cb0f); set the environment variable `GODOT` to the executable
- A display for Godot captures (headless Godot does not draw). Tests run headless.
- Tested on macOS (Apple Silicon) only. Windows and Linux are untested.

Then check the setup:

```
node skills/threejs-to-godot-port/scripts/doctor.mjs
```

## Run the examples

```
export GODOT=/path/to/Godot
examples/run-all.sh
```

Each example exports a three.js scene, builds the Godot side, captures both, and compares. After a passing run, the script also runs negative controls: deliberately wrong Godot sides (for example, forgetting to divide the light intensity by PI) that the comparison must reject. See `examples/README.md`.

## Tests

```
cd skills/threejs-to-godot-port/scripts
npm test                              # unit tests and Chromium tests
GODOT=/path/to/Godot ./test-godot.sh  # Godot-side unit tests, headless
```

## What was measured, and what was not

Measured here (three.js r185, Godot 4.7.stable, Apple M1): the light unit (Godot energy equals three.js intensity divided by PI; the glTF importer does not convert), the diffuse model (Burley against Lambert), what the glTF importer does with lights, materials and shadows, the loss list for the two example scenes, and that capture and comparison are stable. The page mode (`--page`) was also run against a real application scene of 216 objects, which is not part of this repository. The numbers are in `examples/*/expected.json` and in the references.

Not measured: other platforms, other versions, point and spot light attenuation, fog curves, orthographic cameras, many materials from the glTF extensions, frame rate. Such rows in the references are marked unverified.

The comparison thresholds are initial proposals. They were calibrated on two small scenes on one machine. Calibrate them on your own scene.

## Known gaps

Where a tool can detect one of these, it warns or stops with a message. None of them is handled.

- **`InstancedMesh`**: how Godot imports the exporter's `EXT_mesh_gpu_instancing` output was not measured. A hook matches meshes by node name, so an instanced mesh can be missed. `dump-settings.mjs` and `apply_settings.gd` warn.
- **A `gradientMap` made from an image**: pixel values are recorded only for a `DataTexture`. `dump-settings.mjs` warns and writes no `gradientMap`.
- **`OrthographicCamera`**: `dump-settings.mjs` writes it and warns, the Godot side falls back to a perspective camera, `shots.json` requires a `fov`, and `capture-three.mjs` refuses it. Not supported by capture and compare.
- **A camera that looks straight up or down**: `lookAt` has no single answer; `shots.json` is rejected. Offset the position or give a quaternion.
- **`Fog` and `FogExp2`**: the curves differ between three.js and Godot, and the brightness match was not measured. `dump-settings.mjs` warns.
- **A JavaScript physics engine in the original (for example cannon-es)**: no tool records its behavior, and module mode cannot import it. See `references/physics.md`, section 6.
- **Other bare imports in module mode**: only `three` and `three/addons/...` resolve. Use relative imports or page mode.
- **three.js before r155**: not tested. Its light units differ, so the divide-by-PI rule may not hold.
- **Operating systems other than macOS**: not tested.
- **Not measured**: point and spot light attenuation, tone mapping other than none, exposure, the glTF material extensions, frame rate.

## Third-party software

This repository does not include or redistribute third-party code. It depends on, at run time:

- three.js (MIT), including its `GLTFExporter`
- Playwright (Apache-2.0) and the Chromium it downloads
- pngjs (MIT)
- Godot Engine (MIT), which you install yourself

Versions are pinned in `skills/threejs-to-godot-port/scripts/package-lock.json`.

## License

MIT. See `LICENSE`.

---

## 日本語の要約

three.js のシーンやゲームを Godot 4（GDScript）へ移し、移した結果が合っていることを確かめるための、AI エージェント向けの Skill です。

AI は three.js のコードから Godot のコードを書けます。足りないのは「合っている」と言える根拠です。この Skill は、作業の順番、各段階の「できた」の判定、判定のための小さな道具を渡します。

1. three.js の画面を決まった視点で撮る（基準）
2. 形を運ぶ（glTF で運ぶか、シーンを作るコードを写す）
3. glTF で運べない物（材質、光、カメラ、霧、背景、影）を Godot 側で作り直す
4. 同じ視点で Godot の画面を撮り、数で比べ、比較画像を全部開いて見る
5. 物理と決定性は「移す」のではなく、もう一度測る

道具は4つです。失われた物の一覧を出す書き出し、光やカメラの設定を JSON にする書き出し、その JSON から Godot の環境を組む GDScript、前後の画像を並べて差を数える比較です。小さな2つの例では、比較が通ることと、わざと間違えた Godot 側が落ちることを確かめてあります。

実測した主なことは次のとおりです（three.js r185、Godot 4.7、Apple M1）。Godot の光の強さは three.js の強さを π で割った値で合います（glTF の取り込みは換算しません）。Godot の標準材質の既定は Burley の拡散で、three.js の Lambert とは明るさが少し違います。

事例は `docs/case-study/` にあります。AI が実際に three.js の場面を Godot へ移した経緯、踏んだ落とし穴、比べた画像8枚、物理の測定です。測っていないこと（他の機械、他の版、フレームレート）は、そう書いてあります。比べる基準の数値は初期案で、1台の機械の2つの小さな場面で決めたものです。自分の場面で調整してください。

Skill の本体は `skills/threejs-to-godot-port/` のフォルダです。`npx skills add` や手作業でこのフォルダだけを写すと、リポジトリ直下の `examples/` と `docs/case-study/` は付いてきません。例と事例は、このリポジトリから取ってください。

まだ扱えないこと（InstancedMesh、画像から作った gradientMap、OrthographicCamera、真上や真下を見るカメラ、霧の曲線の違い、JavaScript の物理エンジンの基準の記録、three.js r155 より前、macOS 以外）は、英語の「Known gaps」の節に並べてあります。道具が見つけられるものは、警告を出すか、理由を書いて止まります。

ライセンスは MIT です。
