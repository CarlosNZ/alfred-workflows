#!/usr/bin/osascript -l JavaScript

// Fetches a picture of each city given into the cache (see lib/pictures.js),
// one city at a time, to go easy on Wikimedia. Run by fetch-pictures.zsh;
// argv[0] is the cities as JSON (see pictureFetchRecord). Its log is the cache
// folder's pictures.log.
//
// It runs in one of two ways:
// - The fetcher, for every city missing a picture, started by results.js.
//   fetch-pictures.zsh holds the lock, so only one runs at a time, and its
//   requests are REQUEST_INTERVAL_SECONDS apart.
// - For one city whose detail view has just opened (argv[1] "view"), started
//   by panel.zsh, so its picture arrives within seconds rather than when the
//   fetcher gets to it. It runs alongside the fetcher, without the lock, and
//   sends its few requests without a pause. If the fetcher reaches the same
//   city meanwhile, both fetch it; the picture is moved into place whole, so
//   the second just replaces the first. It doesn't run while .backoff is
//   waiting.
//
// For each city:
// 1. Match it to its Wikidata item: among the search results for its name
//    whose coordinates are within MATCH_RADIUS_KM of Clock's, the first
//    named exactly that (by label or alias), or failing that the first. The
//    name rules out Auckland Region, whose centre is near Auckland's; search
//    order puts New York City (alias "New York") before the New York Stock
//    Exchange; the distance rules out New York State.
// 2. Take the item's image (P18), or failing that, its English Wikipedia
//    article's page image, which is sometimes the nicer picture.
// 3. Download a PICTURE_WIDTH thumbnail of it from Commons, convert it to JPEG
//    with sips, and move it into place, so a reader never sees half a file.
//
// No item or no image: the city gets a .none marker and isn't tried again.
// A failure particular to the city gets a .failed marker, retried later. A
// network failure (no connection, a timeout, or Wikimedia answering 429 or
// 5xx) would fail the next city too, so it stops the run and sets .backoff.

ObjC.import("Foundation");

const LIBS = ["lib/cities.js", "lib/pictures.js"];

// The pictures' width in pixels. TO-DO: set it from the picture's size in the
// detail view, once that's designed.
const PICTURE_WIDTH = 960;
// Retry delays, in seconds, for .backoff and .failed: the first, doubling with
// each failure up to the most.
const RETRY_DELAY_FIRST = 5 * 60;
const RETRY_DELAY_MOST = 24 * 60 * 60;
// Wikimedia's User-Agent policy asks for a way to get in touch. TO-DO: use the
// workflow's Alfred forum or gallery URL in place of the repo once it has one.
const USER_AGENT = "WorldClockCities/%VERSION% (Alfred workflow; https://github.com/CarlosNZ/alfred-workflows)";

const MATCH_RADIUS_KM = 50;
const SEARCH_LIMIT = 10;
const REQUEST_TIMEOUT_SECONDS = 20;
// Wikimedia rate-limits clients that send requests in quick succession,
// answering 429 with a Retry-After of a few seconds. Requests are spaced out,
// and a short Retry-After is waited out rather than treated as a network
// failure.
const REQUEST_INTERVAL_SECONDS = 2;
// Temporary files older than this are left over from a fetch that was
// stopped. A fetch can't take this long, since each request times out.
const STALE_TEMPORARY_MINUTES = 10;
const RATE_LIMIT_MOST_WAIT_SECONDS = 60;
const RATE_LIMIT_RETRIES = 2;
const JPEG_QUALITY = 80;

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

// Stops the run and sets .backoff. retryAfter is the reply's Retry-After, in
// seconds, if it had one, and status its HTTP status, if it had one.
class NetworkError extends Error {
  constructor(message, retryAfter = 0, status = null) {
    super(message);
    this.retryAfter = retryAfter;
    this.status = status;
  }
}

// Fails this city alone, which gets a .failed marker.
class CityError extends Error {}

