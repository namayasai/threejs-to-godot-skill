#!/bin/bash
# Example 03: re-verify physics. Runs the Godot-side checks under each physics engine, twice each (two processes),
# and checks that: fresh-world repeats give one path hash, a second process gives the same hash, and the engines can be
# told apart by a fingerprint (proof that the engine switch worked).
#
# Usage: examples/03-physics-recheck/run.sh [--record]     Environment: GODOT, OUT (optional)
# Exit code: 0 all checks hold, 1 otherwise.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
: "${GODOT:?set GODOT to the Godot 4.7 executable}"
OUT="${OUT:-$HERE/out}"
mkdir -p "$OUT"
rm -rf "$HERE/godot/tg_port"; cp -R "$ROOT/skills/threejs-to-godot-port/scripts/godot" "$HERE/godot/tg_port"
trap 'rm -f "$HERE/godot/override.cfg"' EXIT
STATUS=0
run_engine() { # label, engine name, run number
  printf '[physics]\n\n3d/physics_engine="%s"\n' "$2" > "$HERE/godot/override.cfg"
  perl -e 'alarm shift; exec @ARGV' 300 "$GODOT" --headless --path "$HERE/godot" --fixed-fps 120 --script res://tg_port/run_tests.gd < /dev/null > "$OUT/$1-$3.log" 2>&1
  local code=$?
  grep -q '^SCRIPT ERROR' "$OUT/$1-$3.log" && { echo "$1 run $3: a SCRIPT ERROR was printed"; code=1; }
  grep '^PASS\|^FAIL\|^  ' "$OUT/$1-$3.log" | sed "s/^/$1 run $3: /"
  [ $code -ne 0 ] && STATUS=1
  grep '^DATA' "$OUT/$1-$3.log" | sed 's/^DATA //' > "$OUT/$1-$3.data"
}
for pair in "jolt|Jolt Physics" "godot-physics|GodotPhysics3D"; do
  label="${pair%%|*}"; engine="${pair#*|}"
  run_engine "$label" "$engine" 1
  run_engine "$label" "$engine" 2
done
node "$HERE/collect.mjs" "$OUT" "$HERE" "$@" || STATUS=1
[ $STATUS -eq 0 ] && echo "EXAMPLE 03 PASSED" || echo "EXAMPLE 03 FAILED"
exit $STATUS
