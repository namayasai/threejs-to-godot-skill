import test from 'node:test';
import assert from 'node:assert/strict';
import { validateShots, ShotsError } from '../lib/shots.mjs';

const good = () => ({ schema: 1, size: { width: 64, height: 36 }, shots: [{ id: 'a', camera: { position: [0, 0, 5], lookAt: [0, 0, 0], fov: 40, near: 0.1, far: 50 } }] });

test('a valid sheet is accepted', () => assert.ok(validateShots(good())));

test('rejects bad input with a readable message', () => {
  const cases = [
    [s => { s.schema = 2; }, /schema/],
    [s => { s.size.width = 4; }, /size/],
    [s => { s.shots = []; }, /non-empty/],
    [s => { s.shots[0].id = 'bad id'; }, /bad shot id/],
    [s => { s.shots.push(s.shots[0]); }, /duplicate/],
    [s => { delete s.shots[0].camera.lookAt; }, /exactly one/],
    [s => { s.shots[0].camera.quaternion = [0, 0, 0, 1]; }, /exactly one/],
    [s => { s.shots[0].camera.fov = -1; }, /fov/],
    [s => { s.shots[0].at = { step: 1.5 }; }, /at.step/],
    [s => { s.shots[0].probes = [{ name: 'p', x: 1, y: 1 }]; }, /edge/],
  ];
  for (const [mutate, pattern] of cases) {
    const sheet = good();
    mutate(sheet);
    assert.throws(() => validateShots(sheet), error => error instanceof ShotsError && pattern.test(error.message));
  }
});

test('a camera that looks straight along its up vector is rejected, a near miss is accepted', () => {
  const sheet = good();
  sheet.shots[0].camera = { position: [0, 10, 0], lookAt: [0, 0, 0], fov: 40, near: 0.1, far: 50 };
  assert.throws(() => validateShots(sheet), error => error instanceof ShotsError && /straight along its up vector/.test(error.message));
  sheet.shots[0].camera.position = [0, 10, 0.5];
  assert.ok(validateShots(sheet));
  sheet.shots[0].camera = { position: [0, 10, 0], lookAt: [0, 0, 0], up: [0, 0, 1], fov: 40, near: 0.1, far: 50 };
  assert.ok(validateShots(sheet), 'a different up vector is fine');
  sheet.shots[0].camera = { position: [0, 10, 0], quaternion: [-0.7071068, 0, 0, 0.7071068], fov: 40, near: 0.1, far: 50 };
  assert.ok(validateShots(sheet), 'a quaternion can look straight down');
});
