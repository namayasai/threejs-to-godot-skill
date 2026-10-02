// Collects the DATA lines of the four runs (two engines, two processes each) and checks the re-verification claims.
import fs from 'node:fs';
import path from 'node:path';

const [out, example, flag] = process.argv.slice(2);
// Several DATA lines carry different keys; merge them per run.
const merged = file => {
  const record = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    for (const part of line.split(/ (?=[a-z0-9_]+=)/)) {
      const i = part.indexOf('=');
      if (i > 0) record[part.slice(0, i)] = part.slice(i + 1);
    }
  }
  return record;
};
let ok = true;
const fail = message => { ok = false; console.log(`FAIL: ${message}`); };
const engines = {};
for (const label of ['jolt', 'godot-physics']) {
  const runs = [1, 2].map(n => merged(path.join(out, `${label}-${n}.data`)));
  engines[label] = runs[0];
  if (runs[0].distinct_hashes_in_20_fresh_worlds !== '1') fail(`${label}: 20 fresh worlds gave ${runs[0].distinct_hashes_in_20_fresh_worlds} different paths`);
  if (runs[0].roll_hash !== runs[1].roll_hash) fail(`${label}: the second process gave a different path (${runs[0].roll_hash} against ${runs[1].roll_hash})`);
  console.log(`${label}: fresh-world repeats 1 path, second process ${runs[0].roll_hash === runs[1].roll_hash ? 'same' : 'DIFFERENT'} path hash, sink ${runs[0].rest_sink_mm} mm, slide difference to reference ${runs[0].difference} m`);
}
if (engines.jolt.rest_sink_mm === engines['godot-physics'].rest_sink_mm && engines.jolt.roll_hash === engines['godot-physics'].roll_hash) fail('the two engines are indistinguishable: the engine switch did not take effect');
if (flag === '--record' && ok) {
  const record = { note: 'Measured on one machine, headless, 120 Hz fixed step. The hashes depend on the Godot build; the checks are about equality, not about the values.', engines };
  fs.writeFileSync(path.join(example, 'expected.json'), JSON.stringify(record, null, 2) + '\n');
  console.log('wrote expected.json');
}
process.exit(ok ? 0 : 1);
