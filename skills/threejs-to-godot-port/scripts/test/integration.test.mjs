// Needs Chromium (npx playwright install chromium). Skipped when the browser cannot start.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir } from './helpers.mjs';
import { launchBrowser, startServer } from '../lib/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..');
let browserOk = true;
try { const b = await launchBrowser(); await b.close(); } catch { browserOk = false; }
const opts = { skip: browserOk ? false : 'Chromium is not available' };

const SCENE = `
export function createScene({ THREE, canvas, width, height }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#223344');
  scene.fog = new THREE.Fog('#223344', 5, 50);
  const shader = new THREE.ShaderMaterial({ vertexShader: 'void main(){gl_Position=vec4(position,1.0);}', fragmentShader: 'void main(){gl_FragColor=vec4(1.0);}' });
  shader.name = 'custom-shader';
  const toon = new THREE.MeshToonMaterial({ color: '#ff8800' });
  toon.name = 'toon';
  const hull = new THREE.MeshBasicMaterial({ color: '#000000', side: THREE.BackSide });
  hull.name = 'hull';
  hull.onBeforeCompile = shader => { shader.vertexShader = shader.vertexShader; };
  const lambert = new THREE.MeshLambertMaterial({ color: '#00ff00' }); lambert.name = 'lambert';
  const d = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), lambert); d.name = 'd'; d.position.y = 2;
  const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shader); a.name = 'a'; a.castShadow = true;
  const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), toon); b.name = 'b'; b.position.x = 2;
  const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), hull); c.name = 'c'; c.position.x = -2;
  scene.add(a, b, c, d);
  const sun = new THREE.DirectionalLight('#ffffff', 2); sun.name = 'sun'; sun.position.set(1, 2, 3);
  scene.add(sun, sun.target, new THREE.HemisphereLight('#88aaff', '#443322', 1));
  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
  camera.position.set(0, 1, 6); camera.lookAt(0, 0, 0);
  return { scene, camera, renderer };
}
`;

function run(script, args) {
  return spawnSync('node', [path.join(scripts, script), ...args], { encoding: 'utf8', timeout: 120000 });
}

test('export-scene lists the losses of a small scene, deterministically, without absolute paths', opts, () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'scene.mjs'), SCENE);
  const out1 = path.join(dir, 'o1'), out2 = path.join(dir, 'o2');
  const r1 = run('export-scene.mjs', ['--module', path.join(dir, 'scene.mjs'), '--out', out1, '--name', 'x']);
  assert.equal(r1.status, 0, r1.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out1, 'x.lost.json'), 'utf8'));
  const ids = new Set(report.findings.map(f => f.id));
  for (const id of ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L08', 'L09', 'L13']) assert.ok(ids.has(id), `expected ${id}, got ${[...ids].join(',')}`);
  assert.deepEqual(report.findings.find(f => f.id === 'L04').where, ['c'], 'only the patched material is flagged; a plain Lambert is not');
  const glb = fs.readFileSync(path.join(out1, 'x.glb'));
  assert.equal(glb.subarray(0, 4).toString(), 'glTF');
  const r2 = run('export-scene.mjs', ['--module', path.join(dir, 'scene.mjs'), '--out', out2, '--name', 'x']);
  assert.equal(r2.status, 0);
  for (const file of ['x.lost.json', 'x.lost.md']) {
    const a = fs.readFileSync(path.join(out1, file), 'utf8'), b = fs.readFileSync(path.join(out2, file), 'utf8');
    assert.equal(a, b, `${file} must be identical between runs`);
    assert.ok(!a.includes(dir) && !a.includes(os.homedir()), `${file} must not contain absolute paths`);
  }
  assert.equal(run('export-scene.mjs', ['--module', path.join(dir, 'scene.mjs'), '--out', out2, '--name', 'x', '--fail-on', 'lost']).status, 2);
});

test('dump-settings writes world-space settings', opts, () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'scene.mjs'), SCENE);
  const out = path.join(dir, 's.json');
  assert.equal(run('dump-settings.mjs', ['--module', path.join(dir, 'scene.mjs'), '--out', out]).status, 0);
  const s = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(s.schema, 1);
  assert.equal(s.fog.type, 'Fog');
  assert.equal(s.background.srgb, '#223344');
  assert.equal(s.camera.fov, 50);
  const sun = s.lights.find(l => l.name === 'sun');
  assert.ok(Math.abs(Math.hypot(...sun.direction) - 1) < 1e-9, 'direction is a unit vector');
  assert.ok(sun.direction[1] < 0, 'a light at +y aims downward');
  assert.ok(s.lights.some(l => l.type === 'HemisphereLight' && l.groundColor.srgb === '#443322'));
  assert.ok(s.materials.find(m => m.name === 'toon').type === 'MeshToonMaterial');
  const text = fs.readFileSync(out, 'utf8');
  assert.ok(!text.includes(dir) && !text.includes(os.homedir()));
});

