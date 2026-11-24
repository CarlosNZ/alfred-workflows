#!/usr/bin/osascript -l JavaScript

// Fetches a picture of each city given into the cache (see lib/pictures.js),
// one city at a time, to go easy on Wikimedia. Run by fetch-pictures.zsh;
// argv[0] is the cities as JSON (see pictureFetchRecord). Its log is the cache
// folder's pictures.log.
//
// It runs in one of two ways:
// - The fetcher, for every city missing a picture, started by results.js.
//   fetch-pictures.zsh holds the lock, so only one runs at a time, and its
//   requests to each host are REQUEST_INTERVAL_SECONDS apart.
// - For one city whose detail view has just opened (argv[1] "view"), started
//   by panel.zsh, so its picture arrives within seconds rather than when the
//   fetcher gets to it. It runs alongside the fetcher, without the lock, and
//   sends its few requests without a pause. If the fetcher reaches the same
//   city meanwhile, both fetch it; the picture is moved into place whole, so
//   the second just replaces the first. It doesn't run while .backoff is
//   waiting.
//
// A city with a custom picture (the record's `override`, from the "Custom
// pictures" setting; see parsePictureSource in lib/pictures.js) gets that
// picture: a Commons file through Commons' API, any other URL downloaded as it
// is, or a local file. If the picture can't be had (no such file or page, or
// not an image), the city gets one found as below; a failure that might pass
// (no connection, or the server busy or failing) is retried later.
//
// For each other city:
// 1. Match it to its English Wikipedia article, with one search: of the
//    results whose coordinates are within MATCH_RADIUS_KM of Clock's, the
//    first titled with its name (as "Phoenix, Arizona" is), or failing that
//    the first. The search ranks the city's own article first ("New York"
//    finds New York City), and the distance rules out namesakes elsewhere.
// 2. Take the article's page image (its lead image), which editors choose to
//    stand for the city, so it's usually its best-known sight (the Opera House
//    for Sydney). Failing that, or when it's a flag or map rather than a
//    photograph (as for a city that's also a country), take the image (P18)
//    of the article's Wikidata item.
// 3. Download a PICTURE_WIDTH thumbnail of it from Commons, convert it to JPEG
//    with sips, and move it into place, so a reader never sees half a file.
//
// No article or no image: the city gets a .none marker and isn't tried again.
// A failure particular to the city gets a .failed marker, retried later. A
// network failure (no connection, a timeout, or Wikimedia answering 429 or
// 5xx) would fail the next city too, so it stops the run and sets .backoff.

ObjC.import("Foundation");

const LIBS = ["lib/cities.js", "lib/pictures.js"];

// The pictures' width in pixels: twice the detail view's slot at 2x (210pt,
// PICTURE_SIZE in lib/panel.js), leaving room to crop a wide picture to fill
// it, and one of the standard thumbnail widths Wikimedia serves.
const PICTURE_WIDTH = 960;
// Retry delays, in seconds, for .backoff and .failed: the first, doubling with
// each failure up to the most.
const RETRY_DELAY_FIRST = 5 * 60;
const RETRY_DELAY_MOST = 24 * 60 * 60;
// Wikimedia's User-Agent policy asks for a way to get in touch: the repo,
// where issues can be opened.
const USER_AGENT = "WorldClockCities/%VERSION% (Alfred workflow; https://github.com/CarlosNZ/alfred-workflows)";

const MATCH_RADIUS_KM = 50;
const SEARCH_LIMIT = 10;
const REQUEST_TIMEOUT_SECONDS = 20;
// Wikimedia rate-limits clients that send requests in quick succession,
// answering 429 with a Retry-After of a few seconds. Requests to each host are
// spaced out, and a short Retry-After is waited out rather than treated as a network
// failure.
const REQUEST_INTERVAL_SECONDS = 2;
// Temporary files older than this are left over from a fetch that was
// stopped. A fetch can't take this long, since each request times out.
const STALE_TEMPORARY_MINUTES = 10;
const RATE_LIMIT_MOST_WAIT_SECONDS = 60;
const RATE_LIMIT_RETRIES = 2;
const JPEG_QUALITY = 80;
// The largest custom picture downloaded from a URL other than Commons'.
const CUSTOM_PICTURE_MOST_BYTES = 25 * 1024 * 1024;

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

