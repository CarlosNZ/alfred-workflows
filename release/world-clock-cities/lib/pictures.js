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
//   .overrides.json  the custom picture of each city that has one, by slug,
//                  as the cached pictures were made from them
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

    updateOverrides(dir, cities);
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
// unlocalized, for searching Wikidata in English. `override` is its custom
// picture (pictureOverride), if it has one.
function pictureFetchRecord(city) {
  const record = {
    slug: citySlug(city),
    name: city.unlocalizedName || city.name,
    country: city.unlocalizedCountryName || city.countryName || null,
    latitude: Number(city.latitude),
    longitude: Number(city.longitude),
  };
  const override = pictureOverride(city);
  if (override) record.override = override;
  return record;
}

// The "Custom pictures" setting (`picture_overrides`), a User Configuration
// text area: one city per line, as "City: URL", split at the first colon. The
// city is its name in Clock, in any case and with or without accents. Blank
// lines, lines starting with #, and lines that don't parse are ignored; a later
// line for the same city wins. Read once per run, as a Map from the folded
// city name to the picture (parsePictureSource).
let parsedOverrides = null;

function pictureOverrides() {
  if (parsedOverrides) return parsedOverrides;
  parsedOverrides = new Map();
  for (const raw of (environmentValue("picture_overrides") || "").split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const name = foldText(line.slice(0, colon).trim());
    const source = parsePictureSource(line.slice(colon + 1).trim());
    if (name && source) parsedOverrides.set(name, source);
  }
  return parsedOverrides;
}

// A city's custom picture, or null, matched by its name or unlocalized name.
function pictureOverride(city) {
  const overrides = pictureOverrides();
  return overrides.get(foldText(city.name)) || overrides.get(foldText(city.unlocalizedName)) || null;
}

// Where a custom picture comes from, read from the URL given for it, or null
// if it isn't one:
// - { commons: "<file name>" } for a Wikimedia Commons file, from its file page
//   (commons.wikimedia.org/wiki/File:…), a Wikipedia page showing it
//   (…/wiki/City#/media/File:…), its address on upload.wikimedia.org, or
//   "File:…" alone. Fetched through Commons, so it comes with its artist and
//   licence.
// - { url } for any other http or https URL, downloaded as it is.
// - { path } for a file:// URL, or a path starting with / or ~.
function parsePictureSource(value) {
  if (!value) return null;
  if (/^file:[^/]/i.test(value)) return { commons: value.slice(5).trim() };
  if (/^file:\/\//i.test(value)) {
    const path = $.NSURL.URLWithString(value).path;
    return path.isNil() || !path.js ? null : { path: path.js };
  }
  if (/^[/~]/.test(value)) return { path: $(value).stringByExpandingTildeInPath.js };

  const url = value.match(/^https?:\/\/([^/?#]+)([^?#]*)(?:\?[^#]*)?(#.*)?$/i);
  if (!url) return null;
  const [, host, path, fragment] = url;
  const decode = (text) => {
    try {
      return decodeURIComponent(text);
    } catch (error) {
      return text;
    }
  };
  if (/(^|\.)(wikipedia|wikimedia)\.org$/i.test(host)) {
    const page = decode(`${path}${fragment || ""}`).match(/(?:^|[/:])File:([^/?#]+)$/);
    if (page) return { commons: page[1] };
    const upload = path.match(/^\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/i);
    if (/^upload\.wikimedia\.org$/i.test(host) && upload) return { commons: decode(upload[1]) };
  }
  return { url: value };
}

// Keeps .overrides.json in step with the setting: a city whose custom picture
// was added, changed or removed loses its cached files, so it's fetched again.
// Written only when it changes.
function updateOverrides(dir, cities) {
  const current = {};
  for (const city of cities) {
    const override = pictureOverride(city);
    if (override) current[citySlug(city)] = override;
  }
  const previous = recordedOverrides(dir);
  if (JSON.stringify(previous) === JSON.stringify(current)) return;

  const fm = $.NSFileManager.defaultManager;
  for (const slug of new Set([...Object.keys(previous), ...Object.keys(current)])) {
    if (JSON.stringify(previous[slug]) === JSON.stringify(current[slug])) continue;
    for (const ext of ["jpg", "json", "none", "failed"]) fm.removeItemAtPathError(`${dir}/${slug}.${ext}`, null);
  }
  fm.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir, true, $(), null);
  $(JSON.stringify(current)).writeToFileAtomicallyEncodingError(`${dir}/.overrides.json`, true, $.NSUTF8StringEncoding, null);
}

// The custom pictures, by slug, that the cache was made from.
function recordedOverrides(dir) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(`${dir}/.overrides.json`, $.NSUTF8StringEncoding, null);
  try {
    return text.isNil() ? {} : JSON.parse(text.js) || {};
  } catch (error) {
    return {};
  }
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

// A city's <slug>.json in `dir`, where its picture came from (see
// fetch-pictures.js), or null if there's none.
function pictureDetails(dir, slug) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(`${dir}/${slug}.json`, $.NSUTF8StringEncoding, null);
  if (text.isNil()) return null;
  try {
    return JSON.parse(text.js);
  } catch (error) {
    return null;
  }
}

// What clicking a city's picture does, from its <slug>.json: { url } to open
// the Commons file's page, which credits the picture in full, or a custom
// picture's URL; { reveal } to show a custom picture's file in Finder. Null
// when there's nothing to do.
function pictureClick(details) {
  if (!details) return null;
  if (details.file || details.url) return { url: details.file || details.url };
  return details.path ? { reveal: details.path } : null;
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
