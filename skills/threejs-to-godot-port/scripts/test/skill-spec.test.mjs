// Checks SKILL.md against the Agent Skills format and against the repository (paths, tool names, --help).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const here = path.dirname(fileURLToPath(import.meta.url));
const scripts = path.join(here, '..');
const skillDir = path.join(scripts, '..');
const text = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const parts = text.split(/^---$/m);
const frontmatter = parts[1];
const body = parts.slice(2).join('---');

function field(name) {
  const m = frontmatter.match(new RegExp(`^${name}: (.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

test('frontmatter follows the Agent Skills format', () => {
  const name = field('name');
  assert.equal(name, path.basename(skillDir), 'name equals the folder name');
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(name.length <= 64);
  const description = field('description');
  assert.ok(description && description.length >= 1 && description.length <= 1024, `description is ${description && description.length} characters`);
  const compatibility = field('compatibility');
  assert.ok(compatibility && compatibility.length <= 500);
  const topKeys = [...frontmatter.matchAll(/^([A-Za-z-]+):/gm)].map(m => m[1]);
  const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
  for (const key of topKeys) assert.ok(allowed.has(key) || ['tested-with', 'repository'].includes(key), `unexpected frontmatter key ${key}`);
});

test('SKILL.md has fewer than 500 lines', () => {
  assert.ok(text.split('\n').length < 500);
});

test('every bundled path named in SKILL.md exists', () => {
  const repo = path.join(skillDir, '..', '..');
  const named = new Set([...body.matchAll(/`((?:scripts|references|examples)\/[A-Za-z0-9_./-]+?)`/g)].map(m => m[1]));
  assert.ok(named.size > 10);
  for (const p of named) {
    // Folder-only installation deliberately excludes the repository examples.
    // Check those when the repository is present; always check bundled resources.
    if (p.startsWith('examples/') && !fs.existsSync(path.join(repo, 'examples'))) continue;
    const candidates = [path.join(skillDir, p), path.join(repo, p)];
    assert.ok(candidates.some(c => fs.existsSync(c)), `${p} does not exist`);
  }
});

test('every tool in the table has a --help and SKILL.md names it', () => {
  for (const tool of ['export-scene.mjs', 'dump-settings.mjs', 'capture-three.mjs', 'compare-shots.mjs']) {
    assert.ok(body.includes(`scripts/${tool}`), `${tool} is named in SKILL.md`);
    const r = spawnSync('node', [path.join(scripts, tool), '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage/);
    assert.ok(!r.stdout.includes(scripts), 'help text holds no absolute path');
  }
  assert.equal(spawnSync('node', [path.join(scripts, 'doctor.mjs'), '--help'], { encoding: 'utf8' }).status, 0);
});

test('pitfall ids mentioned in SKILL.md exist in pitfalls.md', () => {
  const pitfalls = fs.readFileSync(path.join(skillDir, 'references', 'pitfalls.md'), 'utf8');
  for (const id of new Set(body.match(/\bP\d\d\b/g))) assert.ok(pitfalls.includes(`| ${id} |`), `${id} is not in pitfalls.md`);
});

test('loss rule ids mentioned in SKILL.md and the references exist in loss-rules.mjs', async () => {
  const source = fs.readFileSync(path.join(scripts, 'lib', 'loss-rules.mjs'), 'utf8');
  const docs = [body, fs.readFileSync(path.join(skillDir, 'references', 'materials.md'), 'utf8'), fs.readFileSync(path.join(skillDir, 'references', 'lights-camera-environment.md'), 'utf8'), fs.readFileSync(path.join(skillDir, 'references', 'pitfalls.md'), 'utf8')].join('\n');
  for (const id of new Set(docs.match(/\bL\d\d\b/g))) assert.ok(source.includes(`'${id}'`), `${id} is not a rule in loss-rules.mjs`);
});

// Reproduce the supported manual-copy layout, rather than testing only a checkout.
test('folder-only installation passes its skill checks', { skip: process.env.TG_FOLDER_ONLY_CHECK === '1' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-installed-skill-'));
  try {
    const installed = path.join(dir, 'threejs-to-godot-port');
    fs.cpSync(skillDir, installed, { recursive: true,
      filter: source => !source.split(path.sep).includes('node_modules') });
    const dependencies = path.join(scripts, 'node_modules');
    if (fs.existsSync(dependencies)) fs.symlinkSync(dependencies, path.join(installed, 'scripts', 'node_modules'), 'dir');
    assert.ok(fs.existsSync(path.join(installed, 'LICENSE')), 'the installed folder retains the MIT notice');
    const result = spawnSync(process.execPath, ['--test', path.join(installed, 'scripts', 'test', 'skill-spec.test.mjs')], {
      encoding: 'utf8', timeout: 30000, env: { ...process.env, TG_FOLDER_ONLY_CHECK: '1' },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
