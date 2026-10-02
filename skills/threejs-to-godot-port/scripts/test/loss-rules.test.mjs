import test from 'node:test';
import assert from 'node:assert/strict';
import { findLosses, lostMarkdown } from '../lib/loss-rules.mjs';
import { emptyAudit, material } from './helpers.mjs';

const ids = result => result.findings.map(f => f.id);

test('a plain standard material scene has no findings', () => {
  const audit = emptyAudit();
  audit.materials.push(material({}));
  assert.deepEqual(findLosses(audit).findings, []);
});

test('L01 ShaderMaterial is lost', () => {
  const audit = emptyAudit();
  audit.materials.push(material({ type: 'ShaderMaterial', isShaderMaterial: true }));
  const r = findLosses(audit, ['GLTFExporter: THREE.ShaderMaterial not supported.']);
  assert.ok(ids(r).includes('L01'));
  assert.equal(r.findings.find(f => f.id === 'L01').severity, 'lost');
  assert.equal(r.findings.filter(f => f.id === 'W00').length, 0, 'the warning is explained, not repeated');
});

test('L02 L03 toon material: class change and silent gradientMap loss', () => {
  const audit = emptyAudit();
  audit.materials.push(material({ type: 'MeshToonMaterial', gradientMap: true }));
  const r = findLosses(audit, ['GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial for best results.']);
  assert.ok(ids(r).includes('L02') && ids(r).includes('L03'));
});

test('L02 lambert and phong are degraded', () => {
  const audit = emptyAudit();
  audit.materials.push(material({ type: 'MeshLambertMaterial' }), material({ type: 'MeshPhongMaterial', users: ['p'] }));
  assert.ok(ids(findLosses(audit)).includes('L02'));
});

test('L04 L05 patched BackSide outline shell', () => {
  const audit = emptyAudit();
  audit.materials.push(material({ type: 'MeshBasicMaterial', side: 'BackSide', onBeforeCompile: true }));
  const r = findLosses(audit);
  assert.ok(ids(r).includes('L04') && ids(r).includes('L05'));
});

test('L06 L13 ambient light and a loose directional target', () => {
  const audit = emptyAudit();
  audit.lights.push({ name: 'a', type: 'AmbientLight', castShadow: false, decay: null, targetIsChild: null, targetPosition: null });
  audit.lights.push({ name: 'sun', type: 'DirectionalLight', castShadow: false, decay: null, targetIsChild: false, targetPosition: [0, 0, 0] });
  const r = findLosses(audit, ['THREE.GLTFExporter: Only directional, point, and spot lights are supported. AmbientLight',
    'THREE.GLTFExporter: Light direction may be lost. For best results, make light.target a child of the light with position 0,0,-1.']);
  assert.ok(ids(r).includes('L06') && ids(r).includes('L13'));
  assert.equal(r.findings.find(f => f.id === 'L13').severity, 'lost');
  assert.equal(r.findings.filter(f => f.id === 'W00').length, 0);
});

test('L07 decay other than 2 is degraded', () => {
  const audit = emptyAudit();
  audit.lights.push({ name: 'p', type: 'PointLight', castShadow: false, decay: 1, targetIsChild: null, targetPosition: null });
  assert.equal(findLosses(audit).findings.find(f => f.id === 'L07').severity, 'degraded');
});

test('L08 shadow flags are lost and counted', () => {
  const audit = emptyAudit();
  audit.objects.castShadow = ['a', 'b'];
  audit.objects.receiveShadow = ['a'];
  const f = findLosses(audit).findings.find(x => x.id === 'L08');
  assert.match(f.what, /2 meshes cast, 1 receive/);
});

test('L09 fog, background, tone mapping', () => {
  const audit = emptyAudit();
  audit.scene = { fog: 'Fog', background: 'color', environment: true };
  audit.renderer = { toneMapping: 4, toneMappingExposure: 1, outputColorSpace: 'srgb', shadowMapEnabled: false };
  const f = findLosses(audit).findings.find(x => x.id === 'L09');
  assert.deepEqual(f.where.sort(), ['background (color)', 'fog (Fog)', 'output color space and exposure', 'scene.environment', 'tone mapping'].sort());
});

test('L10 vertex color mismatch is info', () => {
  const audit = emptyAudit();
  audit.materials.push(material({ colorAttributeOnSomeUser: true, vertexColors: false }));
  assert.equal(findLosses(audit).findings.find(f => f.id === 'L10').severity, 'info');
});

test('L11 special objects and L12 textures are info', () => {
  const audit = emptyAudit();
  audit.objects.instanced = 2;
  audit.materials.push(material({ textures: [{ slot: 'map', colorSpace: 'srgb', flipY: true }] }));
  const r = findLosses(audit);
  assert.equal(r.findings.find(f => f.id === 'L11').severity, 'info');
  assert.equal(r.findings.find(f => f.id === 'L12').severity, 'info');
});

test('an unexplained exporter warning is kept verbatim', () => {
  const r = findLosses(emptyAudit(), ['something new', 'something new']);
  assert.equal(r.findings[0].id, 'W00');
  assert.deepEqual(r.warnings, [{ message: 'something new', count: 2, rule: null }]);
});

test('output is deterministic and the markdown names every finding', () => {
  const audit = emptyAudit();
  audit.materials.push(material({ type: 'MeshToonMaterial', gradientMap: true }));
  const a = findLosses(audit), b = findLosses(audit);
  assert.deepEqual(a, b);
  const md = lostMarkdown({ name: 'x', revision: '185', exporterRevision: '185', ...a });
  for (const f of a.findings) assert.ok(md.includes(`## ${f.id}`));
});
