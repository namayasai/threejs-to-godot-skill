// Functions that run INSIDE the browser page (Playwright serialises them with toString()).
// They must stay self-contained: no imports, no references to outer variables.
// They read the scene through window.__tg = { scene, camera, renderer, THREE, step, ready }.

// Inventory of the scene: what a glTF export can lose. Plain JSON out.
export function auditScene() {
  const tg = window.__tg;
  const scene = tg.scene;
  const THREE = tg.THREE;
  scene.updateMatrixWorld(true);
  const sideName = side => (side === 0 ? 'FrontSide' : side === 1 ? 'BackSide' : side === 2 ? 'DoubleSide' : String(side));
  const materials = new Map();
  const lights = [];
  const objects = { total: 0, meshes: 0, instanced: 0, points: 0, lines: 0, sprites: 0, skinned: 0, castShadow: [], receiveShadow: [] };
  const meshInventory = [];
  scene.traverse(object => {
    objects.total++;
    if (object.isLight) {
      lights.push({
        name: object.name || '', type: object.type, castShadow: !!object.castShadow,
        decay: object.decay === undefined ? null : object.decay,
        targetIsChild: object.target ? object.target.parent === object : null,
        targetPosition: object.target ? object.target.position.toArray() : null,
      });
    }
    if (object.isMesh || object.isPoints || object.isLine) {
      if (object.isMesh) objects.meshes++;
      if (object.isInstancedMesh) objects.instanced++;
      if (object.isPoints) objects.points++;
      if (object.isLine) objects.lines++;
      if (object.isSkinnedMesh) objects.skinned++;
      if (object.castShadow) objects.castShadow.push(object.name || (object.type + '#' + object.id));
      if (object.receiveShadow) objects.receiveShadow.push(object.name || (object.type + '#' + object.id));
      const list = Array.isArray(object.material) ? object.material : [object.material];
      const geometry = object.geometry;
      const hasColorAttribute = !!(geometry && geometry.attributes && geometry.attributes.color);
      const names = [];
      for (const material of list) {
        if (!material) continue;
        names.push(material.name || material.type);
        let entry = materials.get(material.uuid);
        if (!entry) {
          entry = {
            name: material.name || '', type: material.type, count: 0, users: [],
            side: sideName(material.side), transparent: !!material.transparent,
            opacity: material.opacity === undefined ? 1 : material.opacity,
            alphaTest: material.alphaTest || 0,
            vertexColors: !!material.vertexColors,
            colorAttributeOnSomeUser: false,
            gradientMap: !!material.gradientMap,
            onBeforeCompile: false,
            isShaderMaterial: !!material.isShaderMaterial,
            textures: [],
          };
          // Patched when assigned on the instance, or defined by a subclass. Walk the prototype chain: the definition
          // closest to Object.prototype is Material.prototype's no-op; any other definition is an override.
          // (No name or source-text comparison: both break between builds, minified or not, and between three instances.)
          if (typeof material.onBeforeCompile === 'function') {
            let definers = 0;
            for (let o = material; o; o = Object.getPrototypeOf(o)) {
              if (Object.prototype.hasOwnProperty.call(o, 'onBeforeCompile')) definers++;
            }
            entry.onBeforeCompile = definers > 1 || Object.prototype.hasOwnProperty.call(material, 'onBeforeCompile');
          }
          for (const key of ['map', 'normalMap', 'emissiveMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'bumpMap']) {
            const texture = material[key];
            if (texture) {
              entry.textures.push({ slot: key, colorSpace: texture.colorSpace || '', flipY: !!texture.flipY });
            }
          }
          materials.set(material.uuid, entry);
        }
        entry.count++;
        if (entry.users.length < 20) entry.users.push(object.name || (object.type + '#' + object.id));
        if (hasColorAttribute) entry.colorAttributeOnSomeUser = true;
      }
      meshInventory.push({
        name: object.name || '', type: object.type, materials: names,
        castShadow: !!object.castShadow, receiveShadow: !!object.receiveShadow,
      });
    }
    if (object.isSprite) objects.sprites++;
  });
  const bg = scene.background;
  const renderer = tg.renderer || null;
  return {
    revision: window.__tgPageRevision || null,
    objects,
    materials: [...materials.values()],
    meshes: meshInventory,
    lights,
    scene: {
      fog: scene.fog ? scene.fog.isFogExp2 ? 'FogExp2' : 'Fog' : null,
      background: bg ? (bg.isColor ? 'color' : bg.isTexture ? 'texture' : 'other') : null,
      environment: !!scene.environment,
    },
    renderer: renderer ? {
      toneMapping: renderer.toneMapping, toneMappingExposure: renderer.toneMappingExposure,
      outputColorSpace: renderer.outputColorSpace, shadowMapEnabled: !!(renderer.shadowMap && renderer.shadowMap.enabled),
    } : null,
  };
}

// Light, camera, fog, background and renderer settings, in world space. Plain JSON out.
export function collectSettings() {
  const tg = window.__tg;
  const { scene, camera, renderer } = tg;
  const THREE = tg.THREE;
  scene.updateMatrixWorld(true);
  if (camera) camera.updateMatrixWorld(true);
  const toneNames = {};
  if (THREE) {
    const pairs = { NoToneMapping: THREE.NoToneMapping, LinearToneMapping: THREE.LinearToneMapping, ReinhardToneMapping: THREE.ReinhardToneMapping,
      CineonToneMapping: THREE.CineonToneMapping, ACESFilmicToneMapping: THREE.ACESFilmicToneMapping, AgXToneMapping: THREE.AgXToneMapping,
      NeutralToneMapping: THREE.NeutralToneMapping, CustomToneMapping: THREE.CustomToneMapping };
    for (const [name, value] of Object.entries(pairs)) if (value !== undefined) toneNames[value] = name;
  }
  const shadowTypeNames = THREE ? { [THREE.BasicShadowMap]: 'BasicShadowMap', [THREE.PCFShadowMap]: 'PCFShadowMap', [THREE.VSMShadowMap]: 'VSMShadowMap' } : {};
  if (THREE && THREE.PCFSoftShadowMap !== undefined) shadowTypeNames[THREE.PCFSoftShadowMap] = 'PCFSoftShadowMap';
  const colorOut = color => ({ srgb: color.getHexString ? '#' + color.getHexString('srgb') : null, linear: [color.r, color.g, color.b] });
  const world = object => {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    object.matrixWorld.decompose(p, q, s);
    return { position: p.toArray(), quaternion: q.toArray() };
  };
  const out = { schema: 1, source: { three: window.__tgPageRevision || (THREE ? THREE.REVISION : null) } };
  // Things the Godot side cannot carry yet. The CLI prints them; apply_settings.gd also notes some of them.
  const warnings = [];
  out.renderer = renderer ? {
    toneMapping: toneNames[renderer.toneMapping] || String(renderer.toneMapping),
    toneMappingExposure: renderer.toneMappingExposure,
    outputColorSpace: renderer.outputColorSpace,
    shadowMap: { enabled: !!renderer.shadowMap.enabled, type: shadowTypeNames[renderer.shadowMap.type] || String(renderer.shadowMap.type) },
    antialias: renderer.getContextAttributes ? !!renderer.getContextAttributes().antialias : null,
  } : null;
  if (camera) {
    const w = world(camera);
    out.camera = {
      type: camera.type, fov: camera.fov === undefined ? null : camera.fov, aspect: camera.aspect === undefined ? null : camera.aspect,
      near: camera.near, far: camera.far, zoom: camera.zoom,
      effectiveFOV: camera.isPerspectiveCamera ? camera.getEffectiveFOV() : null,
      position: w.position, quaternion: w.quaternion,
    };
    if (camera.isOrthographicCamera) {
      out.camera.ortho = { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom };
      warnings.push('OrthographicCamera: the Godot side falls back to a perspective camera, and shots.json needs a fov, so this scene cannot be captured or compared yet.');
    }
  } else {
    out.camera = null;
  }
  const bg = scene.background;
  out.background = bg && bg.isColor ? { type: 'color', ...colorOut(bg) } : bg ? { type: bg.isTexture ? 'texture' : 'other' } : { type: 'none' };
  const fog = scene.fog;
  out.fog = fog ? (fog.isFogExp2
    ? { type: 'FogExp2', color: colorOut(fog.color), density: fog.density }
    : { type: 'Fog', color: colorOut(fog.color), near: fog.near, far: fog.far }) : null;
  if (fog && fog.isFogExp2) warnings.push('FogExp2: three.js blends with 1 - exp(-density^2 * depth^2); Godot exponential fog uses its own curve. The brightness match was not measured.');
  else if (fog) warnings.push('Fog: three.js blends with smoothstep(near, far, depth); Godot depth fog uses fog_depth_curve. The brightness match was not measured.');
  out.environment = { hasEnvironmentMap: !!scene.environment, intensity: scene.environmentIntensity === undefined ? null : scene.environmentIntensity };
  out.lights = [];
  // Match the visible snapshot exported to glTF, including hidden ancestors.
  scene.traverseVisible(object => {
    if (!object.isLight) return;
    const w = world(object);
    const entry = {
      name: object.name || '', type: object.type, color: colorOut(object.color), intensity: object.intensity,
      position: w.position, quaternion: w.quaternion, castShadow: !!object.castShadow,
    };
    if (object.isDirectionalLight || object.isSpotLight) {
      const target = object.target;
      if (target) {
        target.updateMatrixWorld(true);
        const t = new THREE.Vector3().setFromMatrixPosition(target.matrixWorld);
        const d = t.sub(new THREE.Vector3().fromArray(w.position)).normalize();
        entry.direction = d.toArray();
      }
    }
    if (object.isHemisphereLight) entry.groundColor = colorOut(object.groundColor);
    if (object.isPointLight || object.isSpotLight) { entry.distance = object.distance; entry.decay = object.decay; }
    if (object.isSpotLight) { entry.angle = object.angle; entry.penumbra = object.penumbra; }
    if (object.shadow) {
      const sc = object.shadow.camera;
      entry.shadow = {
        mapSize: [object.shadow.mapSize.x, object.shadow.mapSize.y], bias: object.shadow.bias, normalBias: object.shadow.normalBias, radius: object.shadow.radius,
        camera: sc ? { near: sc.near, far: sc.far, left: sc.left, right: sc.right, top: sc.top, bottom: sc.bottom } : null,
      };
    }
    out.lights.push(entry);
  });
  // Materials and shadow flags by name, so the Godot side can rebuild what glTF cannot carry.
  const materials = new Map();
  out.objects = [];
  scene.traverse(object => {
    if (!(object.isMesh)) return;
    const list = Array.isArray(object.material) ? object.material : [object.material];
    out.objects.push({
      name: object.name || '', material: list[0] ? (list[0].name || list[0].type) : null,
      castShadow: !!object.castShadow, receiveShadow: !!object.receiveShadow, instanced: !!object.isInstancedMesh,
    });
    for (const material of list) {
      if (!material || materials.has(material.uuid)) continue;
      const entry = { name: material.name || '', type: material.type, side: material.side, transparent: !!material.transparent, opacity: material.opacity === undefined ? 1 : material.opacity,
        vertexColors: !!material.vertexColors };
      if (material.color) entry.color = colorOut(material.color);
      if (material.emissive) entry.emissive = colorOut(material.emissive);
      if (material.isMeshToonMaterial) {
        const gm = material.gradientMap;
        if (gm && gm.image && gm.image.data) entry.gradientMap = { width: gm.image.width, height: gm.image.height, values: Array.from(gm.image.data) };
        else if (gm) warnings.push(`Material '${entry.name || 'toon'}': gradientMap was loaded from an image, so its pixel values are not in settings.json. Read the values yourself and add them, or build the gradient texture by hand in Godot.`);
      }
      materials.set(material.uuid, entry);
    }
  });
  out.materials = [...materials.values()];
  const instanced = out.objects.filter(o => o.instanced).map(o => o.name || '(unnamed)');
  if (instanced.length) warnings.push(`InstancedMesh (${instanced.slice(0, 5).join(', ')}): how Godot imports it was not measured; materials and shadow flags may not be applied by name.`);
  if (warnings.length) out.warnings = warnings;
  return out;
}
