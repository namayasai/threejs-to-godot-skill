#!/usr/bin/env node
// Helper: capture the three.js side of a shot sheet. Same viewpoints are later captured in Godot.
//
// Usage:
//   node capture-three.mjs --module <scene.mjs> --shots <shots.json> --out <dir>
//   node capture-three.mjs --page <url>         --shots <shots.json> --out <dir>
//
// Outputs in <dir>: <id>.png and <id>.json per shot (camera pose, fov, near, far, size, versions).
// Exit codes: 0 done, 1 failure.
import fs from 'node:fs';
import path from 'node:path';
import { openScene, parseArgs, HarnessError } from './lib/harness.mjs';
import { loadShots, ShotsError } from './lib/shots.mjs';

const SPEC = { module: { type: 'string' }, page: { type: 'string' }, shots: { type: 'string', required: true }, out: { type: 'string', required: true }, only: { type: 'string' }, help: { type: 'boolean' } };
const USAGE = `Usage:
  node capture-three.mjs --module <scene.mjs> --shots <shots.json> --out <dir> [--only id1,id2]
  node capture-three.mjs --page <url>         --shots <shots.json> --out <dir> [--only id1,id2]
Exit codes: 0 done, 1 failure.`;

// Runs in the page: put the camera where the shot says, step, render once.
async function frame({ shot, width, height }) {
  const { THREE, scene, camera, renderer, step } = window.__tg;
  if (!camera || !renderer) throw new Error('the scene needs a camera and a renderer to be captured');
  if (!camera.isPerspectiveCamera) throw new Error('only a PerspectiveCamera can be captured and compared: the Godot side is perspective and shots.json needs a fov');
  const cam = shot.camera;
  camera.position.set(...cam.position);
  const up = cam.up || [0, 1, 0];
  camera.up.set(...up);
  if (cam.lookAt) camera.lookAt(new THREE.Vector3(...cam.lookAt));
  else camera.quaternion.set(...cam.quaternion).normalize();
  if (camera.isPerspectiveCamera) { camera.fov = cam.fov; camera.aspect = width / height; }
  camera.near = cam.near;
  camera.far = cam.far;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const n = shot.at && shot.at.step ? shot.at.step : 0;
  if (typeof step === 'function') await step(n);
  else if (n > 0) throw new Error('the shot asks for at.step but the scene gave no step function');
  renderer.render(scene, camera);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  camera.matrixWorld.decompose(p, q, s);
  if (q.w < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
  return { position: p.toArray(), quaternion: q.toArray(), fov: camera.fov, near: camera.near, far: camera.far, revision: THREE.REVISION };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) { console.log(USAGE); return 0; }
  const args = parseArgs(argv, SPEC);
  const sheet = loadShots(args.shots);
  const only = args.only ? new Set(args.only.split(',')) : null;
  const { width, height } = sheet.size;
  const opened = await openScene({ module: args.module, page: args.page, width, height });
  try {
    const outDir = path.resolve(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    const browserVersion = opened.page.context().browser().version();
    let count = 0;
    for (const shot of sheet.shots) {
      if (only && !only.has(shot.id)) continue;
      const camera = await opened.page.evaluate(frame, { shot, width, height });
      const target = opened.mode === 'module' ? opened.page.locator('#c') : opened.page;
      await target.screenshot({ path: path.join(outDir, `${shot.id}.png`), animations: 'disabled' });
      const meta = { id: shot.id, renderer: 'three.js', threeRevision: camera.revision, browser: `Chromium ${browserVersion}`, size: { width, height },
        camera: { position: camera.position, quaternion: camera.quaternion, fov: camera.fov, near: camera.near, far: camera.far } };
      fs.writeFileSync(path.join(outDir, `${shot.id}.json`), JSON.stringify(meta, null, 2) + '\n');
      count++;
    }
    console.log(`captured ${count} shots`);
    return 0;
  } finally {
    await opened.close();
  }
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error instanceof HarnessError || error instanceof ShotsError ? `error: ${error.message}` : error);
  process.exitCode = 1;
});
