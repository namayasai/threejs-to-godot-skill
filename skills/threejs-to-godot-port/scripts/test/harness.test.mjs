import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('failed Chromium startup closes the HTTP server and every CLI exits', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-startup-test-'));
  try {
    const module = path.join(dir, 'scene.mjs');
    fs.writeFileSync(module, 'export function createScene() { return {}; }\n');
    const shots = path.join(dir, 'shots.json');
    fs.writeFileSync(shots, JSON.stringify({ schema: 1, size: { width: 64, height: 36 }, shots: [{ id: 's', camera: { position: [0, 0, 5], lookAt: [0, 0, 0], fov: 40, near: 0.1, far: 50 } }] }));
    for (const tool of ['export-scene.mjs', 'dump-settings.mjs', 'capture-three.mjs']) {
      const args = [path.join(scripts, tool), '--module', module, '--out', path.join(dir, 'out')];
      if (tool === 'capture-three.mjs') args.push('--shots', shots);
      const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(dir, 'no-browsers'), TG_CHROMIUM_EXECUTABLE: '' } });
      assert.equal(r.error, undefined, `${tool} must exit instead of leaving a listening server: ${r.error}`);
      assert.equal(r.status, 1, `${tool}: ${r.stderr}`);
      assert.match(r.stderr, /Chromium could not start/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
