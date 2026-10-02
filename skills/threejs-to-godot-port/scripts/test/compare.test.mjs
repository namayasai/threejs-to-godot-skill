import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { compareShot, DEFAULT_THRESHOLDS } from '../compare-shots.mjs';
import { captureDefinition } from '../lib/shots.mjs';
import { solid, tmpDir, writePng } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'compare-shots.mjs');
const camera = { position: [0, 1, 2], quaternion: [0, 0, 0, 1], fov: 40, near: 0.1, far: 100 };
const shot = { id: 's', camera, probes: [{ name: 'p', x: 20, y: 20 }], flags: { flatBackground: true } };
const sheet = { schema: 1, size: { width: 64, height: 36 }, shots: [shot] };
const meta = { id: shot.id, size: sheet.size, camera: { type: 'perspective', ...camera }, captureDefinition: captureDefinition(sheet) };
const compare = options => compareShot({ sheet, shot, refMeta: meta, testMeta: meta, thresholds: DEFAULT_THRESHOLDS, ...options });

test('identical images pass', () => {
  const img = solid(64, 36, [90, 120, 150], { x: 20, y: 10, w: 20, h: 10 }, [200, 50, 50]);
  const r = compare({ ref: img, test: img });
  assert.equal(r.pass, true);
});

test('a brightness shift fails the luminance checks', () => {
  const a = solid(64, 36, [90, 120, 150]), b = solid(64, 36, [130, 160, 190]);
  const r = compare({ ref: a, test: b });
  assert.equal(r.pass, false);
  const failed = r.checks.filter(c => !c.pass).map(c => c.name);
  assert.ok(failed.includes('meanAbsDiff') && failed.includes('meanLDiff') && failed.includes('probeLDiff:p'));
});

test('different image sizes fail at once', () => {
  const r = compare({ ref: solid(64, 36, [1, 2, 3]), test: solid(32, 18, [1, 2, 3]), imageOnly: true });
  assert.equal(r.pass, false);
  assert.equal(r.checks[0].name, 'imageSize');
});

test('camera differences are checked, fov included', () => {
  const img = solid(64, 36, [90, 120, 150]);
  const other = { ...meta, camera: { ...meta.camera, fov: 45 } };
  const r = compare({ ref: img, test: img, testMeta: other });
  assert.ok(r.checks.some(c => c.name === 'cameraFov' && !c.pass));
});

test('per-shot thresholds override the defaults', () => {
  const a = solid(64, 36, [90, 120, 150]), b = solid(64, 36, [92, 122, 152]);
  const strict = compare({ shot: { ...shot, thresholds: { meanAbsDiff: 1 } }, ref: a, test: b });
  assert.equal(strict.checks.find(c => c.name === 'meanAbsDiff').pass, false);
  const loose = compare({ ref: a, test: b });
  assert.equal(loose.checks.find(c => c.name === 'meanAbsDiff').pass, true);
});

test('dark pixel ratio is checked for outline shots', () => {
  const ref = solid(64, 36, [200, 200, 200], { x: 0, y: 0, w: 60, h: 4 }, [10, 10, 10]);
  const test = solid(64, 36, [200, 200, 200]);
  const r = compare({ shot: { ...shot, flags: { outline: true } }, ref, test });
  assert.equal(r.checks.find(c => c.name === 'darkPixelRatio').pass, false);
});

function writeSidecars(dir, sheet) {
  for (const side of ['ref', 'test']) {
    for (const shot of sheet.shots) {
      const quaternion = shot.camera.quaternion ? new Quaternion(...shot.camera.quaternion).normalize().toArray() : new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(new Vector3(...shot.camera.position), new Vector3(...shot.camera.lookAt), new Vector3(...(shot.camera.up ?? [0, 1, 0])))).normalize().toArray();
      const meta = { id: shot.id, size: sheet.size, camera: { type: 'perspective', position: shot.camera.position, quaternion, fov: shot.camera.fov, near: shot.camera.near, far: shot.camera.far }, captureDefinition: captureDefinition(sheet) };
      fs.writeFileSync(path.join(dir, side, `${shot.id}.json`), JSON.stringify(meta));
    }
  }
}

function setup(testColor, extraShots = []) {
  const dir = tmpDir();
  const sheet = { schema: 1, size: { width: 64, height: 36 }, shots: [{ id: 'a', camera: { position: [0, 0, 5], lookAt: [0, 0, 0], fov: 40, near: 0.1, far: 50 } }] };
  sheet.shots.push(...extraShots);
  fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(sheet));
  for (const shot of sheet.shots) {
    writePng(path.join(dir, 'ref', `${shot.id}.png`), solid(64, 36, [90, 120, 150]));
    writePng(path.join(dir, 'test', `${shot.id}.png`), solid(64, 36, testColor));
  }
  writeSidecars(dir, sheet);
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