test('capture-three writes a png and a json per shot', opts, () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'scene.mjs'), SCENE);
  const shots = { schema: 1, size: { width: 160, height: 90 }, shots: [{ id: 'one', camera: { position: [0, 1, 6], lookAt: [0, 0, 0], fov: 50, near: 0.1, far: 100 } }] };
  fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(shots));
  const r = run('capture-three.mjs', ['--module', path.join(dir, 'scene.mjs'), '--shots', path.join(dir, 'shots.json'), '--out', path.join(dir, 'cap')]);
  assert.equal(r.status, 0, r.stderr);
  const png = fs.readFileSync(path.join(dir, 'cap', 'one.png'));
  assert.equal(png.readUInt32BE(16), 160);
  assert.equal(png.readUInt32BE(20), 90);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'cap', 'one.json'), 'utf8'));
  assert.equal(meta.camera.fov, 50);
  assert.ok(Math.abs(meta.camera.position[2] - 6) < 1e-9);
});

test('page mode: a page that exposes window.__tgScene can be exported', opts, async () => {
  const vendor = await startServer();
  const page = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<!doctype html><canvas id="c"></canvas><script type="module">
      import * as THREE from '${vendor.origin}/vendor/three/build/three.module.js';
      const scene = new THREE.Scene();
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#ff0000' })); m.name = 'lambert-box';
      scene.add(m, new THREE.AmbientLight('#ffffff', 1));
      const camera = new THREE.PerspectiveCamera(40, 1.7, 0.1, 50); camera.position.set(0, 0, 5);
      const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c') });
      window.__tgScene = scene; window.__tgCamera = camera; window.__tgRenderer = renderer;
    </script>`);
  });
  await new Promise(resolve => page.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${page.address().port}/`;
  const dir = tmpDir();
  const r = await new Promise(resolve => {
    import('node:child_process').then(({ spawn }) => {
      const child = spawn('node', [path.join(scripts, 'export-scene.mjs'), '--page', url, '--out', dir, '--name', 'pg']);
      let stderr = '';
      child.stderr.on('data', d => { stderr += d; });
      child.on('close', status => resolve({ status, stderr }));
    });
  });
  page.close(); await vendor.close();
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'pg.lost.json'), 'utf8'));
  assert.equal(report.mode, 'page');
  assert.ok(report.findings.some(f => f.id === 'L02'), 'Lambert is reported');
});

test('a page without window.__tgScene gives a clear error (exit 1)', opts, async () => {
  const page = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><p>no scene</p>'); });
  await new Promise(resolve => page.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${page.address().port}/`;
  const { spawn } = await import('node:child_process');
  const r = await new Promise(resolve => {
    const child = spawn('node', [path.join(scripts, 'export-scene.mjs'), '--page', url, '--out', tmpDir()]);
    let stderr = '';
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', status => resolve({ status, stderr }));
  });
  page.close();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /window\.__tgScene/);
});

const WARN_SCENE = `
export function createScene({ THREE, canvas, width, height }) {
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(width, height, false);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2('#888888', 0.05);
  const gradientCanvas = document.createElement('canvas');
  gradientCanvas.width = 3; gradientCanvas.height = 1;
  const toon = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: new THREE.CanvasTexture(gradientCanvas) });
  toon.name = 'image-gradient-toon';
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), toon, 2);
  crowd.name = 'crowd';
  scene.add(crowd);
  const camera = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.1, 50);
  camera.position.set(0, 0, 10);
  return { scene, camera, renderer };
}
`;

test('dump-settings warns about what the Godot side cannot carry yet', opts, () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'scene.mjs'), WARN_SCENE);
  const out = path.join(dir, 's.json');
  const r = run('dump-settings.mjs', ['--module', path.join(dir, 'scene.mjs'), '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const s = JSON.parse(fs.readFileSync(out, 'utf8'));
  const all = (s.warnings || []).join('\n');
  assert.match(all, /OrthographicCamera/);
  assert.match(all, /FogExp2/);
  assert.match(all, /image-gradient-toon.*loaded from an image/);
  assert.match(all, /InstancedMesh \(crowd\)/);
  assert.match(r.stderr, /warning: OrthographicCamera/, 'the CLI prints the warnings');
  assert.ok(!s.materials.find(m => m.name === 'image-gradient-toon').gradientMap, 'no gradient values were recorded');
});

test('capture-three refuses an orthographic camera with a clear message', opts, () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'scene.mjs'), WARN_SCENE);
  const shots = { schema: 1, size: { width: 64, height: 36 }, shots: [{ id: 'one', camera: { position: [0, 0, 10], lookAt: [0, 0, 0], fov: 40, near: 0.1, far: 50 } }] };
  fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify(shots));
  const r = run('capture-three.mjs', ['--module', path.join(dir, 'scene.mjs'), '--shots', path.join(dir, 'shots.json'), '--out', path.join(dir, 'cap')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr + r.stdout, /only a PerspectiveCamera/);
});

test('module mode explains a bare import it cannot resolve', opts, () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'scene.mjs'), "import * as CANNON from 'cannon-es';\nexport function createScene() { return CANNON; }\n");
  const r = run('export-scene.mjs', ['--module', path.join(dir, 'scene.mjs'), '--out', path.join(dir, 'o')]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /resolves only "three" and "three\/addons\/\.\.\." imports/);
  assert.match(r.stderr, /"cannon-es" cannot be resolved/);
});
