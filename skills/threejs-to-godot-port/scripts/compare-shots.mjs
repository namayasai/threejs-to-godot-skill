#!/usr/bin/env node
// (d) Compare paired screenshots (before: three.js, after: Godot) and count the differences.
//
// Usage:
//   node compare-shots.mjs --ref <dir> --test <dir> --shots <shots.json> --out <dir> [--thresholds <file.json>] [--diff] [--image-only]
//
// <dir> holds <id>.png and <id>.json for every shot id (capture-three.mjs and capture_godot.gd write that layout).
// Outputs in <out>: compare/<id>.png (ref on top, test below, magenta line between), diff/<id>.png (with --diff),
// report.json, report.md.
// Exit codes: 0 every shot passes, 3 at least one check fails, 1 the tool failed (missing file, bad input).
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { PNG } from 'pngjs';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { captureDefinition, loadShots, ShotsError, validateShots } from './lib/shots.mjs';
import * as M from './lib/png-metrics.mjs';

// Initial proposals, not derived statistically. Calibrate them on your own scene (see references/ and examples/).
export const DEFAULT_THRESHOLDS = {
  meanAbsDiff: 5,
  meanLDiff: 1.5,
  blockLMax: 8,
  blockLP95: 3,
  hueShareDiff: 0.01,
  probeLDiff: 2.0,
  shadeRatioDiff: 0.03,
  backgroundDiff: 1,
  darkPixelRatioMin: 0.75,
  darkPixelRatioMax: 1.25,
  cameraPosition: 1e-3,
  cameraOrientationDeg: 0.05,
  cameraFov: 0.01,
  cameraClipRelative: 1e-5,
};

const USAGE = `Usage:
  node compare-shots.mjs --ref <dir> --test <dir> --shots <shots.json> --out <dir> [--thresholds <file.json>] [--diff] [--image-only]
By default, both camera sidecars and capture definitions are required. --image-only
explicitly skips camera/provenance checks; expected image dimensions are still checked.
Exit codes: 0 all pass, 3 at least one check fails, 1 the tool failed.`;

class CompareError extends Error {}

function readPng(file) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    throw new CompareError(`missing image: ${path.basename(file)}`);
  }
  try {
    const png = PNG.sync.read(bytes);
    return { width: png.width, height: png.height, data: png.data };
  } catch (error) {
    throw new CompareError(`cannot decode ${path.basename(file)}: ${error.message}`);
  }
}

function readJson(file, label = path.basename(file)) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new CompareError(`cannot read ${label} (${error.code ?? 'read error'})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CompareError(`${label} is not valid JSON`);
  }
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isVec = (value, n) => Array.isArray(value) && value.length === n && value.every(v => typeof v === 'number' && Number.isFinite(v));

function validateThresholds(thresholds, label) {
  if (!isObject(thresholds)) throw new CompareError(`${label} must be an object`);
  for (const [key, value] of Object.entries(thresholds)) {
    if (!Object.hasOwn(DEFAULT_THRESHOLDS, key)) throw new CompareError(`unknown threshold: ${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new CompareError(`${label}.${key} must be a finite non-negative number`);
  }
  if (thresholds.darkPixelRatioMin > thresholds.darkPixelRatioMax) throw new CompareError(`${label}: darkPixelRatioMin must not exceed darkPixelRatioMax`);
}

function validateMeta(meta, shot, image, label) {
  const fail = message => { throw new CompareError(`${shot.id}: ${label} sidecar ${message}`); };
  if (!isObject(meta)) fail('must be an object (recapture, or explicitly use --image-only)');
  if (meta.id !== shot.id) fail(`id must be ${shot.id}`);
  if (!isObject(meta.size) || !Number.isSafeInteger(meta.size.width) || !Number.isSafeInteger(meta.size.height) || meta.size.width < 8 || meta.size.height < 8) fail('size must contain integer width and height >= 8');
  if (meta.size.width !== image.width || meta.size.height !== image.height) fail('size does not match its PNG');
  const cam = meta.camera;
  if (!isObject(cam)) fail('camera is required');
  if (cam.type !== 'perspective') fail('camera.type must be perspective');
  if (!isVec(cam.position, 3)) fail('camera.position must contain three finite numbers');
  if (!isVec(cam.quaternion, 4) || Math.abs(Math.hypot(...cam.quaternion) - 1) > 1e-3) fail('camera.quaternion must contain four finite numbers forming a unit quaternion');
  if (typeof cam.fov !== 'number' || !Number.isFinite(cam.fov) || cam.fov <= 0 || cam.fov >= 180) fail('camera.fov must be finite and between 0 and 180 degrees');
  if (typeof cam.near !== 'number' || !Number.isFinite(cam.near) || cam.near <= 0) fail('camera.near must be a finite positive number');
  if (typeof cam.far !== 'number' || !Number.isFinite(cam.far) || cam.far <= cam.near) fail('camera.far must be finite and greater than camera.near');
  if (!isObject(meta.captureDefinition)) fail('captureDefinition is required (recapture, or explicitly use --image-only)');
  try { validateShots(meta.captureDefinition); } catch (error) { fail(`captureDefinition is invalid: ${error.message}`); }
}