test('missing or malformed sidecars cannot silently pass identical PNGs', () => {
  for (const side of ['ref', 'test']) {
    for (const contents of [undefined, '{broken', 'null', '{}']) {
      const dir = setup([90, 120, 150]);
      const file = path.join(dir, side, 'a.json');
      if (contents === undefined) fs.rmSync(file);
      else fs.writeFileSync(file, contents);
      const r = run(dir);
      assert.equal(r.status, 1, `${side} sidecar ${contents}: ${r.stdout} ${r.stderr}`);
      assert.match(r.stderr, /sidecar/);
      assert.ok(!r.stdout.includes('PASS'));
      assert.equal(run(dir, ['--image-only']).status, 0, 'PNG-only compatibility must be explicit');
    }
  }
});

test('strict sidecar IDs, dimensions, camera and capture provenance are validated', () => {
  const cases = [
    [m => { m.id = 'wrong'; }, /id/],
    [m => { delete m.size; }, /size/],
    [m => { m.size.width = 32; }, /PNG/],
    [m => { m.size.height = '36'; }, /size/],
    [m => { delete m.camera; }, /camera/],
    [m => { delete m.camera.type; }, /camera.type/],
    [m => { m.camera.type = 'orthographic'; }, /camera.type/],
    [m => { m.camera.position = [0, null, 5]; }, /position/],
    [m => { m.camera.position = [0, 5]; }, /position/],
    [m => { m.camera.quaternion = [0, 0, 0, 0]; }, /quaternion/],
    [m => { m.camera.quaternion = [0, 0, 0, 2]; }, /quaternion/],
    [m => { m.camera.quaternion = [0, 0, '0', 1]; }, /quaternion/],
    [m => { delete m.camera.fov; }, /fov/],
    [m => { m.camera.fov = 180; }, /fov/],
    [m => { m.camera.fov = '40'; }, /fov/],
    [m => { m.camera.near = 0; }, /near/],
    [m => { m.camera.far = m.camera.near; }, /far/],
    [m => { delete m.captureDefinition; }, /captureDefinition/],
    [m => { m.captureDefinition = {}; }, /captureDefinition/],
  ];
  for (const side of ['ref', 'test']) {
    for (const [mutate, pattern] of cases) {
      const dir = setup([90, 120, 150]);
      const file = path.join(dir, side, 'a.json');
      const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
      mutate(meta);
      fs.writeFileSync(file, JSON.stringify(meta));
      const r = run(dir);
      assert.equal(r.status, 1, `${side}: ${r.stdout} ${r.stderr}`);
      assert.match(r.stderr, pattern);
    }
  }
});

test('matching old captures fail when any frame definition changes, fresh captures pass', () => {
  const mutations = [
    s => { s.shots[0].camera.position[0] += 1; },
    s => { s.shots[0].camera.lookAt[0] += 1; },
    s => { s.shots[0].camera.up = [1, 0, 0]; },
    s => { delete s.shots[0].camera.lookAt; s.shots[0].camera.quaternion = [0, 0, 0, 1]; },
    s => { s.shots[0].camera.fov += 5; },
    s => { s.shots[0].camera.near += 0.1; },
    s => { s.shots[0].camera.far += 5; },
    s => { s.shots[0].at = { step: 10 }; },
    s => { s.size = { width: 128, height: 72 }; },
  ];
  for (const mutate of mutations) {
    const dir = setup([90, 120, 150]);
    assert.equal(run(dir).status, 0, 'fresh paired captures initially pass');
    const file = path.join(dir, 'shots.json');
    const sheet = JSON.parse(fs.readFileSync(file, 'utf8'));
    mutate(sheet);
    fs.writeFileSync(file, JSON.stringify(sheet));
    const stale = run(dir);
    assert.equal(stale.status, 3, stale.stdout + stale.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
    for (const label of ['reference', 'test']) assert.equal(report.shots[0].checks.find(c => c.name === `captureDefinition:${label}`).pass, false);
    // Simulate newly generated paired outputs carrying the updated capture contract.
    for (const side of ['ref', 'test']) writePng(path.join(dir, side, 'a.png'), solid(sheet.size.width, sheet.size.height, [90, 120, 150]));
    writeSidecars(dir, sheet);
    assert.equal(run(dir).status, 0, 'fresh captures matching the new sheet pass');
  }
});

test('capture provenance binds shot order and earlier cumulative steps', () => {
  for (const mutate of [s => { s.shots.reverse(); }, s => { s.shots[0].at.step += 1; }]) {
    const dir = setup([90, 120, 150], [{ id: 'b', camera: { position: [0, 0, 5], lookAt: [0, 0, 0], fov: 40, near: 0.1, far: 50 }, at: { step: 3 } }]);
    const file = path.join(dir, 'shots.json');
    const sheet = JSON.parse(fs.readFileSync(file, 'utf8'));
    sheet.shots[0].at = { step: 2 };
    fs.writeFileSync(file, JSON.stringify(sheet));
    writeSidecars(dir, sheet);
    assert.equal(run(dir).status, 0);
    mutate(sheet);
    fs.writeFileSync(file, JSON.stringify(sheet));
    assert.equal(run(dir).status, 3);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
    assert.equal(report.summary.failed, 2, 'later images must be invalidated by earlier timeline changes');
  }
});

test('both PNGs must match expected sheet dimensions, including in image-only mode', () => {
  const dir = setup([90, 120, 150]);
  const file = path.join(dir, 'shots.json');
  const sheet = JSON.parse(fs.readFileSync(file, 'utf8'));
  sheet.size.width = 128;
  fs.writeFileSync(file, JSON.stringify(sheet));
  for (const extra of [[], ['--image-only']]) {
    assert.equal(run(dir, extra).status, 3);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
    assert.equal(report.shots[0].checks.find(c => c.name === 'expectedImageSize').pass, false);
  }
});

test('probes, thresholds and descriptive edits do not invalidate captures', () => {
  const dir = setup([90, 120, 150]);
  const file = path.join(dir, 'shots.json');
  const sheet = JSON.parse(fs.readFileSync(file, 'utf8'));
  sheet.shots[0].purpose = 'A clearer description';
  sheet.shots[0].probes = [{ name: 'new-probe', x: 20, y: 20 }];
  sheet.shots[0].thresholds = { meanAbsDiff: 1 };
  fs.writeFileSync(file, JSON.stringify(sheet));
  assert.equal(run(dir).status, 0);
});

test('capture definitions compare by structure regardless of JSON key order', () => {
  const dir = setup([90, 120, 150]);
  const file = path.join(dir, 'test', 'a.json');
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  const reverse = value => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reverse(v)])) : value;
  fs.writeFileSync(file, JSON.stringify(reverse(meta)));
  assert.equal(run(dir).status, 0);
});

