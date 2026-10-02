// Example 02: toon shading (a 3-step gradient map), inverted-hull outlines, and one mesh with vertex colors.
// Nothing here survives a glTF export: the gradient map, the outline hull (BackSide) and the onBeforeCompile patch
// are all dropped. The Godot side rebuilds them from settings.json (see godot/port_hook.gd).
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export function createScene({ THREE, canvas, width, height }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e3dcc8');

  const gradient = new THREE.DataTexture(new Uint8Array([102, 178, 255]), 3, 1, THREE.RedFormat, THREE.UnsignedByteType);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;

  const toon = (name, color, extra = {}) => {
    const material = new THREE.MeshToonMaterial({ color, gradientMap: gradient, ...extra });
    material.name = name;
    return material;
  };

  // The outline pushes each vertex outward by a fixed number of screen pixels along its view-space normal.
  const THICKNESS_AT_720 = 4;
  const outlinePx = THICKNESS_AT_720 * (height / 720);
  const outlineUniforms = { uPx: { value: [2 * outlinePx / width, 2 * outlinePx / height] } };
  const outlineMaterial = new THREE.MeshBasicMaterial({ color: '#1b1f24', side: THREE.BackSide });
  outlineMaterial.name = 'outline';
  outlineMaterial.onBeforeCompile = shader => {
    shader.uniforms.uPx = outlineUniforms.uPx;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform vec2 uPx;\nvoid main() {')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec2 outlineDir = normalize(normalMatrix * normal).xy;
        float outlineLen = length(outlineDir);
        if (outlineLen > 0.0001) gl_Position.xy += (outlineDir / outlineLen) * uPx * gl_Position.w;`);
  };
  outlineMaterial.customProgramCacheKey = () => 'example-outline-v1';

  // Hull geometry with averaged normals, so the shell does not tear at hard edges.
  const hullGeometry = geometry => {
    const g = geometry.clone();
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    if (g.attributes.color) g.deleteAttribute('color');
    const merged = mergeVertices(g, 1e-4);
    merged.computeVertexNormals();
    return merged;
  };

  const add = (name, geometry, material, position, outlined = true) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (outlined) {
      const hull = new THREE.Mesh(hullGeometry(geometry), outlineMaterial);
      hull.name = `${name}-outline`;
      mesh.add(hull);
    }
    return mesh;
  };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), toon('toon-ground', '#8fae7a'));
  ground.name = 'ground';
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  add('sphere', new THREE.SphereGeometry(0.9, 48, 32), toon('toon-sphere', '#e0674f'), [-2.0, 0.9, 0]);
  add('cylinder', new THREE.CylinderGeometry(0.6, 0.6, 1.8, 40), toon('toon-cylinder', '#4f8fe0'), [0.2, 0.9, 0.4]);

  // A box whose faces have their own vertex colors (linear values, as three.js stores them).
  const box = new THREE.BoxGeometry(1.3, 1.3, 1.3);
  const colors = [];
  const palette = ['#f2c94c', '#9b59b6', '#27ae60', '#e67e22', '#16a085', '#c0392b'].map(hex => new THREE.Color(hex));
  for (let face = 0; face < 6; face++) for (let v = 0; v < 4; v++) colors.push(palette[face].r, palette[face].g, palette[face].b);
  box.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  add('vertex-color-box', box, toon('toon-vertex-colors', '#ffffff', { vertexColors: true }), [2.5, 0.65, -0.3]);

  const sun = new THREE.DirectionalLight('#fff4e0', 3);
  sun.name = 'sun';
  sun.position.set(-4, 7, 5);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 30 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const hemisphere = new THREE.HemisphereLight('#bcd4f0', '#7a6a4f', 1.5);
  hemisphere.name = 'sky';
  scene.add(hemisphere);

  const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
  camera.position.set(0, 2.5, 8);
  camera.lookAt(0, 0.7, 0);
  return { scene, camera, renderer };
}
