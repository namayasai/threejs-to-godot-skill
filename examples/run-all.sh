#!/bin/bash
# Run every example with its negative controls. Needs GODOT (Godot 4.7 executable), `npm ci` in the scripts folder,
# and Chromium (`npx playwright install chromium`). Pass --record to refresh expected.json and expected/*.png.
# Exit code: 0 all examples pass and all controls fail as intended.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
STATUS=0
for dir in "$HERE"/0[12]-*/; do
  echo "=== $(basename "$dir")"
  "$HERE/run-example.sh" "$dir" --controls "$@" || STATUS=1
done
echo "=== 03-physics-recheck"
"$HERE/03-physics-recheck/run.sh" "$@" || STATUS=1
[ $STATUS -eq 0 ] && echo "ALL EXAMPLES PASSED" || echo "SOME EXAMPLES FAILED"
exit $STATUS
