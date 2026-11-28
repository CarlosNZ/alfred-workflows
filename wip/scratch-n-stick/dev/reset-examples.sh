#!/bin/zsh
# Resets the example notes, so the next results list adds them again as on a
# first run, from examples/ as it is now:
#
#   dev/reset-examples.sh      reset
#   dev/reset-examples.sh -n   list what it would delete, and delete nothing
#
# It deletes, for every example (example-<n>-<name>, shipped or not):
#   - the note and its sidecar in the notes folder (any edits made in Alfred
#     go with them), and the files the examples show there (example-3-icon.svg);
#   - its quick and sticky bundles and window state in the workflow's cache;
#   - its sticky window's saved frame in Alfred UI's defaults, so its window
#     opens as a note stuck for the first time (only frames of this
#     workflow's bundles: the key ends in the SHA-1 of the bundle's path);
#   - `examplesInstalled` in the workflow's state.json.
#
# The notes folder is the one Alfred uses: `notes_folder` in prefs.plist, or
# notes/ in the workflow's data folder. Close the examples' sticky windows
# first, as a window saves its frame as it closes; it stops if any is open.
# Other notes, including ones named like example1.md, aren't touched.

setopt err_exit no_unset pipe_fail extended_glob null_glob

dry_run=0
[[ ${1:-} == -n ]] && dry_run=1

workflow=${0:A:h:h}
bundle_id=$(plutil -extract bundleid raw -o - "$workflow/info.plist")
data="$HOME/Library/Application Support/Alfred/Workflow Data/$bundle_id"
cache="$HOME/Library/Caches/com.runningwithcrayons.Alfred/Workflow Data/$bundle_id"
notes=$(plutil -extract notes_folder raw -o - "$workflow/prefs.plist" 2>/dev/null || true)
[[ -n $notes ]] && notes=${~notes} || notes="$data/notes"
defaults_domain=com.runningwithcrayons.Alfred-UI

open_windows=(${(fu)"$(ps -axww -o command= | grep -F "Alfred UI.app/" | grep -oE "$cache/windows/example-[0-9]+-[^ ]*\.alfredui" || true)"})
if (( $#open_windows )); then
  print -r -- "Close these examples' sticky windows first (⌘W):"
  for bundle in $open_windows; print -r -- "  ${bundle:t:r}"
  (( dry_run )) || exit 1
fi

# Deletes $2 (unless -n), listed by its path inside the folder $1.
remove() {
  print -r -- "  ${2#$1/}"
  (( dry_run )) || rm -rf -- "$2"
}

print -r -- "Notes, their files and sidecars in ${notes/#$HOME/~}:"
for file in "$notes"/example-<->-*(.) "$notes"/.scratchnstick/example-<->-*.json; remove "$notes" "$file"

print -r -- "Bundles and window states in ${cache/#$HOME/~}:"
for file in "$cache"/(quick|windows)/example-<->-*.alfredui "$cache"/state/example-<->-*; remove "$cache" "$file"

print -r -- "Saved frames in $defaults_domain:"
keys=(${(f)"$(defaults read $defaults_domain 2>/dev/null | grep -oE 'NSWindow Frame example-[0-9]+-[A-Za-z0-9_-]+-[0-9a-f]{40}' || true)"})
for key in $keys; do
  name=${${key#NSWindow Frame }%-*}
  hash=$(print -rn -- "$cache/windows/$name.alfredui" | shasum -a 1 | cut -d' ' -f1)
  [[ $key == *-$hash ]] || continue
  print -r -- "  $key"
  (( dry_run )) || defaults delete $defaults_domain "$key"
done

print -r -- "examplesInstalled in state.json"
if (( ! dry_run )) && [[ -e $data/state.json ]]; then
  plutil -remove examplesInstalled "$data/state.json" >/dev/null 2>&1 || true
fi

(( dry_run )) && print -r -- "(Nothing deleted: -n)" || print -r -- "Done. The next results list adds the examples again."
