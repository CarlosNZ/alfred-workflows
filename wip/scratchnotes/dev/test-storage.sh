#!/bin/zsh
# Tests lib.js's storage functions (dev/test-storage.js does the work) against
# a temporary folder from mktemp, deleted afterwards. Never touches the real
# notes folder or the workflow folder. Run from anywhere:
#
#   dev/test-storage.sh             everything
#   SKIP_TRASH=1 dev/test-storage.sh   without the Trash test
#
# The Trash test moves one note it created to the Trash through Finder (macOS
# asks for permission to control Finder the first time), then deletes just
# that file from the Trash.

setopt err_return pipe_fail no_unset
here=${0:A:h}
workflow=${here:h}
runner=$here/test-storage.js
tmp=$(mktemp -d "${${TMPDIR:-/tmp}%/}/scratchnotes-test.XXXXXX")
trap '[[ $tmp == */scratchnotes-test.* ]] && rm -rf -- "$tmp"' EXIT
failures=0

ok() { print -r -- "ok    $1" }
fail() { print -r -- "FAIL  $1"; (( failures++ )) || true }

print "# Loading lib.js (run from other folders, as Alfred runs external scripts)"
expected="loaded $workflow/scripts/lib.js"
ln -s "$workflow" "$tmp/linked"
check_loader() {
  local label=$1 dir=$2 script=$3 out
  out=$(cd "$dir" && "$script" loader 2>&1) || true
  # Through the symlink, lib.js is found at the symlinked path.
  if [[ $out == "$expected"* || $out == "loaded $tmp/linked/scripts/lib.js"* ]]; then ok "$label"; else fail "$label: $out"; fi
}
check_loader "absolute path, from the temp folder" "$tmp" "$runner"
check_loader "absolute path, from /" / "$runner"
check_loader "relative path, from the folder above the workflow" "${workflow:h}" "./${workflow:t}/dev/test-storage.js"
check_loader "relative path, from inside dev/" "$here" "./test-storage.js"
check_loader "through a symlinked workflow folder (as Alfred links it)" "$tmp" "linked/dev/test-storage.js"
out=$(cd "$tmp" && osascript -l JavaScript "$runner" loader 2>&1) || true
if [[ $out == "$expected"* ]]; then ok "run with osascript -l JavaScript <path>"; else fail "osascript <path>: $out"; fi

"$runner" test "$tmp/unit" || (( failures++ )) || true

print "\n# Concurrent saves (separate processes racing on one note)"
# The long versions are about 5 MB, so that writes take long enough to overlap
# despite osascript's startup time: at this size a plain write in place leaves
# a mixed note every time (tested), while the atomic save never does.
conc=$tmp/concurrent
mkdir -p "$conc/notes"
for round in create overwrite; do
  for i in {1..12}; do
    if (( i % 2 )); then
      { for j in {1..200000}; do print "long version $i, line $j"; done } > "$conc/text-$i"
    else
      print "short version $i" > "$conc/text-$i"
    fi
  done
  pids=()
  for i in {1..12}; do "$runner" save "$conc/notes" race "$conc/text-$i" > /dev/null & pids+=($!); done
  wait $pids
  matched=0
  for i in {1..12}; do cmp -s "$conc/notes/race.md" "$conc/text-$i" && matched=1; done
  if (( matched )); then ok "$round: the note is exactly one complete version"; else fail "$round: the note matches no version"; fi
  leftovers=$(ls -A "$conc/notes" "$conc/notes/.scratchnotes" | grep -c '^\.scratchnotes-save-' || true)
  if (( leftovers == 0 )); then ok "$round: no temporary files left"; else fail "$round: $leftovers temporary files left"; fi
done

if [[ -n ${SKIP_TRASH:-} ]]; then
  print "\n# Trash: skipped (SKIP_TRASH)"
else
  "$runner" trash "$tmp/trash" || (( failures++ )) || true
fi

print
if (( failures )); then print "FAILED: $failures failing step(s)"; exit 1; else print "All passed"; fi
