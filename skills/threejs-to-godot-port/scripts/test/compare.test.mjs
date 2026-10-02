import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareShot, DEFAULT_THRESHOLDS } from '../compare-shots.mjs';
import { solid, tmpDir, writePng } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'compare-shots.mjs');
const shot = { id: 's', probes: [{ name: 'p', x: 20, y: 20 }], flags: { flatBackground: true } };
const meta = { camera: { position: [0, 1, 2], quaternion: [0, 0, 0, 1], fov: 40, near: 0.1, far: 100 } };

test('identical images pass', () => {
  const img = solid(64, 36, [90, 120, 150], { x: 20, y: 10, w: 20, h: 10 }, [200, 50, 50]);
  const r = compareShot({ shot, ref: img, test: img, refMeta: meta, testMeta: meta, thresholds: DEFAULT_THRESHOLDS });
  assert.equal(r.pass, true);
});

test('a brightness shift fails the luminance checks', () => {
  const a = solid(64, 36, [90, 120, 150]), b = solid(64, 36, [130, 160, 190]);
  const r = compareShot({ shot, ref: a, test: b, refMeta: meta, testMeta: meta, thresholds: DEFAULT_THRESHOLDS });
  assert.equal(r.pass, false);
  const failed = r.checks.filter(c => !c.pass).map(c => c.name);
  assert.ok(failed.includes('meanAbsDiff') && failed.includes('meanLDiff') && failed.includes('probeLDiff:p'));
});

test('different image sizes fail at once', () => {
  const r = compareShot({ shot, ref: solid(64, 36, [1, 2, 3]), test: solid(32, 18, [1, 2, 3]), thresholds: DEFAULT_THRESHOLDS });
  assert.equal(r.pass, false);
  assert.equal(r.checks[0].name, 'imageSize');
});

test('camera differences are checked, fov included', () => {
  const img = solid(64, 36, [90, 120, 150]);
  const other = { camera: { ...meta.camera, fov: 45 } };
  const r = compareShot({ shot, ref: img, test: img, refMeta: meta, testMeta: other, thresholds: DEFAULT_THRESHOLDS });
  assert.ok(r.checks.some(c => c.name === 'cameraFov' && !c.pass));
});

test('per-shot thresholds override the defaults', () => {
  const a = solid(64, 36, [90, 120, 150]), b = solid(64, 36, [92, 122, 152]);
  const strict = compareShot({ shot: { ...shot, thresholds: { meanAbsDiff: 1 } }, ref: a, test: b, thresholds: DEFAULT_THRESHOLDS });
  assert.equal(strict.checks.find(c => c.name === 'meanAbsDiff').pass, false);
  const loose = compareShot({ shot, ref: a, test: b, thresholds: DEFAULT_THRESHOLDS });
  assert.equal(loose.checks.find(c => c.name === 'meanAbsDiff').pass, true);
});

test('dark pixel ratio is checked for outline shots', () => {
  const ref = solid(64, 36, [200, 200, 200], { x: 0, y: 0, w: 60, h: 4 }, [10, 10, 10]);
  const test = solid(64, 36, [200, 200, 200]);
  const r = compareShot({ shot: { id: 'o', flags: { outline: true } }, ref, test, thresholds: DEFAULT_THRESHOLDS });
  assert.equal(r.checks.find(c => c.name === 'darkPixelRatio').pass, false);
});

function setup(testColor) {
  const dir = tmpDir();
  const sheet = { schema: 1, size: { width: 64, height: 36 }, shots: [{ id: 'a', camera: { position: [0, 0, 5], lookAt: [0, 0, 0], fov: 40, near: 0.1, far: 50 } }] };
  fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(sheet));
  writePng(path.join(dir, 'ref', 'a.png'), solid(64, 36, [90, 120, 150]));
  writePng(path.join(dir, 'test', 'a.png'), solid(64, 36, testColor));
  return dir;
}
const run = (dir, extra = []) => spawnSync('node', [script, '--ref', path.join(dir, 'ref'), '--test', path.join(dir, 'test'), '--shots', path.join(dir, 'shots.json'), '--out', path.join(dir, 'out'), ...extra], { encoding: 'utf8' });

test('CLI exit codes: 0 pass, 3 fail, 1 tool error', () => {
  const ok = setup([90, 120, 150]);
  assert.equal(run(ok).status, 0);
  assert.ok(fs.existsSync(path.join(ok, 'out', 'compare', 'a.png')));
  const bad = setup([200, 120, 150]);
  assert.equal(run(bad).status, 3);
  fs.rmSync(path.join(bad, 'test', 'a.png'));
  const missing = run(bad);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /missing image/);
  assert.equal(run(ok, ['--bogus']).status, 1);
});

test('reports contain no absolute paths', () => {
  const dir = setup([90, 120, 150]);
  run(dir, ['--diff']);
  for (const file of ['report.json', 'report.md']) {
    const text = fs.readFileSync(path.join(dir, 'out', file), 'utf8');
    assert.ok(!text.includes(dir), `${file} must not contain the working path`);
    assert.ok(!text.includes(process.env.HOME || '@@none@@'), `${file} must not contain the home directory`);
  }
});

test('unknown threshold names are rejected', () => {
  const dir = setup([90, 120, 150]);
  fs.writeFileSync(path.join(dir, 't.json'), JSON.stringify({ nonsense: 1 }));
  const r = run(dir, ['--thresholds', path.join(dir, 't.json')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown threshold/);
});
