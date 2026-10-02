#!/usr/bin/env node
// (a) Export a three.js scene to .glb with the pinned GLTFExporter, collect the exporter's warnings, audit the scene,
//     and write a "lost in translation" list.
//
// Usage:
//   node export-scene.mjs --module <scene.mjs> --out <dir> [--name <base>] [--fail-on lost] [--width 640 --height 360]
//   node export-scene.mjs --page <url>         --out <dir> [--name <base>] [--fail-on lost]
//
// Outputs in <dir>: <name>.glb, <name>.lost.json, <name>.lost.md
// Exit codes: 0 done, 1 the tool failed, 2 findings of severity "lost" exist and --fail-on lost was given.
import fs from 'node:fs';
import path from 'node:path';
import { openScene, exportGlb, parseArgs, HarnessError } from './lib/harness.mjs';
import { auditScene } from './lib/page-fns.mjs';
import { findLosses, lostMarkdown } from './lib/loss-rules.mjs';

const SPEC = {
  module: { type: 'string' }, page: { type: 'string' }, out: { type: 'string', required: true }, name: { type: 'string' },
  'fail-on': { type: 'string' }, width: { type: 'string' }, height: { type: 'string' }, help: { type: 'boolean' },
};
const USAGE = `Usage:
  node export-scene.mjs --module <scene.mjs> --out <dir> [--name <base>] [--fail-on lost] [--width 640] [--height 360]
  node export-scene.mjs --page <url>         --out <dir> [--name <base>] [--fail-on lost]

Writes <name>.glb, <name>.lost.json and <name>.lost.md into <dir>.
Exit codes: 0 done, 1 failure, 2 findings of severity "lost" with --fail-on lost.`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) { console.log(USAGE); return 0; }
  const args = parseArgs(argv, SPEC);
  if (args['fail-on'] !== undefined && args['fail-on'] !== 'lost') throw new HarnessError('--fail-on accepts only "lost"');
  const name = args.name || (args.module ? path.basename(args.module).replace(/\.[^.]+$/, '') : 'scene');
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new HarnessError('--name may contain only letters, digits, dot, underscore and hyphen');
  const opened = await openScene({ module: args.module, page: args.page, width: Number(args.width ?? 640), height: Number(args.height ?? 360) });
  try {
    const audit = await opened.page.evaluate(auditScene);
    const exported = await exportGlb(opened.page, opened.server.origin);
    const exporterRevision = await opened.page.evaluate(() => (window.__tg.THREE ? window.__tg.THREE.REVISION : null));
    const { findings, warnings } = findLosses(audit, exported.warnings);
    const report = {
      schema: 1, name, revision: audit.revision, exporterRevision, mode: opened.mode,
      notes: opened.problems, glbBytes: exported.glb.length, audit, findings, warnings,
    };
    const outDir = path.resolve(args.out);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `${name}.glb`), exported.glb);
    fs.writeFileSync(path.join(outDir, `${name}.lost.json`), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(outDir, `${name}.lost.md`), lostMarkdown(report) + '\n');
    const lost = findings.filter(f => f.severity === 'lost').length;
    console.log(`${name}: ${findings.length} findings (${lost} lost), ${exported.glb.length} bytes`);
    return args['fail-on'] === 'lost' && lost > 0 ? 2 : 0;
  } finally {
    await opened.close();
  }
}

main().then(code => { process.exitCode = code; }).catch(error => {
  console.error(error instanceof HarnessError ? `error: ${error.message}` : error);
  process.exitCode = 1;
});
