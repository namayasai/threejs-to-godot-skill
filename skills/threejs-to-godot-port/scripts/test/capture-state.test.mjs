import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { frame } from '../capture-three.mjs';
import { collectSettings } from '../lib/page-fns.mjs';

function renderer() {
  return { toneMapping: THREE.NoToneMapping, toneMappingExposure: 1, outputColorSpace: THREE.SRGBColorSpace,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap }, getContextAttributes: () => ({ antialias: true }),
    setSize(w, h) { this.size = [w, h]; }, setPixelRatio(r) { this.pixelRatio = r; }, render() { this.renders = (this.renders || 0) + 1; } };
}
function setup(scene, camera, render = renderer()) {
  globalThis.window = { __tg: { THREE, scene, camera, renderer: render }, __tgPageRevision: THREE.REVISION };
  return render;
}

test('settings exclude hidden lights and lights below hidden ancestors', () => {
  const scene = new THREE.Scene();
  const visible = new THREE.DirectionalLight(); visible.name = 'visible';
  const hidden = new THREE.DirectionalLight(0xffffff, 100); hidden.name = 'hidden'; hidden.visible = false;
  const group = new THREE.Group(); group.visible = false;
  const child = new THREE.AmbientLight(0xffffff, 100); child.name = 'hidden-child'; group.add(child);
  scene.add(visible, hidden, group);
  setup(scene, new THREE.PerspectiveCamera());
  const result = collectSettings();
  assert.deepEqual(result.lights.map(l => l.name), ['visible']);
  assert.equal(result.renderer.shadowMap.enabled, false);
  delete globalThis.window;
});

test('settings record effective FOV as well as raw source FOV and zoom', () => {
  const camera = new THREE.PerspectiveCamera(60); camera.zoom = 2;
  setup(new THREE.Scene(), camera);
  const result = collectSettings();
  assert.equal(result.camera.fov, 60);
  assert.equal(result.camera.zoom, 2);
  assert.ok(Math.abs(result.camera.effectiveFOV - 32.20422750397203) < 1e-10);
  delete globalThis.window;
});

test('fixed shots reset source zoom/crop, size the canvas and use world-space camera poses', async () => {
  const scene = new THREE.Scene();
  const parent = new THREE.Group(); parent.position.set(10, 2, 3); parent.rotation.y = 0.6; scene.add(parent);
  const camera = new THREE.PerspectiveCamera(60); camera.zoom = 2; camera.filmOffset = 5;
  camera.setViewOffset(1280, 720, 640, 0, 640, 720); parent.add(camera);
  const render = setup(scene, camera);
  const shot = { camera: { position: [0, 1, 5], quaternion: [0, 0, 0, 1], fov: 40, near: 0.2, far: 60 } };
  const meta = await frame({ shot, width: 160, height: 90 });
  assert.ok(Math.hypot(...meta.position.map((x, i) => x - shot.camera.position[i])) < 1e-10);
  assert.ok(Math.hypot(...meta.quaternion.slice(0, 3)) < 1e-10);
  assert.equal(meta.fov, 40);
  assert.equal(camera.getEffectiveFOV(), 40);
  assert.equal(camera.zoom, 1);
  assert.equal(camera.filmOffset, 0);
  assert.equal(camera.view.enabled, false);
  assert.deepEqual(render.size, [160, 90]);
  assert.equal(render.pixelRatio, 1);
  assert.equal(render.renders, 1);
  delete globalThis.window;
});