function requestedQuaternion(camera) {
  if (camera.quaternion) return new Quaternion(...camera.quaternion).normalize().toArray();
  const matrix = new Matrix4().lookAt(new Vector3(...camera.position), new Vector3(...camera.lookAt), new Vector3(...(camera.up ?? [0, 1, 0])));
  return new Quaternion().setFromRotationMatrix(matrix).normalize().toArray();
}

function writePng(file, width, height, data) {
  const png = new PNG({ width, height });
  png.data = Buffer.from(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(png));
}

function stacked(a, b) {
  const gap = 6;
  const width = Math.max(a.width, b.width);
  const height = a.height + gap + b.height;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4] = 255; data[i * 4 + 1] = 51; data[i * 4 + 2] = 153; data[i * 4 + 3] = 255; }
  const blit = (img, y0) => {
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const s = (y * img.width + x) * 4, d = ((y0 + y) * width + x) * 4;
        data[d] = img.data[s]; data[d + 1] = img.data[s + 1]; data[d + 2] = img.data[s + 2]; data[d + 3] = 255;
      }
    }
  };
  blit(a, 0);
  blit(b, a.height + gap);
  return { width, height, data };
}

export function compareShot({ sheet, shot, ref, test, refMeta, testMeta, thresholds = DEFAULT_THRESHOLDS, imageOnly = false }) {
  if (!sheet) throw new CompareError('the current shot sheet is required to check dimensions and capture provenance');
  validateThresholds(thresholds, 'thresholds');
  if (shot.thresholds !== undefined) validateThresholds(shot.thresholds, `${shot.id}.thresholds`);
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds, ...(shot.thresholds || {}) };
  validateThresholds(t, `${shot.id}.thresholds`);
  const checks = [];
  const metrics = {};
  // factor: how far past its limit a check is (1 = exactly at the limit). Used to judge negative controls.
  const check = (name, value, limit, pass, extra = {}) => {
    let factor = null;
    if (typeof limit === 'number' && limit >= 0 && typeof value === 'number') factor = limit === 0 ? (value === 0 ? 0 : Number.MAX_VALUE) : value / limit;
    if (typeof limit === 'string' && limit.includes('..')) {
      const [lo, hi] = limit.split('..').map(Number);
      factor = value < lo ? lo / Math.max(value, 1e-9) : value > hi ? value / hi : value / hi;
    }
    checks.push({ name, value, limit, pass, factor, category: 'visual', ...extra });
  };
  const sameSize = ref.width === test.width && ref.height === test.height;
  check('imageSize', sameSize ? 1 : 0, 1, sameSize, { category: 'capture', factor: null, detail: `${ref.width}x${ref.height} vs ${test.width}x${test.height}` });
  const expectedSize = [ref, test].every(img => img.width === sheet.size.width && img.height === sheet.size.height);
  check('expectedImageSize', expectedSize ? 1 : 0, 1, expectedSize, { category: 'capture', factor: null, detail: `expected ${sheet.size.width}x${sheet.size.height}` });

  if (!imageOnly) {
    validateMeta(refMeta, shot, ref, 'reference');
    validateMeta(testMeta, shot, test, 'test');
    const expectedDefinition = captureDefinition(sheet);
    for (const [label, meta] of [['reference', refMeta], ['test', testMeta]]) {
      const current = isDeepStrictEqual(meta.captureDefinition, expectedDefinition);
      check(`captureDefinition:${label}`, current ? 1 : 0, 1, current, { category: 'capture', factor: null, detail: current ? 'matches current shot sheet' : 'stale capture: recapture using the current shot sheet' });
      const position = Math.hypot(...shot.camera.position.map((v, i) => v - meta.camera.position[i]));
      const orientation = M.orientationDiffDegrees(requestedQuaternion(shot.camera), meta.camera.quaternion);
      check(`requestedCameraPosition:${label}`, position, t.cameraPosition, position <= t.cameraPosition, { category: 'camera' });
      check(`requestedCameraOrientationDeg:${label}`, orientation, t.cameraOrientationDeg, orientation <= t.cameraOrientationDeg, { category: 'camera' });
      const fov = Math.abs(shot.camera.fov - meta.camera.fov);
      check(`requestedCameraFov:${label}`, fov, t.cameraFov, fov <= t.cameraFov, { category: 'camera' });
      for (const clip of ['near', 'far']) {
        const delta = Math.abs(shot.camera[clip] - meta.camera[clip]);
        const limit = Math.max(1, Math.abs(shot.camera[clip])) * t.cameraClipRelative;
        check(`requestedCamera${clip === 'near' ? 'Near' : 'Far'}:${label}`, delta, limit, delta <= limit, { category: 'camera' });
      }
    }
    const dp = Math.hypot(...refMeta.camera.position.map((v, i) => v - testMeta.camera.position[i]));
    const dq = M.orientationDiffDegrees(refMeta.camera.quaternion, testMeta.camera.quaternion);
    metrics.cameraPosition = dp; metrics.cameraOrientationDeg = dq;
    check('cameraPosition', dp, t.cameraPosition, dp <= t.cameraPosition, { category: 'camera' });
    check('cameraOrientationDeg', dq, t.cameraOrientationDeg, dq <= t.cameraOrientationDeg, { category: 'camera' });
    const df = Math.abs(refMeta.camera.fov - testMeta.camera.fov);
    metrics.cameraFov = df;
    check('cameraFov', df, t.cameraFov, df <= t.cameraFov, { category: 'camera' });
  }
  if (!sameSize || !expectedSize) return { id: shot.id, pass: false, metrics, checks };

  const lr = M.labPlanes(ref), lt = M.labPlanes(test);
  metrics.meanAbsDiff = M.meanAbsDiff(ref, test);
  check('meanAbsDiff', metrics.meanAbsDiff, t.meanAbsDiff, metrics.meanAbsDiff <= t.meanAbsDiff);

  metrics.meanLRef = M.mean(lr.L); metrics.meanLTest = M.mean(lt.L);
  metrics.meanLDiff = Math.abs(metrics.meanLRef - metrics.meanLTest);
  check('meanLDiff', metrics.meanLDiff, t.meanLDiff, metrics.meanLDiff <= t.meanLDiff);

  const br = M.blockMeans(lr), bt = M.blockMeans(lt);
  const blockDiffs = br.map((v, i) => Math.abs(v - bt[i]));
  metrics.blockLMax = Math.max(...blockDiffs);
  metrics.blockLP95 = M.percentile(blockDiffs, 0.95);
  check('blockLMax', metrics.blockLMax, t.blockLMax, metrics.blockLMax <= t.blockLMax);
  check('blockLP95', metrics.blockLP95, t.blockLP95, metrics.blockLP95 <= t.blockLP95);

  const hr = M.hueShares(lr), ht = M.hueShares(lt);
  const hueDiff = Math.max(...hr.map((v, i) => Math.abs(v - ht[i])));
  metrics.hueShareDiff = hueDiff;
  check('hueShareDiff', hueDiff, t.hueShareDiff, hueDiff <= t.hueShareDiff);

  const probeResults = {};
  for (const probe of shot.probes || []) {
    const a = M.patchMean(lr, lr.L, probe.x, probe.y), b = M.patchMean(lt, lt.L, probe.x, probe.y);
    probeResults[probe.name] = { ref: a, test: b, diff: Math.abs(a - b) };
    check(`probeLDiff:${probe.name}`, Math.abs(a - b), t.probeLDiff, Math.abs(a - b) <= t.probeLDiff);
  }
  if (Object.keys(probeResults).length) metrics.probes = probeResults;
  const ratio = shot.flags && shot.flags.shadeRatio;
  if (ratio) {
    const find = name => (shot.probes || []).find(p => p.name === name);
    const shade = find(ratio.shade), lit = find(ratio.lit);
    if (shade && lit) {
      const r = M.patchMean(lr, lr.Y, shade.x, shade.y) / M.patchMean(lr, lr.Y, lit.x, lit.y);
      const s = M.patchMean(lt, lt.Y, shade.x, shade.y) / M.patchMean(lt, lt.Y, lit.x, lit.y);
      metrics.shadeRatio = { ref: r, test: s, diff: Math.abs(r - s) };
      check('shadeRatioDiff', Math.abs(r - s), t.shadeRatioDiff, Math.abs(r - s) <= t.shadeRatioDiff);
    }
  }
  if (shot.flags && shot.flags.flatBackground) {
    const d = M.cornerBackgroundDiff(ref, test);
    metrics.backgroundDiff = d;
    check('backgroundDiff', d, t.backgroundDiff, d <= t.backgroundDiff);
  }
  if (shot.flags && shot.flags.outline) {
    const a = M.darkPixelCount(lr), b = M.darkPixelCount(lt);
    if (a >= 50) {
      const q = b / a;
      metrics.darkPixelRatio = q;
      check('darkPixelRatio', q, `${t.darkPixelRatioMin}..${t.darkPixelRatioMax}`, q >= t.darkPixelRatioMin && q <= t.darkPixelRatioMax);
    } else {
      metrics.darkPixelRatio = null;
    }
  }
  return { id: shot.id, pass: checks.every(c => c.pass), metrics, checks };
}

