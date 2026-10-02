// Shot sheet (shots.json) loading and validation. The same file drives the three.js capture and the Godot capture.
//
// {
//   "schema": 1,
//   "size": { "width": 640, "height": 360 },
//   "shots": [
//     {
//       "id": "front",
//       "purpose": "why this view exists",
//       "camera": { "position": [x, y, z], "lookAt": [x, y, z] | "quaternion": [x, y, z, w],
//                   "up": [0, 1, 0], "fov": 40, "near": 0.1, "far": 100 },
//       "at": { "step": 0 },   // steps to advance before this shot, from the current state; the scene is not reloaded between shots, so steps add up in sheet order
//       "probes": [ { "name": "lit-floor", "x": 320, "y": 300 } ],
//       "flags": { "flatBackground": true, "outline": false },
//       "thresholds": { "meanAbsDiff": 5 }
//     }
//   ]
// }
import fs from 'node:fs';

export class ShotsError extends Error {}

function isVec(v, n) {
  return Array.isArray(v) && v.length === n && v.every(x => typeof x === 'number' && Number.isFinite(x));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Portable capture provenance, written verbatim by both engines. Include the ordered
// timeline because at.step is cumulative, even when only some images are requested.
// Probes, flags, purpose and thresholds affect analysis, not the captured frame.
export function captureDefinition(sheet) {
  return {
    schema: 1,
    size: { width: sheet.size.width, height: sheet.size.height },
    shots: sheet.shots.map(shot => ({
      id: shot.id,
      camera: JSON.parse(JSON.stringify(shot.camera)),
      at: { step: shot.at?.step ?? 0 },
    })),
  };
}

export function validateShots(sheet) {
  const fail = message => { throw new ShotsError(`shots.json: ${message}`); };
  if (!isObject(sheet)) fail('must be an object');
  if (sheet.schema !== 1) fail('schema must be 1');
  const size = sheet.size;
  if (!size || !Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 8 || size.height < 8) {
    fail('size.width and size.height must be integers >= 8');
  }
  if (!Array.isArray(sheet.shots) || sheet.shots.length === 0) fail('shots must be a non-empty array');
  const ids = new Set();
  for (const shot of sheet.shots) {
    if (!isObject(shot)) fail('each shot must be an object');
    if (typeof shot.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(shot.id)) fail(`bad shot id: ${JSON.stringify(shot.id)}`);
    if (ids.has(shot.id)) fail(`duplicate shot id: ${shot.id}`);
    ids.add(shot.id);
    const cam = shot.camera;
    if (!isObject(cam) || !isVec(cam.position, 3)) fail(`${shot.id}: camera.position must be [x, y, z]`);
    if (cam.type !== undefined && cam.type !== 'perspective') fail(`${shot.id}: camera.type must be perspective`);
    const hasLook = cam.lookAt !== undefined;
    const hasQuat = cam.quaternion !== undefined;
    if (hasLook === hasQuat) fail(`${shot.id}: give exactly one of camera.lookAt and camera.quaternion`);
    if (hasLook && !isVec(cam.lookAt, 3)) fail(`${shot.id}: camera.lookAt must be [x, y, z]`);
    if (hasLook && isVec(cam.lookAt, 3) && (cam.up === undefined || isVec(cam.up, 3))) {
      const d = cam.lookAt.map((v, i) => v - cam.position[i]);
      const u = cam.up || [0, 1, 0];
      const dl = Math.hypot(...d), ul = Math.hypot(...u);
      if (dl === 0) fail(`${shot.id}: camera.lookAt must differ from camera.position`);
      if (dl > 0 && ul > 0 && Math.abs((d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / (dl * ul)) > 0.999999) {
        fail(`${shot.id}: the camera looks straight along its up vector, where lookAt has no single answer (three.js and Godot choose a different roll). Move the position a little to the side, or give camera.quaternion`);
      }
    }
    if (hasQuat && !isVec(cam.quaternion, 4)) fail(`${shot.id}: camera.quaternion must be [x, y, z, w]`);
    if (hasQuat && Math.hypot(...cam.quaternion) === 0) fail(`${shot.id}: camera.quaternion must be non-zero`);
    if (cam.up !== undefined && !isVec(cam.up, 3)) fail(`${shot.id}: camera.up must be [x, y, z]`);
    if (cam.up !== undefined && Math.hypot(...cam.up) === 0) fail(`${shot.id}: camera.up must be non-zero`);
    for (const key of ['fov', 'near', 'far']) {
      if (typeof cam[key] !== 'number' || !Number.isFinite(cam[key]) || !(cam[key] > 0)) fail(`${shot.id}: camera.${key} must be a finite positive number`);
    }
    if (cam.fov >= 180) fail(`${shot.id}: camera.fov must be less than 180 degrees`);
    if (cam.far <= cam.near) fail(`${shot.id}: camera.far must be greater than camera.near`);
    if (shot.at !== undefined && !(isObject(shot.at) && Number.isSafeInteger(shot.at.step) && shot.at.step >= 0)) fail(`${shot.id}: at.step must be a non-negative integer`);
    if (shot.probes !== undefined && !Array.isArray(shot.probes)) fail(`${shot.id}: probes must be an array`);
    for (const probe of shot.probes ?? []) {
      if (!isObject(probe) || typeof probe.name !== 'string' || !Number.isInteger(probe.x) || !Number.isInteger(probe.y)) fail(`${shot.id}: probes need name, x, y`);
      if (probe.x < 3 || probe.y < 3 || probe.x >= size.width - 3 || probe.y >= size.height - 3) fail(`${shot.id}: probe ${probe.name} is too close to the edge`);
    }
  }
  return sheet;
}

export function loadShots(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new ShotsError(`cannot read the shot sheet (${error.code ?? error.message})`);
  }
  let sheet;
  try {
    sheet = JSON.parse(text);
  } catch (error) {
    throw new ShotsError(`shots.json is not valid JSON: ${error.message}`);
  }
  return validateShots(sheet);
}
