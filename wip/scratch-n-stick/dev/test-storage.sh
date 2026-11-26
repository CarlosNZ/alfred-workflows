#!/bin/zsh
# Tests lib.js's storage functions (dev/test-storage.js does the work) against
# a temporary folder from mktemp, deleted afterwards. Never touches the real
# notes folder or the workflow folder. Run from anywhere:
#
#   dev/test-storage.sh             everything
#   SKIP_TRASH=1 dev/test-storage.sh   without the Trash test
#   SKIP_VOLUME=1 dev/test-storage.sh  without moving notes to another volume
#
# The Trash test moves one note it created to the Trash through Finder (macOS
# asks for permission to control Finder the first time), then deletes just
# that file from the Trash. The volume test attaches a small disk image from
# the temporary folder, without showing it in Finder, and detaches it after.

setopt err_return pipe_fail no_unset
here=${0:A:h}
workflow=${here:h}
runner=$here/test-storage.js
tmp=$(mktemp -d "${${TMPDIR:-/tmp}%/}/scratchnstick-test.XXXXXX")
cleanup() {
  [[ -d $tmp/volume ]] && hdiutil detach -quiet -force "$tmp/volume" 2>/dev/null
  [[ $tmp == */scratchnstick-test.* ]] && chmod -R u+w "$tmp" && rm -rf -- "$tmp"
}
trap cleanup EXIT
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
  leftovers=$(ls -A "$conc/notes" "$conc/notes/.scratchnstick" | grep -c '^\.scratchnstick-save-' || true)
  if (( leftovers == 0 )); then ok "$round: no temporary files left"; else fail "$round: $leftovers temporary files left"; fi
done

print "\n# move.js and the move started by list.js"
mv=$tmp/movejs
mkdir -p "$mv/data/notes" "$mv/cache" "$mv/new"
print -rn "Moved by move.js" > "$mv/data/notes/a.md"
# The example notes count as added, so list.js lists only these notes.
print -r -- "{\"lastNotesFolder\": \"$mv/data/notes\", \"examplesInstalled\": \"2026-01-01T00:00:00+13:00\"}" > "$mv/data/state.json"
record() { plutil -extract lastNotesFolder raw -o - "$mv/data/state.json" }
movejs() { env alfred_workflow_data=$mv/data alfred_workflow_cache=$mv/cache "$workflow/scripts/move.js" "$@" }
expect() { if [[ $2 == "$3" ]]; then ok "$1"; else fail "$1: got '$2', expected '$3'"; fi }
movejs "$mv/data/notes" "$mv/new"
expect "the note moved" "$(cat "$mv/new/a.md" 2>&1)" "Moved by move.js"
expect "the record is the new folder" "$(record)" "$mv/new"
expect "the old default folder, left empty, is removed" "$([[ -e $mv/data/notes ]] && print kept || print removed)" "removed"
expect "the lock is released, and there's no failure" "$(ls -A "$mv/cache")" ""

mkdir -p "$mv/locked"; chmod 555 "$mv/locked"
print -rn "Can't move" > "$mv/new/b.md"
movejs "$mv/new" "$mv/locked"
expect "a failed move: its failure is recorded, naming the file" "$(grep -c '"error":"Can.t move [^"]*b.md' "$mv/cache/move-failure.json" 2>&1)" "1"
expect "…the record still names the old folder, and the lock is released" "$(record) $(ls -A "$mv/cache")" "$mv/new move-failure.json"
chmod 755 "$mv/locked"; rm -f "$mv/cache/move-failure.json"

mkdir "$mv/cache/move.lock"; print $$ > "$mv/cache/move.lock/pid"
movejs "$mv/new" "$mv/locked"
expect "a lock held by a live process: move.js does nothing" "$(ls -A "$mv/locked") $(record)" " $mv/new"
rm -rf "$mv/cache/move.lock"

listjs() { (cd "$tmp" && env alfred_workflow_data=$mv/data alfred_workflow_cache=$mv/cache notes_folder=$1 "$workflow/scripts/list.js" "") }
out=$(listjs "$mv/locked")
expect "list.js after a change of folder: Moving notes…, rerun" "$(print -r -- $out | grep -o '"rerun":0.5,"items":\[{"title":"Moving notes…"')" '"rerun":0.5,"items":[{"title":"Moving notes…"'
for i in {1..50}; do [[ $(record) == "$mv/locked" ]] && break; sleep 0.1; done
expect "…the move it started in the background finishes" "$(record) $(cd "$mv/locked" && print -r -- *)" "$mv/locked a.md b.md"
expect "…then list.js lists the notes" "$(listjs "$mv/locked" | grep -o '"title":"[^"]*"' | tr '\n' ' ')" '"title":"New note" "title":"Can'"'"'t move" "title":"Moved by move.js" '
expect "…and sweeps the sidecars, recording the day in the state, which keeps the record" "$(plutil -extract lastSidecarSweep raw -o - "$mv/data/state.json" | cut -c1-10) $(record)" "$(date +%F) $mv/locked"
expect "a missing notes folder: Missing notes folder" "$(listjs "$mv/missing" | grep -o '"title":"[^"]*","subtitle":"[^"]*"')" "\"title\":\"Missing notes folder\",\"subtitle\":\"$mv/missing\""

if [[ -n ${SKIP_VOLUME:-} ]]; then
  print "\n# Moving notes to another volume: skipped (SKIP_VOLUME)"
else
  hdiutil create -quiet -size 16m -fs APFS -volname ScratchnStickTest "$tmp/volume.dmg"
  hdiutil attach -quiet -nobrowse -mountpoint "$tmp/volume" "$tmp/volume.dmg"
  "$runner" move-volume "$tmp" "$tmp/volume" || (( failures++ )) || true
  hdiutil detach -quiet "$tmp/volume"
fi

if [[ -n ${SKIP_TRASH:-} ]]; then
  print "\n# Trash: skipped (SKIP_TRASH)"
else
  "$runner" trash "$tmp/trash" || (( failures++ )) || true
fi

print
if (( failures )); then print "FAILED: $failures failing step(s)"; exit 1; else print "All passed"; fi
