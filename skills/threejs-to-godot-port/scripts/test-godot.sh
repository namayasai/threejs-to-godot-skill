#!/bin/bash
# Run the Godot-side unit tests of this skill (no browser needed).
# Usage: GODOT=<path to the Godot 4.7 executable> ./test-godot.sh
# Exit code: 0 all tests passed, 1 otherwise.
set -u
: "${GODOT:?set GODOT to the Godot 4.7 executable}"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/tg-godot-tests.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
printf 'config_version=5\n\n[application]\n\nconfig/name="tg-port-tests"\n' > "$TMP/project.godot"
cp -R "$HERE/godot" "$TMP/tg_port"
mkdir -p "$TMP/tests"
cp -R "$HERE/test-godot/cases" "$TMP/tests/cases"
OUT="$(perl -e 'alarm shift; exec @ARGV' 300 "$GODOT" --headless --path "$TMP" --fixed-fps 120 --script res://tg_port/run_tests.gd < /dev/null 2>&1)"
echo "$OUT" | grep -v '^WARNING\|^ERROR: .*leaked\|^   at:\|^ERROR: .* RID alloc\|^ERROR: Pages in use'
# A runtime script error inside a test does not fail the runner by itself, so look for it in the log.
if echo "$OUT" | grep -q '^SCRIPT ERROR'; then echo "a SCRIPT ERROR was printed: treating the run as failed"; exit 1; fi
echo "$OUT" | grep -q '^ALL TESTS PASSED' && exit 0
exit 1
