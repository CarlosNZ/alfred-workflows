#!/bin/zsh -f
# A closed sticky window's forget timer: forget.sh "<closed> <seconds> <state>"
#
# One argument, as the `forget` External Trigger passes it: the window's
# `quit` (keepClosedNoteState in lib.js) keeps the window's state file
# <state> with `closed` set to <closed>, and has Alfred run this. After
# <seconds> (CLOSE_GRACE_SECONDS) it deletes that file, if it still has that
# `closed`: a note opened again since has a new state, which is left alone.
# If the session ends first (a restart, shutdown or logout), this is killed
# with everything else and the state stays, so the note can be reopened (see
# "Reopening sticky notes" in lib.js). noteWindowStates tells that this is
# still running from its command line (runningForgetTimers), so it must keep
# this name and its argument.

read -r closed seconds state_path <<< "$1"
[[ -n $state_path && $closed == <-> && $seconds == <-> ]] || exit 1
# zselect waits within this process (its -t is in hundredths of a second), so
# a timer is one process, and killing it leaves nothing behind.
zmodload zsh/zselect
zselect -t $(( seconds * 100 ))
state=$(<$state_path) 2>/dev/null || exit 0
[[ $state == *\"closed\":${closed}[,\}]* ]] && rm -f -- $state_path
exit 0
