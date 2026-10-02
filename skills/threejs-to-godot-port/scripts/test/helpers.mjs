import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

export function tmpDir(prefix = 'tg-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Solid-color RGBA image, optionally with a filled rectangle.
export function solid(width, height, rgb, rect = null, rectRgb = null) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const c = inside ? rectRgb : rgb;
      const i = (y * width + x) * 4;
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

export function writePng(file, img) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(png));
}

export function emptyAudit() {
  return {
    revision: '185', objects: { total: 1, meshes: 0, instanced: 0, points: 0, lines: 0, sprites: 0, skinned: 0, castShadow: [], receiveShadow: [] },
    materials: [], meshes: [], lights: [], scene: { fog: null, background: null, environment: false }, renderer: null,
  };
}

export function material(overrides) {
  return { name: '', type: 'MeshStandardMaterial', count: 1, users: ['m'], side: 'FrontSide', transparent: false, opacity: 1, alphaTest: 0, vertexColors: false,
    colorAttributeOnSomeUser: false, gradientMap: false, onBeforeCompile: false, isShaderMaterial: false, textures: [], ...overrides };
}
