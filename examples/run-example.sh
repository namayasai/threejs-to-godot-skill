#!/bin/bash
# Run one example end to end: export, dump settings, capture three.js, capture Godot, compare.
#
# Usage: examples/run-example.sh <example-dir> [--controls] [--record]
#   <example-dir>   e.g. examples/01-basic-lit
#   --controls      also run the negative controls (deliberately wrong Godot sides) and require them to FAIL
#   --record        write <example-dir>/expected.json (measured values) and expected/<shot>.png (three.js on top, Godot below) after a passing run
#   Environment: GODOT must point at the Godot 4.7 executable. OUT (optional) is the output folder.
# Exit code: 0 the example passes (and every control fails, with --controls), 1 otherwise.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTS="$ROOT/skills/threejs-to-godot-port/scripts"
EX="$(cd "$1" && pwd)"; shift
CONTROLS=0
RECORD=0
for a in "$@"; do [ "$a" = "--controls" ] && CONTROLS=1; [ "$a" = "--record" ] && RECORD=1; done
: "${GODOT:?set GODOT to the Godot 4.7 executable}"
OUT="${OUT:-$EX/out}"
mkdir -p "$OUT"
cfg() { node -e "const c=require('$EX/example.json'); const v=c['$1']; process.stdout.write((Array.isArray(v)?v.join('\n'):String(v??''))+'\n')"; }
HOOK="$(cfg hook)"
BASE_OPTS=()
while IFS= read -r line; do [ -n "$line" ] && BASE_OPTS+=(--opt "$line"); done < <(cfg options)

rm -rf "$EX/godot/tg_port"; cp -R "$SCRIPTS/godot" "$EX/godot/tg_port"

node "$SCRIPTS/export-scene.mjs" --module "$EX/three/scene.mjs" --out "$OUT" --name scene || exit 1
node "$SCRIPTS/dump-settings.mjs" --module "$EX/three/scene.mjs" --out "$OUT/scene.settings.json" || exit 1
node "$SCRIPTS/capture-three.mjs" --module "$EX/three/scene.mjs" --shots "$EX/shots.json" --out "$OUT/three" || exit 1

godot_capture() { # name, extra args...
  local name="$1"; shift
  local hook_args=()
  [ -n "$HOOK" ] && hook_args=(--hook "$HOOK")
  perl -e 'alarm shift; exec @ARGV' 180 "$GODOT" --path "$EX/godot" --rendering-method forward_plus --resolution 640x360 --windowed \
    --fixed-fps 120 --audio-driver Dummy res://tg_port/capture.tscn -- --shots "$EX/shots.json" --settings "$OUT/scene.settings.json" \
    --glb "$OUT/scene.glb" --out "$OUT/$name" ${hook_args[@]+"${hook_args[@]}"} ${BASE_OPTS[@]+"${BASE_OPTS[@]}"} "$@" > "$OUT/$name.log" 2>&1 < /dev/null
  local code=$?
  [ $code -ne 0 ] && { echo "Godot capture '$name' failed (exit $code). See $name.log"; return 1; }
  return 0
}

echo "--- Godot tests (headless)"
TG_SETTINGS="$OUT/scene.settings.json" TG_GLB="$OUT/scene.glb" perl -e 'alarm shift; exec @ARGV' 300 "$GODOT" --headless --path "$EX/godot" --fixed-fps 120 \
  --script res://tg_port/run_tests.gd < /dev/null > "$OUT/godot-tests.log" 2>&1
TESTS=$?
grep -q '^SCRIPT ERROR' "$OUT/godot-tests.log" && { echo "a SCRIPT ERROR was printed in the Godot tests"; TESTS=1; }
grep '^PASS\|^FAIL\|^  \|^ALL TESTS\|^FAILED' "$OUT/godot-tests.log"
[ $TESTS -ne 0 ] && { echo "Godot tests failed"; exit 1; }

echo "--- reference stability (the three.js side captured twice)"
node "$SCRIPTS/capture-three.mjs" --module "$EX/three/scene.mjs" --shots "$EX/shots.json" --out "$OUT/three-again" > /dev/null || exit 1
node "$SCRIPTS/compare-shots.mjs" --ref "$OUT/three" --test "$OUT/three-again" --shots "$EX/shots.json" --thresholds "$ROOT/examples/stability.json" --out "$OUT/compare-stability" || { echo "the reference is not stable: fix time, randomness and animation first"; exit 1; }

godot_capture godot || exit 1
node "$SCRIPTS/compare-shots.mjs" --ref "$OUT/three" --test "$OUT/godot" --shots "$EX/shots.json" --thresholds "$EX/thresholds.json" --out "$OUT/compare-main" --diff
MAIN=$?
STATUS=0
[ $MAIN -ne 0 ] && STATUS=1

if [ $CONTROLS -eq 1 ]; then
  echo "--- negative controls (each must FAIL the comparison)"
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    name="${line%%|*}"; args="${line#*|}"
    read -r -a extra <<< "$args"
    godot_capture "control-$name" ${extra[@]+"${extra[@]}"} || { STATUS=1; continue; }
    node "$SCRIPTS/compare-shots.mjs" --ref "$OUT/three" --test "$OUT/control-$name" --shots "$EX/shots.json" --thresholds "$EX/thresholds.json" --out "$OUT/compare-control-$name" > "$OUT/compare-control-$name.txt"
    if [ $? -eq 3 ]; then
      # Camera metadata detects wrong viewpoints, but does not demonstrate visual
      # sensitivity. In particular, the FOV control must fail the image metrics.
      factor=$(node -e "const r=require('$OUT/compare-control-$name/report.json'); process.stdout.write(String(r.summary.maxVisualFailFactor))")
      if node -e "process.exit(Number('$factor') >= 2 ? 0 : 1)"; then echo "control $name: fails as expected (worst visual check is $factor times its limit)"
      else echo "control $name: fails, but visual checks are only $factor times their limits (need 2 or more): the thresholds are too loose"; STATUS=1; fi
    else echo "control $name: DID NOT FAIL (thresholds too loose, or the control does nothing)"; STATUS=1; fi
  done < <(cfg controls)
fi
if [ $RECORD -eq 1 ] && [ $STATUS -eq 0 ]; then
  node "$ROOT/examples/record-expected.mjs" "$OUT" "$EX"
  rm -rf "$EX/expected"; mkdir -p "$EX/expected"
  cp "$OUT"/compare-main/compare/*.png "$EX/expected/"
fi
exit $STATUS
