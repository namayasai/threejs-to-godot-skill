// Shared browser harness: a tiny local web server, a Chromium page, and the two ways to get a three.js scene.
//
//   module mode:  --module <file>   an ES module that exports createScene({ THREE, canvas, width, height })
//                                   and returns { scene, camera, renderer, step?, ready? }
//   page mode:    --page <url>      a page you already serve; it must expose window.__tgScene (and, when it has
//                                   them, window.__tgCamera, window.__tgRenderer, window.__tgStep, window.__tgReady)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export class HarnessError extends Error {}

export function threeRoot() {
  // Walk up from this file to the nearest node_modules/three (works when the skill is installed anywhere).
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'node_modules', 'three');
    if (fs.existsSync(path.join(candidate, 'build', 'three.module.js'))) return candidate;
    dir = path.dirname(dir);
  }
  throw new HarnessError('three is not installed. Run `npm ci` in the scripts folder.');
}

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream' };

// Replace bare 'three' imports with an absolute URL so every module shares one three instance.
function rewriteImports(source, origin) {
  return source
    .replace(/(from\s*|import\s*\(\s*|import\s+)(['"])three\2/g, `$1$2${origin}/vendor/three/build/three.module.js$2`)
    .replace(/(from\s*|import\s*\(\s*|import\s+)(['"])three\/addons\//g, `$1$2${origin}/vendor/three/examples/jsm/`);
}

function safeJoin(root, relative) {
  const full = path.resolve(root, '.' + path.posix.normalize('/' + relative));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

export async function startServer({ userRoot } = {}) {
  const three = threeRoot();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const origin = `http://${req.headers.host}`;
    res.setHeader('Access-Control-Allow-Origin', '*');
    let file = null;
    if (url.pathname.startsWith('/vendor/three/')) file = safeJoin(three, decodeURIComponent(url.pathname.slice('/vendor/three/'.length)));
    else if (userRoot && url.pathname.startsWith('/user/')) file = safeJoin(userRoot, decodeURIComponent(url.pathname.slice('/user/'.length)));
    if (url.pathname === '/__harness.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}canvas{display:block}</style><canvas id="c"></canvas>');
      return;
    }
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; res.end('not found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    if (ext === '.js' || ext === '.mjs') res.end(rewriteImports(fs.readFileSync(file, 'utf8'), origin));
    else res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

export async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new HarnessError('playwright is not installed. Run `npm ci` in the scripts folder, then `npx playwright install chromium`.');
  }
  try {
    return await chromium.launch({ headless: true,
      ...(process.env.TG_CHROMIUM_EXECUTABLE ? { executablePath: process.env.TG_CHROMIUM_EXECUTABLE } : {}) });
  } catch (error) {
    throw new HarnessError(`Chromium could not start (${String(error.message).split('\n')[0]}). Run \`npx playwright install chromium\`.`);
  }
}

// Opens the scene and returns { page, close, warnings(), info }.
// width and height size the viewport (and the canvas in module mode).
export async function openScene({ module: modulePath, page: pageUrl, width = 640, height = 360 }) {
  if ((modulePath ? 1 : 0) + (pageUrl ? 1 : 0) !== 1) throw new HarnessError('give exactly one of --module and --page');
  const moduleAbs = modulePath ? path.resolve(modulePath) : null;
  if (moduleAbs && !fs.existsSync(moduleAbs)) throw new HarnessError('the --module file does not exist');
  let server = null;
  let browser = null;
  // Acquiring a browser can fail (for example before Chromium is installed). Close
  // everything already acquired so the HTTP listener cannot keep the CLI alive.
  const close = async () => {
    try { if (browser) await browser.close(); }
    finally { if (server) await server.close(); }
  };
  const problems = [];
  try {
    server = await startServer({ userRoot: moduleAbs ? path.dirname(moduleAbs) : undefined });
    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
    let pageRevision = null;
    if (moduleAbs) {
      await page.goto(`${server.origin}/__harness.html`);
      await page.evaluate(async ({ moduleUrl, width: w, height: h }) => {
        const THREE = await import('/vendor/three/build/three.module.js');
        const mod = await import(moduleUrl);
        if (typeof mod.createScene !== 'function') throw new Error('the module must export createScene({ THREE, canvas, width, height })');
        const canvas = document.getElementById('c');
        const made = await mod.createScene({ THREE, canvas, width: w, height: h });
        if (!made || !made.scene) throw new Error('createScene must return { scene, camera, renderer }');
        window.__tg = { THREE, scene: made.scene, camera: made.camera || null, renderer: made.renderer || null, step: made.step || null, ready: made.ready || null };
        window.__tgPageRevision = THREE.REVISION;
      }, { moduleUrl: `${server.origin}/user/${path.basename(moduleAbs)}`, width, height });
    } else {
      await page.goto(pageUrl, { waitUntil: 'load' });
      try {
        await page.waitForFunction(() => window.__tgScene, undefined, { timeout: 30000 });
      } catch {
        throw new HarnessError('the page did not set window.__tgScene within 30 s. Expose the scene with: window.__tgScene = scene; window.__tgCamera = camera; window.__tgRenderer = renderer;');
      }
      pageRevision = await page.evaluate(() => window.__THREE__ || null);
      await page.evaluate(async origin => {
        let THREE = null;
        try { THREE = await import(`${origin}/vendor/three/build/three.module.js`); } catch { /* the page may block cross-origin imports */ }
        window.__tg = { THREE, scene: window.__tgScene, camera: window.__tgCamera || null, renderer: window.__tgRenderer || null, step: window.__tgStep || null, ready: window.__tgReady || null };
      }, server.origin);
      await page.evaluate(rev => { window.__tgPageRevision = rev; }, pageRevision);
      const exporterRevision = await page.evaluate(() => (window.__tg.THREE ? window.__tg.THREE.REVISION : null));
      if (pageRevision && exporterRevision && String(pageRevision) !== String(exporterRevision)) {
        problems.push(`three revision mismatch: the page uses r${pageRevision}, the exporter uses r${exporterRevision}. The export may differ in small ways.`);
      }
    }
    await page.evaluate(async () => {
      const ready = window.__tg.ready;
      if (typeof ready === 'function') await ready();
      else if (ready && typeof ready.then === 'function') await ready;
    });
    return { page, server, close, problems, mode: moduleAbs ? 'module' : 'page' };
  } catch (error) {
    await close();
    if (error instanceof HarnessError) throw error;
    const first = String(error.message).split('\n')[0];
    const bare = first.match(/Failed to resolve module specifier "([^"]+)"/);
    if (bare) {
      throw new HarnessError(`module mode resolves only "three" and "three/addons/..." imports. "${bare[1]}" cannot be resolved. Use relative imports (bundle or copy the package next to the scene file), or use page mode with your own dev server.`);
    }
    throw new HarnessError(first);
  }
}

// Exports the scene with the pinned exporter and returns { glb: Buffer, warnings: string[] }.
export async function exportGlb(page, origin, { onlyVisible = true } = {}) {
  const result = await page.evaluate(async ({ origin: o, onlyVisible: only }) => {
    const warnings = [];
    const original = console.warn;
    console.warn = (...args) => {
      warnings.push(args.map(a => (typeof a === 'string' ? a : (a && (a.type || a.name)) || typeof a)).join(' '));
    };
    try {
      const { GLTFExporter } = await import(`${o}/vendor/three/examples/jsm/exporters/GLTFExporter.js`);
      const exporter = new GLTFExporter();
      const buffer = await exporter.parseAsync(window.__tg.scene, { binary: true, onlyVisible: only });
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { base64: btoa(binary), warnings };
    } finally {
      console.warn = original;
    }
  }, { origin, onlyVisible });
  return { glb: Buffer.from(result.base64, 'base64'), warnings: result.warnings };
}

export function parseArgs(argv, spec) {
  // spec: { name: { type: 'string' | 'boolean', required?: boolean } }
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new HarnessError(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const def = spec[key];
    if (!def) throw new HarnessError(`unknown option: ${arg}`);
    if (def.type === 'boolean') { out[key] = true; continue; }
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new HarnessError(`option ${arg} needs a value`);
    out[key] = value;
  }
  for (const [key, def] of Object.entries(spec)) if (def.required && out[key] === undefined) throw new HarnessError(`missing required option --${key}`);
  return out;
}

export { here as harnessDir };