function run(argv) {
  const workflowDir = $.NSURL.fileURLWithPath(scriptPath()).URLByResolvingSymlinksInPath.URLByDeletingLastPathComponent.path.js;
  $.NSFileManager.defaultManager.changeCurrentDirectoryPath(workflowDir);
  LIBS.forEach(loadLib);

  const cities = JSON.parse(argv[0] || "[]");
  const forView = argv[1] === "view";
  const dir = picturesDir();
  removeTemporaryFiles(dir, { staleOnly: true });

  if (forView) {
    if (modificationTime(`${dir}/.backoff`) > Date.now()) return;
    requestInterval = 0;
    log(`${new Date().toISOString()}: ${cities.map((city) => `${city.slug} ${city.name}`).join(", ")}, for its detail view`);
  } else {
    log(`${new Date().toISOString()}: ${cities.length} to fetch`);
  }
  try {
    // The fetcher's .lock, to check it's still there; a fetch for a view has
    // no lock, so it checks the cache folder instead.
    fetchPictures(cities, dir, forView ? null : fileNumber(`${dir}/.lock`));
  } finally {
    removeTemporaryFiles(dir);
  }
}

function fetchPictures(cities, dir, lock) {
  for (const city of cities) {
    // The cache is deleted when the setting is turned off. A new .lock means it
    // was deleted and made again, and another fetcher may hold that one.
    const cacheGone = lock == null ? !$.NSFileManager.defaultManager.fileExistsAtPath(dir) : fileNumber(`${dir}/.lock`) !== lock;
    if (cacheGone) return log("The cache was deleted; stopping");
    // Another fetch may have done it since this one was started.
    if (isSettled(dir, city.slug)) continue;
    try {
      fetchCityPicture(city, dir);
    } catch (error) {
      if (error instanceof NetworkError) {
        const retryIn = recordRetry(`${dir}/.backoff`, error.retryAfter);
        return log(`${city.slug} ${city.name}: ${error.message}; stopping, next try in ${retryIn / 60}m`);
      }
      const retryIn = recordRetry(`${dir}/${city.slug}.failed`);
      log(`${city.slug} ${city.name}: failed (${error.message}); retry in ${retryIn / 60}m`);
    }
  }
  log("Done");
}

