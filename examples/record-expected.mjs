// Writes <example>/expected.json from the reports of a run: the measured values next to the thresholds.
// Usage: node record-expected.mjs <out-dir> <example-dir>
import fs from 'node:fs';
import path from 'node:path';

const [out, example] = process.argv.slice(2);
const read = file => JSON.parse(fs.readFileSync(path.join(out, file), 'utf8'));
const round = v => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
const main = read('compare-main/report.json');
const stability = fs.existsSync(path.join(out, 'compare-stability/report.json')) ? read('compare-stability/report.json') : null;
const three = JSON.parse(fs.readFileSync(path.join(out, 'three', fs.readdirSync(path.join(out, 'three')).find(f => f.endsWith('.json')))));
const godot = JSON.parse(fs.readFileSync(path.join(out, 'godot', fs.readdirSync(path.join(out, 'godot')).find(f => f.endsWith('.json')))));
const lost = read('scene.lost.json');
const record = {
  note: 'Measured on one machine. Thresholds are the limits compare-shots.mjs enforces for this example; measured values show the margin.',
  versions: { three: `r${three.threeRevision}`, browser: three.browser, godot: godot.godot, rendering: `${godot.rendering.method}/${godot.rendering.driver}`, platform: `${process.platform}-${process.arch}` },
  lostFindings: lost.findings.map(f => `${f.id}:${f.severity}`),
  thresholds: main.thresholds,
  measured: Object.fromEntries(main.shots.map(s => [s.id, Object.fromEntries(Object.entries(s.metrics).map(([k, v]) => [k, typeof v === 'object' && v !== null ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, typeof b === 'object' ? Object.fromEntries(Object.entries(b).map(([c, d]) => [c, round(d)])) : round(b)])) : round(v)]))])),
  referenceStability: stability ? Object.fromEntries(stability.shots.map(s => [s.id, round(s.metrics.meanAbsDiff)])) : null,
  controls: {},
};
for (const dir of fs.readdirSync(out).filter(d => d.startsWith('compare-control-') && fs.statSync(path.join(out, d)).isDirectory())) {
  const r = read(`${dir}/report.json`);
  record.controls[dir.replace('compare-control-', '')] = { failedShots: r.summary.failed, worstCheckVsLimit: round(r.summary.maxFailFactor) };
}
fs.writeFileSync(path.join(example, 'expected.json'), JSON.stringify(record, null, 2) + '\n');
console.log('wrote expected.json');
