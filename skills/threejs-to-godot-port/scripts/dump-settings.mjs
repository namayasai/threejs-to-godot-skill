#!/usr/bin/env node
// (b) Dump the settings glTF cannot carry (lights, camera, fog, background, tone mapping, shadow settings, material
//     inventory) as JSON, in world space.
//
// Usage:
//   node dump-settings.mjs --module <scene.mjs> --out <file.settings.json> [--width 640 --height 360]
//   node dump-settings.mjs --page <url>         --out <file.settings.json>
//
// Output: one JSON file (schema 1, keys in a fixed order, no timestamps, no absolute paths).
// Exit codes: 0 done, 1 failure.
import fs from 'node:fs';
import path from 'node:path';
import { openScene, parseArgs, HarnessError } from './lib/harness.mjs';
import { collectSettings } from './lib/page-fns.mjs';

const SPEC = { module: { type: 'string' }, page: { type: 'string' }, out: { type: 'string', required: true }, width: { type: 'string' }, height: { type: 'string' }, help: { type: 'boolean' } };
const USAGE = `Usage:
  node dump-settings.mjs --module <scene.mjs> --out <file.settings.json> [--width 640] [--height 360]
  node dump-settings.mjs --page <url>         --out <file.settings.json>
Exit codes: 0 done, 1 failure.`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) { console.log(USAGE); return 0; }
  const args = parseArgs(argv, SPEC);
  const opened = await openScene({ module: args.module, page: args.page, width: Number(args.width ?? 640), height: Number(args.height ?? 360) });
  try {
    const settings = await opened.page.evaluate(collectSettings);
    if (opened.problems.length) settings.notes = opened.problems;
    const out = path.resolve(args.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(settings, null, 2) + '\n');
    for (const w of settings.warnings || []) console.error(`warning: ${w}`);
    console.log(`settings: ${settings.lights.length} lights, camera ${settings.camera ? settings.camera.type : 'none'}, fog ${settings.fog ? settings.fog.type : 'none'}`);
    return 0;
  } finally {
    await opened.close();
  }
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error instanceof HarnessError ? `error: ${error.message}` : error);
  process.exitCode = 1;
});