function fetchCityPicture(city, dir) {
  const label = `${city.slug} ${city.name}`;
  const item = matchWikidataItem(city);
  if (!item.id) return recordNone(dir, city, item.reason);

  let source = "Wikidata image (P18)";
  let file = item.image;
  if (!file) {
    source = "English Wikipedia page image";
    file = wikipediaPageImage(item.id);
  }
  if (!file) return recordNone(dir, city, `${item.id} has no image, and no Wikipedia page image`);

  const info = commonsImageInfo(file);
  if (!info) return recordNone(dir, city, `${file} isn't on Commons`);

  const download = `${dir}/${temporaryName(city.slug)}`;
  const converted = `${download}.jpg`;
  request(info.thumburl || info.url, download);
  const resample = (info.thumbwidth || info.width) > PICTURE_WIDTH ? ["--resampleWidth", String(PICTURE_WIDTH)] : [];
  const sips = runTask("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(JPEG_QUALITY), ...resample, download, "--out", converted]);
  if (sips.status !== 0) throw new CityError(`sips: ${sips.error.trim()}`);

  const meta = info.extmetadata || {};
  writeText(
    `${dir}/${city.slug}.json`,
    JSON.stringify(
      {
        city: city.name,
        country: city.country,
        wikidata: `https://www.wikidata.org/wiki/${item.id}`,
        wikidataLabel: item.label,
        distanceKm: Math.round(item.distanceKm * 10) / 10,
        source,
        file: info.descriptionurl,
        artist: plainText(meta.Artist && meta.Artist.value),
        licence: plainText(meta.LicenseShortName && meta.LicenseShortName.value),
        licenceUrl: (meta.LicenseUrl && meta.LicenseUrl.value) || null,
        fetched: new Date().toISOString(),
      },
      null,
      2
    )
  );
  moveFile(converted, `${dir}/${city.slug}.jpg`);
  removeFile(download);
  removeFile(`${dir}/${city.slug}.failed`);
  log(`${label}: ${item.id} (${item.label}, ${item.distanceKm.toFixed(1)} km), ${source}: ${file}`);
}

// The city's Wikidata item, as { id, label, distanceKm, image }, where image is
// its P18 file name, or null. { reason } when no search result is close enough.
// Of the results close enough, the first whose label or matched alias is the
// city's name wins, otherwise the first.
// One request for the search (which gives the order) and one for the results'
// coordinates and images (which Wikidata's page image takes from P18).
function matchWikidataItem(city) {
  const search = requestJson(WIKIDATA_API, {
    action: "wbsearchentities",
    search: city.name,
    language: "en",
    uselang: "en",
    type: "item",
    limit: SEARCH_LIMIT,
  }).search;
  if (!search || search.length === 0) return { reason: `no Wikidata item named “${city.name}”` };

  const pages = requestJson(WIKIDATA_API, {
    action: "query",
    titles: search.map((result) => result.id).join("|"),
    prop: "coordinates|pageimages",
    piprop: "name",
    pilicense: "any",
    colimit: "max",
    pilimit: "max",
  }).query.pages;
  const byId = Object.fromEntries(pages.map((page) => [page.title, page]));

  const close = [];
  let nearest = null;
  for (const result of search) {
    const page = byId[result.id];
    const coordinates = page && page.coordinates && (page.coordinates.find((c) => c.primary) || page.coordinates[0]);
    if (!coordinates || (coordinates.globe && coordinates.globe !== "earth")) continue;
    const distanceKm = haversineKm(city.latitude, city.longitude, coordinates.lat, coordinates.lon);
    if (distanceKm <= MATCH_RADIUS_KM) close.push({ id: result.id, label: result.label, distanceKm, image: page.pageimage || null, result });
    if (!nearest || distanceKm < nearest.distanceKm) nearest = { id: result.id, distanceKm };
  }
  const name = foldText(city.name);
  const named = close.find(({ result }) => [result.label, result.match && result.match.text].some((text) => foldText(text) === name));
  const chosen = named || close[0];
  if (chosen) {
    const { result, ...item } = chosen;
    return item;
  }
  const closest = nearest ? `; nearest ${nearest.id}, ${Math.round(nearest.distanceKm)} km` : "";
  return { reason: `no Wikidata item named “${city.name}” within ${MATCH_RADIUS_KM} km${closest}` };
}

// The page image (lead image) of the item's English Wikipedia article, or null.
// Only free images, the API's default.
function wikipediaPageImage(id) {
  const entity = requestJson(WIKIDATA_API, { action: "wbgetentities", ids: id, props: "sitelinks", sitefilter: "enwiki" })
    .entities[id];
  const title = entity && entity.sitelinks && entity.sitelinks.enwiki && entity.sitelinks.enwiki.title;
  if (!title) return null;
  const pages = requestJson(WIKIPEDIA_API, { action: "query", titles: title, redirects: 1, prop: "pageimages", piprop: "name" })
    .query.pages;
  return (pages && pages[0] && pages[0].pageimage) || null;
}

// A Commons file's imageinfo, with a PICTURE_WIDTH thumbnail and its artist
// and licence, or null if Commons doesn't have the file.
function commonsImageInfo(file) {
  const pages = requestJson(COMMONS_API, {
    action: "query",
    titles: `File:${file}`,
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: PICTURE_WIDTH,
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl",
  }).query.pages;
  return (pages && pages[0] && pages[0].imageinfo && pages[0].imageinfo[0]) || null;
}

// A Wikimedia API request, with the format parameters added, parsed.
function requestJson(api, params) {
  const query = Object.entries({ ...params, format: "json", formatversion: 2 })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  const text = request(`${api}?${query}`);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CityError(`unreadable reply from ${api}`);
  }
}