test('camera-only FOV failure cannot qualify a visually insensitive control', () => {
  const dir = setup([90, 120, 150]);
  const file = path.join(dir, 'test', 'a.json');
  const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
  meta.camera.fov += 5;
  fs.writeFileSync(file, JSON.stringify(meta));
  assert.equal(run(dir).status, 3);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
  assert.equal(report.summary.maxFailFactor, 500);
  assert.equal(report.summary.maxCameraFailFactor, 500);
  assert.equal(report.summary.maxVisualFailFactor, null);
  assert.ok(!(Number(report.summary.maxVisualFailFactor) >= 2));
  writePng(path.join(dir, 'test', 'a.png'), solid(64, 36, [200, 200, 200]));
  assert.equal(run(dir).status, 3);
  const sensitive = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
  assert.ok(sensitive.summary.maxVisualFailFactor >= 2);
});

test('fresh provenance cannot disguise both engines using the same wrong actual camera', () => {
  const cases = [
    [m => { m.camera.position[0] += 1; }, 'requestedCameraPosition'],
    [m => { m.camera.quaternion = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; }, 'requestedCameraOrientationDeg'],
    [m => { m.camera.fov += 5; }, 'requestedCameraFov'],
    [m => { m.camera.near += 0.01; }, 'requestedCameraNear'],
    [m => { m.camera.far += 5; }, 'requestedCameraFar'],
  ];
  for (const [mutate, name] of cases) {
    const dir = setup([90, 120, 150]);
    for (const side of ['ref', 'test']) {
      const file = path.join(dir, side, 'a.json');
      const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
      mutate(meta);
      fs.writeFileSync(file, JSON.stringify(meta));
    }
    const r = run(dir);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
    for (const label of ['reference', 'test']) {
      assert.equal(report.shots[0].checks.find(c => c.name === `captureDefinition:${label}`).pass, true);
      assert.equal(report.shots[0].checks.find(c => c.name === `${name}:${label}`).pass, false);
    }
    assert.ok(report.shots[0].checks.filter(c => ['cameraPosition', 'cameraOrientationDeg', 'cameraFov'].includes(c.name)).every(c => c.pass), 'pairwise checks alone would have falsely passed');
  }
});

test('requested clip checks tolerate ordinary float32 capture metadata', () => {
  const dir = setup([90, 120, 150]);
  for (const side of ['ref', 'test']) {
    const file = path.join(dir, side, 'a.json');
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
    meta.camera.near = Math.fround(meta.camera.near);
    meta.camera.far = Math.fround(meta.camera.far);
    fs.writeFileSync(file, JSON.stringify(meta));
  }
  assert.equal(run(dir).status, 0);
});

test('image-only reports explicitly disclose omitted camera and provenance checks', () => {
  const dir = setup([90, 120, 150]);
  assert.equal(run(dir, ['--image-only']).status, 0);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'out', 'report.json'), 'utf8'));
  assert.equal(report.mode, 'image-only');
  assert.ok(report.shots[0].checks.every(c => c.category !== 'camera' && !c.name.startsWith('captureDefinition')));
  assert.match(fs.readFileSync(path.join(dir, 'out', 'report.md'), 'utf8'), /camera and capture provenance not checked/);
});

test('invalid threshold numbers cannot disable strict checks', () => {
  for (const value of ['5', null, -1]) {
    const dir = setup([90, 120, 150]);
    fs.writeFileSync(path.join(dir, 't.json'), JSON.stringify({ cameraFov: value }));
    const r = run(dir, ['--thresholds', path.join(dir, 't.json')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /finite non-negative/);
  }
});
