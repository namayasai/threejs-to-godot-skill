// Example 01: a plane, a cube and a cylinder under one directional light and one ambient light.
// This file is the "before" side. The Godot side is built from its .glb and its settings.json.
export function createScene({ THREE, canvas, width, height }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#d6e4ee');

  const matte = color => new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), matte('#a89f91'));
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), matte('#c0392b'));
  cube.name = 'cube';
  cube.position.set(-1.6, 0.7, 0);
  cube.castShadow = true;
  cube.receiveShadow = true;
  scene.add(cube);

  const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.6, 48), matte('#2e86c1'));
  cylinder.name = 'cylinder';
  cylinder.position.set(1.8, 0.8, 0.5);
  cylinder.castShadow = true;
  cylinder.receiveShadow = true;
  scene.add(cylinder);

  const sun = new THREE.DirectionalLight('#fff1d6', 2.5);
  sun.name = 'sun';
  sun.position.set(-4, 7, 5);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const ambient = new THREE.AmbientLight('#cfd8ff', 0.8);
  ambient.name = 'ambient';
  scene.add(ambient);

  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
  camera.position.set(0, 2.2, 7);
  camera.lookAt(0, 0.6, 0);

  return { scene, camera, renderer };
}
