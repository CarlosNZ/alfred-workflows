// The cache of city pictures for the detail view, in images/ in the
// workflow's cache folder. results.js keeps it in step with Clock's list and
// starts the fetcher (fetch-pictures.zsh, which runs fetch-pictures.js) when a
// city has no picture yet; the fetcher fills it. Uses environmentValue and
// citySlug from lib/cities.js; needs Foundation imported.
//
// Files, named after the city's slug (citySlug):
//   <slug>.jpg     the picture, 960px wide (or the original's width when
//                  that's smaller)
//   <slug>.json    where the picture came from: Wikidata item, Commons file,
//                  artist and licence
//   <slug>.none    no picture found, holding the reason; never retried
//   <slug>.failed  a failure particular to the city, retried at the file's
//                  modification time; it holds the current delay in seconds
//   .backoff       a network failure: nothing is fetched until the file's
//                  modification time; it holds the current delay in seconds
//   .lock          held by the running fetcher (see fetch-pictures.zsh)
//   .tmp-*         the fetcher's temporary files

const BUNDLE_ID = "net.smithnz.carl.worldclockcities";

// The workflow's cache folder: Alfred's, or the same fallback as panel.zsh
// outside Alfred.
function workflowCacheDir() {
  return environmentValue("alfred_workflow_cache") || $(`~/Library/Caches/${BUNDLE_ID}`).stringByExpandingTildeInPath.js;
}

function picturesDir() {
  return `${workflowCacheDir()}/images`;
}

// The fetcher's log, rewritten by each fetcher that runs (see
// fetch-pictures.zsh).
function picturesLog() {
  return `${workflowCacheDir()}/pictures.log`;
}

// The "Download city thumbnails" setting, a User Configuration checkbox ("1"
// or "0"). On unless it's off, so it's on when running outside Alfred.
function picturesEnabled() {
  return environmentValue("download_thumbnails") !== "0";
}

// Brings the cache in step with Clock's list, and starts the fetcher if a city
// needs a picture. `cities` is Clock's whole list, never one narrowed by the
// query, and never empty, so a list that fails to load doesn't empty the cache.
// Errors are logged rather than thrown: the cache never stops the results.
function updatePictureCache(cities) {
  try {
    const dir = picturesDir();
    const fm = $.NSFileManager.defaultManager;
    // Turned off: delete the pictures and the fetcher's log. Open detail views
    // find out this way, and a fetcher already running stops at its next city.
    if (!picturesEnabled()) {
      for (const path of [dir, picturesLog()]) if (fm.fileExistsAtPath(path)) fm.removeItemAtPathError(path, null);
      return;
    }

    const files = directoryNames(dir);
    const slugs = new Set(cities.map(citySlug));
    for (const name of files) {
      if (!name.startsWith(".") && !slugs.has(slugOfFile(name))) fm.removeItemAtPathError(`${dir}/${name}`, null);
    }

    const now = Date.now();
    if (files.includes(".backoff") && modificationTime(`${dir}/.backoff`) > now) return;

    const settled = new Set(
      files
        .filter((name) => /\.(jpg|none)$/.test(name) || (name.endsWith(".failed") && modificationTime(`${dir}/${name}`) > now))
        .map(slugOfFile)
    );
    const missing = cities.filter((city) => !settled.has(citySlug(city)));
    if (missing.length > 0) startPictureFetcher(missing);
  } catch (error) {
    console.log(`City pictures: ${error}`);
  }
}

// What the fetcher needs to know about a city, from its Clock record, so it
// never reads Clock's list itself (which needs Full Disk Access). Its name is
// unlocalized, for searching Wikidata in English.
function pictureFetchRecord(city) {
  return {
    slug: citySlug(city),
    name: city.unlocalizedName || city.name,
    country: city.unlocalizedCountryName || city.countryName || null,
    latitude: Number(city.latitude),
    longitude: Number(city.longitude),
  };
}

// Starts the fetcher in the background for these cities, passing their
// records as JSON. Run without a shell, so city names can't be read as
// commands, and without waiting for it. If a fetcher is already running, the
// new one exits at once (see fetch-pictures.zsh).
function startPictureFetcher(cities) {
  const records = cities.map(pictureFetchRecord);
  const workflowDir = $.NSFileManager.defaultManager.currentDirectoryPath.js;
  const task = $.NSTask.alloc.init;
  task.launchPath = `${workflowDir}/fetch-pictures.zsh`;
  task.arguments = $([JSON.stringify(records)]);
  task.currentDirectoryPath = workflowDir;
  task.standardInput = $.NSFileHandle.fileHandleWithNullDevice;
  task.standardOutput = $.NSFileHandle.fileHandleWithNullDevice;
  task.standardError = $.NSFileHandle.fileHandleWithNullDevice;
  task.launch;
}

// Whether a city's picture can be shown, for the detail view, from the cache
// in `dir`: { state: "shown", path } when it's there; "loading" while a fetch
// can still bring it; "none" when there's no picture to find, the city's
// fetch failed or the whole cache is backing off (it's not coming soon), or
// the cache is gone because the setting is off. panel.zsh makes the same
// call, in zsh, when the view opens, to decide whether it has a picture slot.
function pictureState(dir, slug) {
  const fm = $.NSFileManager.defaultManager;
  const path = `${dir}/${slug}.jpg`;
  if (fm.fileExistsAtPath(path)) return { state: "shown", path };
  if (!fm.fileExistsAtPath(dir) || fm.fileExistsAtPath(`${dir}/${slug}.none`)) return { state: "none" };
  const now = Date.now();
  const waiting = [".backoff", `${slug}.failed`].some((name) => modificationTime(`${dir}/${name}`) > now);
  return { state: waiting ? "none" : "loading" };
}

// The slug a cache file belongs to: its name up to the first dot.
function slugOfFile(name) {
  return name.split(".")[0];
}

// The names in a folder, or [] if it doesn't exist.
function directoryNames(dir) {
  return ObjC.deepUnwrap($.NSFileManager.defaultManager.contentsOfDirectoryAtPathError(dir, null)) || [];
}

// A file's modification time in milliseconds, or 0 if it doesn't exist.
function modificationTime(path) {
  const attributes = $.NSFileManager.defaultManager.attributesOfItemAtPathError(path, null);
  if (attributes.isNil()) return 0;
  return attributes.objectForKey($.NSFileModificationDate).timeIntervalSince1970 * 1000;
}