// A custom picture that can't be had, so the city gets one found for it.
class CustomPictureError extends Error {}

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
  if (city.override) {
    const given = city.override.commons || city.override.url || city.override.path;
    try {
      if (fetchCustomPicture(city, dir)) log(`${label}: custom picture ${given}`);
      return;
    } catch (error) {
      if (!(error instanceof CustomPictureError)) throw error;
      log(`${label}: custom picture ${given} not used (${error.message}); finding one`);
    }
  }

  const article = matchWikipediaArticle(city);
  if (!article.title) return recordNone(dir, city, article.reason);

  // The page image, if it's a photograph on Commons, otherwise P18.
  let source = "English Wikipedia page image";
  let file = article.image;
  let info = file && isPhotograph(file) ? commonsImageInfo(file) : null;
  let passedOver = "";
  if (!info) {
    if (file) passedOver = ` (passed over Wikipedia's ${file})`;
    source = "Wikidata image (P18)";
    file = article.wikidataId ? wikidataImage(article.wikidataId) : null;
    info = file ? commonsImageInfo(file) : null;
  }
  if (!info) {
    const item = article.wikidataId || "its Wikidata item";
    return recordNone(dir, city, `“${article.title}” has no page image to use, and ${item} no P18 image on Commons${passedOver}`);
  }

  const details = {
    wikipedia: `https://en.wikipedia.org/wiki/${encodeURIComponent(article.title.replace(/ /g, "_"))}`,
    wikidata: article.wikidataId ? `https://www.wikidata.org/wiki/${article.wikidataId}` : null,
    distanceKm: Math.round(article.distanceKm * 10) / 10,
    source,
    ...commonsCredit(info),
  };
  if (!savePicture(city, dir, commonsThumbnail(info), details, CityError)) return;
  log(`${label}: “${article.title}” (${article.wikidataId}, ${article.distanceKm.toFixed(1)} km), ${source}: ${file}${passedOver}`);
}

// Fetches a city's custom picture into the cache. Returns whether it was
// saved; throws CustomPictureError when it can't be had.
function fetchCustomPicture(city, dir) {
  const { commons, url, path } = city.override;
  if (commons) {
    const info = commonsImageInfo(commons);
    if (!info) throw new CustomPictureError("not a file on Wikimedia Commons");
    return savePicture(city, dir, commonsThumbnail(info), { source: "Custom picture (Wikimedia Commons)", ...commonsCredit(info) }, CityError);
  }
  if (url) return savePicture(city, dir, { url, external: true }, { source: "Custom picture", url }, CustomPictureError);
  if (!$.NSFileManager.defaultManager.isReadableFileAtPath(path)) throw new CustomPictureError("no such file");
  return savePicture(city, dir, { path }, { source: "Custom picture (file)", path }, CustomPictureError);
}

// A Commons file's thumbnail to download, from its imageinfo.
function commonsThumbnail(info) {
  return { url: info.thumburl || info.url, width: info.thumbwidth || info.width };
}

// A Commons file's page, artist and licence, from its imageinfo.
function commonsCredit(info) {
  const meta = info.extmetadata || {};
  return {
    file: info.descriptionurl,
    artist: plainText(meta.Artist && meta.Artist.value),
    licence: plainText(meta.LicenseShortName && meta.LicenseShortName.value),
    licenceUrl: (meta.LicenseUrl && meta.LicenseUrl.value) || null,
  };
}

