// The "lost in translation" rules. Input: the scene audit (lib/page-fns.mjs) plus the exporter's own warnings.
// Output: a list of findings. Severity:
//   lost     the information does not reach the glTF file at all
//   degraded it reaches the file in a changed form
//   rebuild  it has to be rebuilt on the Godot side by hand
//   info     worth knowing; check the result after import
//
// Rule ids are stable. SKILL.md and references/materials.md refer to them.

export const SEVERITIES = ['lost', 'degraded', 'rebuild', 'info'];

const WARNING_PATTERNS = [
  { id: 'L01', test: /ShaderMaterial not supported/i },
  { id: 'L02', test: /Use MeshStandardMaterial or MeshBasicMaterial/i },
  { id: 'L06', test: /Only directional, point, and spot lights are supported/i },
  { id: 'L07', test: /Light decay may be lost/i },
  { id: 'L13', test: /Light direction may be lost/i },
  { id: 'L12', test: /Image size is bigger than maxTextureSize|UV channels for metalnessMap|Only RGBAFormat is supported/i },
];

function users(entry) {
  return entry.users.slice(0, 5);
}

function names(list) {
  return [...new Set(list)].sort();
}

export function findLosses(audit, warnings = []) {
  const findings = [];
  const add = (id, severity, what, where, action) => findings.push({ id, severity, what, where: names(where), action });

  const shaderMaterials = audit.materials.filter(m => m.isShaderMaterial);
  if (shaderMaterials.length) {
    add('L01', 'lost', 'ShaderMaterial: the exporter skips the material, so the mesh arrives without it.',
      shaderMaterials.flatMap(users), 'Rewrite the shader in the Godot shading language.');
  }
  const classDegraded = audit.materials.filter(m => !m.isShaderMaterial && m.type !== 'MeshStandardMaterial' && m.type !== 'MeshBasicMaterial' && m.type !== 'MeshPhysicalMaterial'
    && m.type !== 'MeshToonMaterial');
  if (classDegraded.length) {
    add('L02', 'degraded', `Material classes other than Standard, Basic, Physical and Toon are exported as a standard-like material (${names(classDegraded.map(m => m.type)).join(', ')}). The shading model is lost.`,
      classDegraded.flatMap(users), 'Pick a StandardMaterial3D setting or write a shader (see materials.md).');
  }
  const toon = audit.materials.filter(m => m.type === 'MeshToonMaterial');
  if (toon.length) {
    add('L02', 'degraded', 'MeshToonMaterial is exported as a standard material (the exporter warns).', toon.flatMap(users), 'Rebuild with toon.gdshader.');
    const withGradient = toon.filter(m => m.gradientMap);
    add('L03', 'lost', 'MeshToonMaterial.gradientMap is dropped without a warning.', (withGradient.length ? withGradient : toon).flatMap(users),
      'Rebuild with toon.gdshader and a nearest-filtered gradient texture.');
  }
  const patched = audit.materials.filter(m => m.onBeforeCompile);
  if (patched.length) {
    add('L04', 'lost', 'onBeforeCompile patches are dropped without a warning.', patched.flatMap(users), 'Reproduce the patched shader code in a Godot shader.');
  }
  const backSide = audit.materials.filter(m => m.side === 'BackSide');
  if (backSide.length) {
    add('L05', 'lost', 'side: BackSide is not written (only DoubleSide is), so the mesh arrives front-face only. A back-face outline shell becomes a body-sized duplicate mesh.',
      backSide.flatMap(users), 'Rebuild outline shells with outline.gdshader (cull_front) and delete the imported duplicates.');
  }
  const badLights = audit.lights.filter(l => !['DirectionalLight', 'PointLight', 'SpotLight'].includes(l.type));
  if (badLights.length) {
    add('L06', 'lost', `Light types glTF cannot carry (${names(badLights.map(l => l.type)).join(', ')}). The exporter warns.`,
      badLights.map(l => l.name || l.type), 'Rebuild with apply_settings.gd (ambient or hemisphere approximation).');
  }
  const oddDecay = audit.lights.filter(l => l.decay !== null && l.decay !== 2);
  if (oddDecay.length) {
    add('L07', 'degraded', 'Light decay other than 2. The exporter warns. glTF lights fall off with the inverse square.', oddDecay.map(l => l.name || l.type),
      'Check the attenuation after import.');
  }
  const looseTarget = audit.lights.filter(l => l.targetIsChild === false);
  if (looseTarget.length) {
    add('L13', 'lost', 'The light target is not a child of the light, so the exporter cannot write the direction. The light node keeps its position and loses its aim (measured on import: Godot gets an unrotated light). The exporter warns.',
      looseTarget.map(l => l.name || l.type), 'Take the direction from settings.json (dump-settings.mjs) and rebuild with apply_settings.gd.');
  }
  if (audit.objects.castShadow.length || audit.objects.receiveShadow.length || audit.lights.some(l => l.castShadow)) {
    add('L08', 'lost', `castShadow and receiveShadow are not written (${audit.objects.castShadow.length} meshes cast, ${audit.objects.receiveShadow.length} receive; ${audit.lights.filter(l => l.castShadow).length} lights cast).`,
      [...audit.objects.castShadow, ...audit.lights.filter(l => l.castShadow).map(l => l.name || l.type)].slice(0, 20),
      'Set shadow_enabled on lights and cast_shadow on meshes in Godot. Godot has no per-mesh receive flag.');
  }
  const sceneLost = [];
  if (audit.scene.fog) sceneLost.push(`fog (${audit.scene.fog})`);
  if (audit.scene.background) sceneLost.push(`background (${audit.scene.background})`);
  if (audit.scene.environment) sceneLost.push('scene.environment');
  if (audit.renderer) {
    if (audit.renderer.toneMapping !== 0) sceneLost.push('tone mapping');
    sceneLost.push('output color space and exposure');
  }
  if (sceneLost.length) {
    add('L09', 'lost', 'Scene and renderer state glTF has no place for.', sceneLost, 'Dump it with dump-settings.mjs and rebuild with apply_settings.gd.');
  }
  const colorMismatch = audit.materials.filter(m => (m.colorAttributeOnSomeUser && !m.vertexColors) || (m.vertexColors && !m.colorAttributeOnSomeUser));
  if (colorMismatch.length) {
    add('L10', 'info', 'Vertex color attribute and material.vertexColors disagree. The exporter writes COLOR_0 whenever the attribute exists.', colorMismatch.flatMap(users),
      'Check whether the imported mesh uses its vertex colors the way the original did.');
  }
  const specials = [];
  if (audit.objects.instanced) specials.push(`${audit.objects.instanced} InstancedMesh`);
  if (audit.objects.points) specials.push(`${audit.objects.points} Points`);
  if (audit.objects.lines) specials.push(`${audit.objects.lines} Line`);
  if (audit.objects.sprites) specials.push(`${audit.objects.sprites} Sprite`);
  if (audit.objects.skinned) specials.push(`${audit.objects.skinned} SkinnedMesh`);
  if (specials.length) {
    add('L11', 'info', 'Object kinds the exporter writes in another form, or not at all. How Godot imports them was not measured.', specials,
      'Import a small sample first and look at the node tree.');
  }
  const textureInfo = audit.materials.filter(m => m.textures.length);
  if (textureInfo.length) {
    add('L12', 'info', 'Textures: check color space, flipY and wrap after import.', textureInfo.flatMap(users), 'See materials.md, property table.');
  }
  // Exporter warnings that no audit rule explained are kept verbatim.
  const covered = new Set(findings.map(f => f.id));
  const grouped = new Map();
  for (const text of warnings) grouped.set(text, (grouped.get(text) || 0) + 1);
  const warningList = [...grouped.entries()].map(([message, count]) => {
    const match = WARNING_PATTERNS.find(p => p.test.test(message));
    return { message, count, rule: match ? match.id : null };
  }).sort((a, b) => a.message.localeCompare(b.message));
  for (const w of warningList) {
    if (!w.rule || !covered.has(w.rule)) {
      findings.push({ id: w.rule || 'W00', severity: 'info', what: `Exporter warning: ${w.message}`, where: [], action: 'Read the warning and decide.' });
    }
  }
  findings.sort((a, b) => a.id.localeCompare(b.id) || a.what.localeCompare(b.what));
  return { findings, warnings: warningList };
}

export function lostMarkdown(report) {
  const lines = [];
  lines.push(`# Lost in translation: ${report.name}`, '');
  lines.push(`three.js revision seen by the page: ${report.revision ?? 'unknown'}; exporter revision: ${report.exporterRevision ?? 'unknown'}`, '');
  const counts = SEVERITIES.map(s => `${s}: ${report.findings.filter(f => f.severity === s).length}`).join(', ');
  lines.push(`Findings: ${report.findings.length} (${counts})`, '');
  if (report.findings.length === 0) lines.push('No findings.', '');
  for (const f of report.findings) {
    lines.push(`## ${f.id} [${f.severity}]`, '', f.what, '');
    if (f.where.length) lines.push(`Where: ${f.where.join(', ')}`, '');
    lines.push(`Action: ${f.action}`, '');
  }
  if (report.warnings.length) {
    lines.push('## Exporter warnings (verbatim)', '');
    for (const w of report.warnings) lines.push(`- ${w.message} (x${w.count})`);
    lines.push('');
  }
  return lines.join('\n');
}