function fmt(v) {
  return typeof v === 'number' ? (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.001) ? v.toExponential(2) : String(Math.round(v * 10000) / 10000)) : String(v);
}

export function reportMarkdown(report) {
  const lines = ['# Shot comparison', '', `Mode: ${report.mode ?? 'strict'}${report.mode === 'image-only' ? ' (camera and capture provenance not checked)' : ''}`, '', `Shots: ${report.shots.length}, passed: ${report.summary.passed}, failed: ${report.summary.failed}`, ''];
  for (const shot of report.shots) {
    lines.push(`## ${shot.id}: ${shot.pass ? 'PASS' : 'FAIL'}`, '', '| check | value | limit | result |', '| --- | --- | --- | --- |');
    for (const c of shot.checks) lines.push(`| ${c.name} | ${fmt(c.value)} | ${fmt(c.limit)} | ${c.pass ? 'ok' : 'FAIL'} |`);
    lines.push('');
  }
  return lines.join('\n');
}

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--diff') { out.diff = true; continue; }
    if (arg === '--image-only') { out.imageOnly = true; continue; }
    if (arg === '--help') { out.help = true; continue; }
    if (!['--ref', '--test', '--shots', '--out', '--thresholds'].includes(arg)) throw new CompareError(`unknown option: ${arg}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new CompareError(`option ${arg} needs a value`);
    out[arg.slice(2)] = value;
  }
  return out;
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return 0; }
  for (const key of ['ref', 'test', 'shots', 'out']) if (!args[key]) throw new CompareError(`missing required option --${key}`);
  const sheet = loadShots(args.shots);
  let thresholds = { ...DEFAULT_THRESHOLDS };
  if (args.thresholds) {
    const extra = readJson(args.thresholds);
    validateThresholds(extra, 'thresholds');
    thresholds = { ...thresholds, ...extra };
  }
  const outDir = path.resolve(args.out);
  const shots = [];
  for (const shot of sheet.shots) {
    const ref = readPng(path.join(args.ref, `${shot.id}.png`));
    const test = readPng(path.join(args.test, `${shot.id}.png`));
    const refMeta = args.imageOnly ? null : readJson(path.join(args.ref, `${shot.id}.json`), `${shot.id}: reference sidecar`);
    const testMeta = args.imageOnly ? null : readJson(path.join(args.test, `${shot.id}.json`), `${shot.id}: test sidecar`);
    const result = compareShot({ sheet, shot, ref, test, refMeta, testMeta, thresholds, imageOnly: !!args.imageOnly });
    shots.push(result);
    const pair = stacked(ref, test);
    writePng(path.join(outDir, 'compare', `${shot.id}.png`), pair.width, pair.height, pair.data);
    if (args.diff && ref.width === test.width && ref.height === test.height) {
      const d = Buffer.alloc(ref.width * ref.height * 4);
      for (let i = 0; i < ref.width * ref.height; i++) {
        for (let c = 0; c < 3; c++) d[i * 4 + c] = Math.min(255, Math.abs(ref.data[i * 4 + c] - test.data[i * 4 + c]) * 4);
        d[i * 4 + 3] = 255;
      }
      writePng(path.join(outDir, 'diff', `${shot.id}.png`), ref.width, ref.height, d);
    }
  }
  const failed = shots.filter(s => !s.pass).length;
  const maxFailFactor = category => {
    const factors = shots.flatMap(s => s.checks.filter(c => !c.pass && c.factor !== null && (!category || c.category === category)).map(c => c.factor));
    return factors.length ? Math.max(...factors) : null;
  };
  const report = { schema: 1, mode: args.imageOnly ? 'image-only' : 'strict', thresholds, shots, summary: { passed: shots.length - failed, failed, maxFailFactor: maxFailFactor(), maxVisualFailFactor: maxFailFactor('visual'), maxCameraFailFactor: maxFailFactor('camera') } };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'report.md'), reportMarkdown(report) + '\n');
  console.log(`compared ${shots.length} shots: ${shots.length - failed} pass, ${failed} fail`);
  for (const s of shots) {
    const bad = s.checks.filter(c => !c.pass).map(c => `${c.name}=${fmt(c.value)} (limit ${fmt(c.limit)})`);
    console.log(`  ${s.id}: ${s.pass ? 'PASS' : 'FAIL ' + bad.join(', ')}`);
  }
  return failed > 0 ? 3 : 0;
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error instanceof CompareError || error instanceof ShotsError ? `error: ${error.message}` : error);
    process.exitCode = 1;
  });
}