// Saves a city's picture and its <slug>.json (`details`, with the city's name
// and country and the time added). `from` is { url, width, external } to
// download (width if it's known; external for a URL that isn't Wikimedia's,
// see request), or { path } of a local file. The picture is converted to a
// JPEG no wider than PICTURE_WIDTH, and a picture that won't convert throws
// `ErrorType`. Returns false, saving nothing, if the city's custom picture
// changed while it was fetched (see overrideIsCurrent).
function savePicture(city, dir, from, details, ErrorType) {
  const download = `${dir}/${temporaryName(city.slug)}`;
  const converted = `${download}.jpg`;
  if (from.url) request(from.url, download, { external: from.external });
  const input = from.path || download;
  const width = from.width || imageWidth(input);
  if (!width) throw new ErrorType("not an image");
  const resample = width > PICTURE_WIDTH ? ["--resampleWidth", String(PICTURE_WIDTH)] : [];
  const sips = runTask("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(JPEG_QUALITY), ...resample, input, "--out", converted]);
  if (sips.status !== 0) throw new ErrorType(`sips: ${sips.error.trim()}`);
  removeFile(download);

  if (!overrideIsCurrent(dir, city)) {
    removeFile(converted);
    log(`${city.slug} ${city.name}: its custom picture changed while fetching; not saved`);
    return false;
  }
  const record = { city: city.name, country: city.country, ...details, fetched: new Date().toISOString() };
  writeText(`${dir}/${city.slug}.json`, JSON.stringify(record, null, 2));
  moveFile(converted, `${dir}/${city.slug}.jpg`);
  removeFile(`${dir}/${city.slug}.failed`);
  return true;
}

// An image's width in pixels, from sips, or null if sips can't read it.
function imageWidth(path) {
  const sips = runTask("/usr/bin/sips", ["-g", "pixelWidth", path]);
  const match = sips.status === 0 && sips.output.match(/pixelWidth:\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

// Whether the city's custom picture (or having none) is still the one the
// cache is kept for, in .overrides.json: results.js deletes a city's files
// when its custom picture changes, which a fetch that started before must not
// put back.
function overrideIsCurrent(dir, city) {
  return JSON.stringify(recordedOverrides(dir)[city.slug] || null) === JSON.stringify(city.override || null);
}

// Whether a page image looks like a single photograph rather than a flag, coat
// of arms, seal, map or montage. A city that's also a country (Singapore,
// Vatican City) has its flag as its article's lead image, and some cities have
// a montage of several photos (Bangui, Belize City), which is too busy cropped
// to the picture's slot. Flags, arms and maps are drawn as SVGs, and the rest
// are told by their names.
function isPhotograph(file) {
  if (/\.svg$/i.test(file)) return false;
  if (/montage|collage|коллаж/i.test(file)) return false;
  if (/^(flag|coat[_ ]of[_ ]arms|emblem|seal|logo)[_ ]/i.test(file)) return false;
  return !/(^|[_ ().,-])(map|locator)([_ ().,-]|$)/i.test(file);
}

// The city's English Wikipedia article, as { title, distanceKm, image,
// wikidataId }, where image is its page image's file name (free images only,
// the API's default), or null. { reason } when no search result is close
// enough. One request gives the search results with their coordinates, page
// images and Wikidata items. Of the results close enough, the first titled with
// the city's name (alone, or before a comma or bracket) wins, otherwise the
// first. Disambiguation pages are left out.
// Some articles have no coordinates in Wikipedia's API ("Benicia, California"),
// which would leave a namesake nearby (Benicia Refinery) as the match. So when
// no result close enough is titled with the city's name, the coordinates of
// those that are titled with it but have none come from their Wikidata items,
// with one more request.
function matchWikipediaArticle(city) {
  const reply = requestJson(WIKIPEDIA_API, {
    action: "query",
    generator: "search",
    gsrsearch: city.name,
    gsrlimit: SEARCH_LIMIT,
    prop: "coordinates|pageimages|pageprops",
    ppprop: "wikibase_item|disambiguation",
    piprop: "name",
    pilimit: "max",
    colimit: "max",
  });
  const pages = ((reply.query && reply.query.pages) || []).sort((a, b) => a.index - b.index);
  if (pages.length === 0) return { reason: `no English Wikipedia article for “${city.name}”` };

  const name = foldText(city.name);
  const isNamed = (title) => foldText(title.split(/,| \(/)[0]) === name;
  const close = [];
  const namedWithoutCoordinates = [];
  let nearest = null;
  for (const page of pages) {
    const props = page.pageprops || {};
    if ("disambiguation" in props) continue;
    const article = { title: page.title, image: page.pageimage || null, wikidataId: props.wikibase_item || null };
    const coordinates = page.coordinates && (page.coordinates.find((c) => c.primary) || page.coordinates[0]);
    if (!coordinates) {
      if (article.wikidataId && isNamed(article.title)) namedWithoutCoordinates.push(article);
      continue;
    }
    if (coordinates.globe && coordinates.globe !== "earth") continue;
    article.distanceKm = haversineKm(city.latitude, city.longitude, coordinates.lat, coordinates.lon);
    if (article.distanceKm <= MATCH_RADIUS_KM) close.push(article);
    if (!nearest || article.distanceKm < nearest.distanceKm) nearest = article;
  }
  const chosen = close.find(({ title }) => isNamed(title)) || closeByWikidata(city, namedWithoutCoordinates) || close[0];
  if (chosen) return chosen;
  const closest = nearest ? `; nearest “${nearest.title}”, ${Math.round(nearest.distanceKm)} km` : "";
  return { reason: `no English Wikipedia article for “${city.name}” within ${MATCH_RADIUS_KM} km${closest}` };
}

// The first of the articles whose Wikidata item's coordinates (P625) are within
// MATCH_RADIUS_KM of the city's, with its distanceKm set, or null.
function closeByWikidata(city, articles) {
  if (articles.length === 0) return null;
  const pages = requestJson(WIKIDATA_API, {
    action: "query",
    titles: articles.map((article) => article.wikidataId).join("|"),
    prop: "coordinates",
    colimit: "max",
  }).query.pages;
  const byId = Object.fromEntries(pages.map((page) => [page.title, page]));
  for (const article of articles) {
    const page = byId[article.wikidataId];
    const coordinates = page && page.coordinates && (page.coordinates.find((c) => c.primary) || page.coordinates[0]);
    if (!coordinates || (coordinates.globe && coordinates.globe !== "earth")) continue;
    const distanceKm = haversineKm(city.latitude, city.longitude, coordinates.lat, coordinates.lon);
    if (distanceKm <= MATCH_RADIUS_KM) return { ...article, distanceKm };
  }
  return null;
}

// The image (P18) of a Wikidata item, as a file name, or null. Wikidata's page
// image is the item's P18.
function wikidataImage(id) {
  const pages = requestJson(WIKIDATA_API, { action: "query", titles: id, prop: "pageimages", piprop: "name", pilicense: "any" })
    .query.pages;
  return (pages && pages[0] && pages[0].pageimage) || null;
}

// A Commons file's imageinfo, with a PICTURE_WIDTH thumbnail and its artist
// and licence, or null if Commons doesn't have the file.
function commonsImageInfo(file) {
  const pages = requestJson(COMMONS_API, {
    action: "query",
    titles: `File:${file.replace(/^file:/i, "")}`,
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
// With `external`, for a custom picture's URL on another server, that server's
// trouble is the city's alone: it throws CityError when it can't reach the
// server or the server is busy or failing (worth a retry), CustomPictureError
// for any other reply but 200 or a file over CUSTOM_PICTURE_MOST_BYTES, and
// leaves .backoff alone.
function request(url, out, { external = false } = {}) {
  for (let retries = 0; ; retries++) {
    try {
      return requestOnce(url, out, external);
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

// When the last request to each host was sent, in milliseconds.
const lastRequestTimes = {};
let requestInterval = REQUEST_INTERVAL_SECONDS;

// One request, spaced requestInterval seconds after the one before to the same
// host. Wikimedia's rate limits are per service, so a request to another host
// (Wikidata, Wikipedia, Commons, the thumbnail server) goes straight away.
function requestOnce(url, out, external) {
  const host = (url.match(/^https?:\/\/([^/?#]+)/i) || [null, ""])[1].toLowerCase();
  const wait = (lastRequestTimes[host] || 0) + requestInterval * 1000 - Date.now();
  if (wait > 0) delay(wait / 1000);
  lastRequestTimes[host] = Date.now();
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
    ...(external ? ["--max-filesize", String(CUSTOM_PICTURE_MOST_BYTES)] : []),
    url,
  ]);
  if (curl.status !== 0) {
    const message = curl.error.trim() || `curl exit ${curl.status}`;
    // 63: the file is larger than --max-filesize.
    if (external) throw curl.status === 63 ? new CustomPictureError("too large") : new CityError(message);
    throw new NetworkError(message);
  }
  const code = Number(curl.output);
  if (code === 429 || code >= 500) {
    if (external) throw new CityError(`HTTP ${code} for ${url}`);
    throw new NetworkError(`HTTP ${code}`, retryAfterSeconds(readText(headers)), code);
  }
  if (!external) removeFile(`${dir}/.backoff`);
  if (code !== 200) throw new (external ? CustomPictureError : CityError)(`HTTP ${code} for ${url}`);
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
  if (!overrideIsCurrent(dir, city)) return log(`${city.slug} ${city.name}: its custom picture changed while fetching; not saved`);
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
