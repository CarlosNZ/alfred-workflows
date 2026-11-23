#!/bin/zsh -f
# Fetches pictures for the detail view into the cache (see lib/pictures.js),
# one fetcher at a time. Started in the background by results.js, with $1 the
# cities that need one, as JSON (see startPictureFetcher).
#
# With --view, $2 is one city whose detail view has just opened, as JSON:
# panel.zsh starts this so its picture arrives straight away, alongside any
# fetcher already running and without the lock (see fetch-pictures.js).
#
# Otherwise, this script is here for its lock: JXA can't call flock(2), and a
# lock made of a file or folder (NSDistributedLock, mkdir) is left behind if
# its holder crashes. The kernel releases this one when the process exits,
# however it exits. If another fetcher holds it, this one exits at once; the running one
# keeps going, and results.js starts another later for any city still missing.
# The lock is held while fetch-pictures.js runs, as a child of this process.

emulate -L zsh
zmodload zsh/system

cache=${alfred_workflow_cache:-$HOME/Library/Caches/net.smithnz.carl.worldclockcities}
images=$cache/images
log=$cache/pictures.log
mkdir -p $images

if [[ $1 == --view ]]; then
  osascript -l JavaScript ${0:A:h}/fetch-pictures.js "[$2]" view >> $log 2>&1
  exit
fi

lock=$images/.lock
# flock needs the file to exist; this creates it, or leaves it as it is.
: >> $lock
zsystem flock -t 0 $lock 2>/dev/null || exit 0

# Only once the lock is held, so a fetcher that's refused leaves the running
# one's log alone. Emptied, then appended to, so lines from a fetch for a view
# running alongside land after this fetcher's rather than over them.
: > $log
exec >> $log 2>&1
osascript -l JavaScript ${0:A:h}/fetch-pictures.js "$1"