// Requests a URL with curl, saving the body to `out`, or returning it as text
// without one. A 429 with a short Retry-After is waited out and retried, up to
// RATE_LIMIT_RETRIES times. Throws NetworkError when it can't reach Wikimedia or Wikimedia
// is busy or failing, and CityError for any other reply but 200. The first
// request that succeeds clears .backoff.
function request(url, out) {
  for (let retries = 0; ; retries++) {
    try {
      return requestOnce(url, out);
    } catch (error) {
      const wait = error.retryAfter || 10;
      if (!(error instanceof NetworkError) || error.status !== 429 || retries >= RATE_LIMIT_RETRIES || wait > RATE_LIMIT_MOST_WAIT_SECONDS) {
        throw error;
      }
      log(`  rate-limited; waiting ${wait}s`);
      delay(wait);
    }
  }
}

let lastRequestTime = 0;
let requestInterval = REQUEST_INTERVAL_SECONDS;

// One request, spaced requestInterval seconds after the one before.
function requestOnce(url, out) {
  const wait = lastRequestTime + requestInterval * 1000 - Date.now();
  if (wait > 0) delay(wait / 1000);
  lastRequestTime = Date.now();
  const dir = picturesDir();
  const body = out || `${dir}/${temporaryName("body")}`;
  const headers = `${dir}/${temporaryName("headers")}`;
  const userAgent = USER_AGENT.replace("%VERSION%", environmentValue("alfred_workflow_version") || "dev");
  const curl = runTask("/usr/bin/curl", [
    "-sS",
    "-L",
    "--max-time",
    String(REQUEST_TIMEOUT_SECONDS),
    "-A",
    userAgent,
    "-D",
    headers,
    "-o",
    body,
    "-w",
    "%{http_code}",
    url,
  ]);
  if (curl.status !== 0) throw new NetworkError(curl.error.trim() || `curl exit ${curl.status}`);
  const code = Number(curl.output);
  if (code === 429 || code >= 500) throw new NetworkError(`HTTP ${code}`, retryAfterSeconds(readText(headers)), code);
  removeFile(`${dir}/.backoff`);
  if (code !== 200) throw new CityError(`HTTP ${code} for ${url}`);
  if (out) return null;
  const text = readText(body);
  removeFile(body);
  return text;
}

// The last Retry-After in the response headers, in seconds: a number of
// seconds or an HTTP date. 0 if there's none.
function retryAfterSeconds(headers) {
  const matches = [...(headers || "").matchAll(/^retry-after:\s*(.+?)\s*$/gim)];
  if (matches.length === 0) return 0;
  const value = matches[matches.length - 1][1];
  if (/^\d+$/.test(value)) return Number(value);
  const date = Date.parse(value);
  return isNaN(date) ? 0 : Math.max(0, Math.round((date - Date.now()) / 1000));
}

// Records a failure in a retry file (.backoff, or a city's .failed): it holds
// the delay, RETRY_DELAY_FIRST then doubling up to RETRY_DELAY_MOST (or the
// server's Retry-After, when longer), and its modification time is when to try
// again. Returns the delay, in seconds.
function recordRetry(path, retryAfter = 0) {
  const previous = Number(readText(path)) || 0;
  const doubled = previous ? Math.min(previous * 2, RETRY_DELAY_MOST) : RETRY_DELAY_FIRST;
  const seconds = Math.max(doubled, retryAfter);
  writeText(path, String(seconds));
  setModificationTime(path, Date.now() + seconds * 1000);
  return seconds;
}

function recordNone(dir, city, reason) {
  writeText(`${dir}/${city.slug}.none`, reason);
  removeFile(`${dir}/${city.slug}.failed`);
  log(`${city.slug} ${city.name}: none (${reason})`);
}

