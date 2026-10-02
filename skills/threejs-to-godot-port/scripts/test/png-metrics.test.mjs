import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../lib/png-metrics.mjs';
import { solid } from './helpers.mjs';

test('pixelLab: white, black and mid gray', () => {
  assert.ok(Math.abs(M.pixelLab(255, 255, 255).L - 100) < 0.01);
  assert.ok(Math.abs(M.pixelLab(0, 0, 0).L) < 0.01);
  assert.ok(Math.abs(M.pixelLab(119, 119, 119).L - 50) < 0.5, 'sRGB 119 is about L* 50');
});

test('meanAbsDiff of two solid images is the channel difference', () => {
  assert.equal(M.meanAbsDiff(solid(8, 8, [10, 20, 30]), solid(8, 8, [13, 20, 30])), 1);
});

test('blockMeans and percentile', () => {
  const img = solid(32, 18, [0, 0, 0], { x: 0, y: 0, w: 2, h: 2 }, [255, 255, 255]);
  const blocks = M.blockMeans(M.labPlanes(img));
  assert.equal(blocks.length, 144);
  assert.ok(blocks[0] > 99 && blocks[1] < 1);
  assert.equal(M.percentile([1, 2, 3, 4], 0.5), 2);
});

test('hueShares counts a saturated red into one bin', () => {
  const shares = M.hueShares(M.labPlanes(solid(8, 8, [220, 30, 30])));
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(shares.filter(v => v > 0).length, 1);
});

test('hueShares ignores gray', () => {
  assert.equal(M.hueShares(M.labPlanes(solid(8, 8, [120, 120, 120]))).reduce((a, b) => a + b, 0), 0);
});

test('darkPixelCount', () => {
  const img = solid(10, 10, [200, 200, 200], { x: 0, y: 0, w: 5, h: 2 }, [10, 10, 10]);
  assert.equal(M.darkPixelCount(M.labPlanes(img)), 10);
});

test('cornerBackgroundDiff looks at the top corners only', () => {
  const a = solid(40, 40, [100, 100, 100]);
  const b = solid(40, 40, [100, 100, 100], { x: 0, y: 30, w: 40, h: 10 }, [200, 0, 0]);
  assert.equal(M.cornerBackgroundDiff(a, b), 0);
  const c = solid(40, 40, [103, 100, 100]);
  assert.equal(M.cornerBackgroundDiff(a, c), 3);
});

test('orientationDiffDegrees ignores the quaternion sign', () => {
  assert.ok(M.orientationDiffDegrees([0, 0, 0, 1], [0, 0, 0, -1]) < 1e-6);
  const s = Math.sin(Math.PI / 180 * 5), c = Math.cos(Math.PI / 180 * 5);
  assert.ok(Math.abs(M.orientationDiffDegrees([0, 0, 0, 1], [0, s, 0, c]) - 10) < 1e-6);
});
