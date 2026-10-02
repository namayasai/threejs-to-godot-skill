#!/usr/bin/env node
// Helper: check the environment before starting a port.
//
// Usage: node doctor.mjs [--skip-godot]
// Checks: Node version, installed packages, Chromium start and WebGL, the Godot executable ($GODOT) and its version,
// and a windowed Godot draw (a 64 x 64 test image whose center pixel is read back).
// Exit codes: 0 every check passed, 1 at least one check failed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launchBrowser, threeRoot, HarnessError } from './lib/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const report = (ok, name, detail = '') => { results.push(ok); console.log(`${ok ? 'OK' : 'NG'}  ${name}${detail ? `: ${detail}` : ''}`); };

async function main() {
  const skipGodot = process.argv.includes('--skip-godot');
  if (process.argv.includes('--help')) { console.log('Usage: node doctor.mjs [--skip-godot]'); return 0; }
  const major = Number(process.versions.node.split('.')[0]);
  report(major >= 22, 'node', `${process.versions.node} (tested with 22.14.0)`);
  try {
    const three = JSON.parse(fs.readFileSync(path.join(threeRoot(), 'package.json'), 'utf8'));
    report(true, 'three', three.version);
  } catch (error) {
    report(false, 'three', error instanceof HarnessError ? error.message : String(error.message));
  }
  try {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      const webgl = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
      report(webgl, 'chromium webgl2', `Chromium ${browser.version()}`);
    } finally {
      await browser.close();
    }
  } catch (error) {
    report(false, 'chromium', error instanceof HarnessError ? error.message : String(error.message).split('\n')[0]);
  }
  if (!skipGodot) {
    const godot = process.env.GODOT;
    if (!godot) {
      report(false, 'GODOT', 'environment variable GODOT is not set. Point it at the Godot 4.7 executable.');
    } else {
      const v = spawnSync(godot, ['--version'], { encoding: 'utf8' });
      const version = (v.stdout || '').trim().split('\n').pop();
      report(v.status === 0 && /^4\.\d+/.test(version), 'godot version', version || 'could not run');
      if (v.status === 0 && !/^4\.7\./.test(version)) console.log('     note: this skill was tested with Godot 4.7 only');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-doctor-'));
      try {
        fs.writeFileSync(path.join(dir, 'project.godot'), 'config_version=5\n\n[application]\n\nconfig/name="tg-doctor"\n');
        fs.cpSync(path.join(here, 'godot'), path.join(dir, 'tg_port'), { recursive: true });
        const run = spawnSync(godot, ['--path', dir, '--rendering-method', 'forward_plus', '--resolution', '64x64', '--windowed', '--fixed-fps', '120', '--audio-driver', 'Dummy', 'res://tg_port/capture.tscn', '--', '--probe'],
          { encoding: 'utf8', timeout: 120000 });
        const line = (run.stdout || '').split('\n').find(l => l.startsWith('PROBE'));
        report(run.status === 0 && !!line, 'godot window draw', line ? line.replace('PROBE ', '') : 'no image was read back. A window is needed; headless mode does not draw.');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  return results.every(Boolean) ? 0 : 1;
}

main().then(code => { process.exitCode = code; }).catch(error => { console.error(error); process.exitCode = 1; });