// Whether a city has its picture, has none, or isn't due for a retry.
function isSettled(dir, slug) {
  const fm = $.NSFileManager.defaultManager;
  return (
    fm.fileExistsAtPath(`${dir}/${slug}.jpg`) ||
    fm.fileExistsAtPath(`${dir}/${slug}.none`) ||
    modificationTime(`${dir}/${slug}.failed`) > Date.now()
  );
}

// Great-circle distance in km between two points given in degrees.
function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Commons metadata values are HTML; this keeps their text.
function plainText(html) {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

// Runs a program without a shell and waits for it: { status, output, error }.
function runTask(path, args) {
  const task = $.NSTask.alloc.init;
  const output = $.NSPipe.pipe;
  const error = $.NSPipe.pipe;
  task.launchPath = path;
  task.arguments = $(args);
  task.standardInput = $.NSFileHandle.fileHandleWithNullDevice;
  task.standardOutput = output;
  task.standardError = error;
  task.launch;
  const read = (pipe) =>
    $.NSString.alloc.initWithDataEncoding(pipe.fileHandleForReading.readDataToEndOfFile, $.NSUTF8StringEncoding).js || "";
  // Read before waiting, so a full pipe can't stall the program.
  const out = read(output);
  const err = read(error);
  task.waitUntilExit;
  return { status: task.terminationStatus, output: out, error: err };
}

function readText(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  return text.isNil() ? null : text.js;
}

function writeText(path, text) {
  $(text).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
}

// A temporary file's name in the cache folder. It includes the process ID,
// since a fetch for a view can run alongside the fetcher.
function temporaryName(name) {
  return `.tmp-${$.NSProcessInfo.processInfo.processIdentifier}-${name}`;
}

// Deletes this process's temporary files, or with staleOnly, any process's
// that are older than STALE_TEMPORARY_MINUTES: left over from a fetch that was
// stopped, and not in use by one running now.
function removeTemporaryFiles(dir, { staleOnly = false } = {}) {
  const own = temporaryName("");
  const staleBefore = Date.now() - STALE_TEMPORARY_MINUTES * 60 * 1000;
  for (const name of directoryNames(dir)) {
    if (!name.startsWith(".tmp-")) continue;
    if (staleOnly ? modificationTime(`${dir}/${name}`) < staleBefore : name.startsWith(own)) removeFile(`${dir}/${name}`);
  }
}

function removeFile(path) {
  $.NSFileManager.defaultManager.removeItemAtPathError(path, null);
}

// rename(2) through mv, so the file appears whole, replacing any already there.
function moveFile(from, to) {
  const mv = runTask("/bin/mv", ["-f", from, to]);
  if (mv.status !== 0) throw new CityError(`mv: ${mv.error.trim()}`);
}

function setModificationTime(path, milliseconds) {
  const date = $.NSDate.dateWithTimeIntervalSince1970(milliseconds / 1000);
  $.NSFileManager.defaultManager.setAttributesOfItemAtPathError(
    $.NSDictionary.dictionaryWithObjectForKey(date, $.NSFileModificationDate),
    path,
    null
  );
}

// A file's inode number, or null if it doesn't exist.
function fileNumber(path) {
  const attributes = $.NSFileManager.defaultManager.attributesOfItemAtPathError(path, null);
  return attributes.isNil() ? null : ObjC.unwrap(attributes.objectForKey($.NSFileSystemFileNumber));
}

function log(message) {
  console.log(message);
}

// This script's path as run: osascript's arguments are its own path, "-l",
// "JavaScript", then the script's path.
function scriptPath() {
  return ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments)[3];
}

// Runs a file from lib/ in the global scope, as results.js does (see loadLib
// there).
function loadLib(file) {
  const source = $.NSString.stringWithContentsOfFileEncodingError(file, $.NSUTF8StringEncoding, null);
  if (source.isNil()) throw new Error(`Can't load ${file}`);
  (0, eval)(source.js);
}
