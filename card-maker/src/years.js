// Original-release-year verification. Spotify's album.release_date is the date
// of whichever album edition the track sits on — remasters, compilations and
// re-uploads all report the wrong year for the game. Two sources fix this:
//   1. MusicBrainz — recording search by ISRC (batched, ~15 per request at
//      1 req/s), whose `first-release-date` is the recording's original year.
//   2. iTunes Search — artist+title fallback for tracks MusicBrainz misses;
//      Apple propagates a song's original date onto compilation entries, but
//      matching is fuzzy, so it only runs when there's no exact ISRC hit.
// Verdicts are cached in localStorage so each track costs the network once.

// Bump the key suffix when verdict logic changes materially — old entries are
// verdicts from the old logic and must not survive an upgrade.
const CACHE_KEY = 'flutster_years3'; // { [isrc|uri]: { y, s: 'mb'|'it'|'dg', u?, t } } — y:0 = known miss
const FIX_KEY = 'flutster_yearfix'; // { [track uri]: year } manual overrides
const MB_BATCH = 15;
const MB_GAP_MS = 1100; // MusicBrainz allows ~1 request/second
const IT_GAP_MS = 3500; // iTunes tolerates ~20 requests/minute
const DG_GAP_MS = 2500; // Discogs allows 25 requests/minute unauthenticated
const MB_RETRY_COOLDOWN_MS = 8000; // pause before re-sweeping rate-limited batches
const MISS_TTL_MS = 30 * 24 * 3600 * 1000; // re-try known misses monthly
const CACHE_MAX = 6000;

function loadJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}
function saveJson(key, obj) {
  try {
    localStorage.setItem(key, JSON.stringify(obj));
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {}
  }
}

export function loadOverrides() {
  return loadJson(FIX_KEY);
}
export function saveOverride(uri, year) {
  const map = loadOverrides();
  if (year) map[uri] = year;
  else delete map[uri];
  saveJson(FIX_KEY, map);
}

export function plausibleYear(y) {
  return y > 1900 && y <= new Date().getFullYear() + 1;
}

const keyOf = (t) => t.isrc || t.uri;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Per-service pacing: the slow lane interleaves calls to three APIs, and each
// must keep its own rate independently of the others.
const lastCall = {};
async function paced(service, gapMs) {
  const wait = (lastCall[service] || 0) + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall[service] = Date.now();
}

// --- MusicBrainz ------------------------------------------------------------

// One batched recording search. An ISRC can be attached to several recordings
// (reissue entries), so per ISRC we keep the EARLIEST plausible year — that's
// the original release, which is what the card should print.
// Returns { isrc: year } on success, or null when the request failed (callers
// must not cache misses from a failed batch).
async function mbLookup(isrcs, signal) {
  const query = isrcs.map((i) => `isrc:${i}`).join(' OR ');
  const url =
    'https://musicbrainz.org/ws/2/recording/?fmt=json&limit=100&query=' + encodeURIComponent(query);
  for (let attempt = 0; attempt < 3; attempt++) {
    await paced('mb', MB_GAP_MS);
    let resp;
    try {
      resp = await fetch(url, { signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      return null;
    }
    if (resp.status === 503) {
      // Retry-After is only readable if CORS exposes it; fall back to backoff.
      const ra = parseInt(resp.headers.get('retry-after') || '', 10) * 1000;
      await sleep(Math.min(ra > 0 ? ra : 3000 * (attempt + 1), 15000));
      continue;
    }
    if (!resp.ok) return null;
    const data = await resp.json();
    const want = new Set(isrcs);
    const best = {};
    for (const r of data.recordings || []) {
      const y = parseInt(String(r['first-release-date'] || '').slice(0, 4), 10);
      if (!plausibleYear(y)) continue;
      for (const code of r.isrcs || []) {
        if (want.has(code) && (!best[code] || y < best[code])) best[code] = y;
      }
    }
    return best;
  }
  return null;
}

// --- iTunes -----------------------------------------------------------------

// norm/baseTitle/canonTitle/leadArtist are exported for the test suite only;
// nothing outside this module should build matching logic on them.
export const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
// "Song - Remastered 2011" / "Song (Live)" → "song" for comparing versions.
export const baseTitle = (s) => norm(String(s || '').replace(/\s*[([].*?[)\]]/g, '').split(' - ')[0]);
// "Pt1" / "Pt. 1" / "Part One" suffixes vary per catalog and never change the
// year — drop them so the same song matches across sources.
export const canonTitle = (s) => baseTitle(s).replace(/\b(?:pt|part)\s*(?:one|two|three|\d+)$/, '').trim();
// "Kay Kyser & His Orchestra" / "Frankie Carle with Marjorie Hughes" →
// "Kay Kyser" / "Frankie Carle": big-band credits vary per catalog and break
// artist filters. Deliberately narrow — "Ike & Tina Turner" must survive.
export const leadArtist = (s) =>
  String(s || '')
    .split(',')[0]
    .replace(/\s+(?:&|and)\s+(?:his|her|the)\s.*$/i, '')
    .replace(/\s+(?:with|feat\.?|featuring)\s.*$/i, '')
    .trim();

function itunesCountry() {
  const m = String(globalThis.navigator?.language || '').match(/-([A-Za-z]{2})\b/);
  return m ? m[1].toLowerCase() : 'us';
}

// Fuzzy search: the artist must match and the verdict is the MOST COMMON year
// across matching entries (earliest on ties). Apple propagates a song's
// original date onto reissues, so for major-label catalog the entries cluster
// on the true year — but for pre-digital songs owned by scattered reissue
// labels the dates are junk, so the verdict carries a `conf` flag: only a
// clear majority within a narrow spread counts as trustworthy on its own.
// Returns { y, conf } (y 0 = genuine miss) or null when the request failed.
async function itunesLookup(track, country, signal) {
  const artist = leadArtist(track.artist);
  const title = String(track.title || '').split(' - ')[0].trim();
  const url =
    `https://itunes.apple.com/search?media=music&entity=song&limit=25&country=${country}` +
    `&term=${encodeURIComponent(`${artist} ${title}`)}`;
  await paced('it', IT_GAP_MS);
  let resp;
  try {
    resp = await fetch(url, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
  if (!resp.ok) return null;
  let data;
  try {
    data = await resp.json();
  } catch {
    return null;
  }
  const wantArtist = norm(artist);
  const wantTitle = canonTitle(track.title);
  if (!wantArtist || !wantTitle) return { y: 0, conf: false };
  const votes = {};
  let n = 0;
  for (const r of data.results || []) {
    const a = norm(r.artistName);
    if (!(a.includes(wantArtist) || wantArtist.includes(a))) continue;
    if (canonTitle(r.trackName) !== wantTitle) continue;
    const y = parseInt(String(r.releaseDate || '').slice(0, 4), 10);
    if (plausibleYear(y)) {
      votes[y] = (votes[y] || 0) + 1;
      n++;
    }
  }
  let best = 0;
  for (const [ys, c] of Object.entries(votes)) {
    const y = Number(ys);
    if (!best || c > votes[best] || (c === votes[best] && y < best)) best = y;
  }
  if (!best) return { y: 0, conf: false };
  const years = Object.keys(votes).map(Number);
  const span = Math.max(...years) - Math.min(...years);
  return { y: best, conf: votes[best] / n >= 0.6 && span <= 15 };
}

// MusicBrainz by title+artist — finds original recordings whose modern ISRC
// MusicBrainz doesn't know (common for pre-digital songs: the original
// recording is catalogued, but a modern re-upload's ISRC isn't attached to
// anything). Earliest matching year; exact-artist + canonical-title filtering
// keeps covers and homonyms out. Returns year, 0 = miss, null = failed.
async function mbTitleLookup(track, signal) {
  const artistTok = norm(leadArtist(track.artist));
  const titleTok = canonTitle(track.title);
  if (!artistTok || !titleTok) return 0;
  // norm() output is alphanumeric+spaces, so the tokens are Lucene-safe.
  const q =
    `recording:(${titleTok.split(' ').join(' AND ')})` +
    ` AND artist:(${artistTok.split(' ').join(' AND ')})`;
  const url = 'https://musicbrainz.org/ws/2/recording/?fmt=json&limit=50&query=' + encodeURIComponent(q);
  await paced('mb', MB_GAP_MS);
  let resp;
  try {
    resp = await fetch(url, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
  if (!resp.ok) return null;
  let data;
  try {
    data = await resp.json();
  } catch {
    return null;
  }
  let best = 0;
  for (const r of data.recordings || []) {
    const a = norm(r['artist-credit']?.[0]?.name);
    if (!(a.includes(artistTok) || artistTok.includes(a))) continue;
    if (canonTitle(r.title) !== titleTok) continue;
    const y = parseInt(String(r['first-release-date'] || '').slice(0, 4), 10);
    if (plausibleYear(y) && (!best || y < best)) best = y;
  }
  return best;
}

// Discogs catalogs physical releases, which makes it the authority for
// pre-digital originals (it lists the 1949 shellac single that iTunes dates
// 1966). Results come sorted by year ascending; the first plausible release
// credited to the artist is the earliest documented appearance of the song.
// Returns year, 0 = miss, null = failed.
async function discogsLookup(track, signal) {
  // Discogs matches tracklist titles fairly literally — query with the bare
  // song name (no parentheticals, no "- Remastered", no Part-N suffix), and
  // NO apostrophes: "I Don't Want to Set the World on Fire" finds a 1959
  // compilation while "I Dont Want..." finds the 1941 original 78.
  const deApos = (s) => s.replace(/['’´`]/g, '');
  const artist = deApos(leadArtist(track.artist)).trim();
  const title = deApos(
    String(track.title || '')
      .replace(/\s*[([].*?[)\]]/g, '')
      .split(' - ')[0]
      .replace(/\b(?:pt|part)\.?\s*(?:one|two|three|\d+)\s*$/i, '')
  ).trim();
  if (!artist || !title) return 0;
  const url =
    'https://api.discogs.com/database/search?per_page=25&sort=year&sort_order=asc' +
    `&track=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`;
  await paced('dg', DG_GAP_MS);
  let resp;
  try {
    resp = await fetch(url, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
  if (!resp.ok) return null;
  let data;
  try {
    data = await resp.json();
  } catch {
    return null;
  }
  const wantArtist = norm(artist);
  for (const r of data.results || []) {
    const y = parseInt(r.year, 10);
    if (!plausibleYear(y)) continue;
    // Result titles read "Artist - Release title".
    if (!norm(r.title).includes(wantArtist)) continue;
    return y;
  }
  return 0;
}

// --- driver -----------------------------------------------------------------

function cachePut(cache, key, entry) {
  cache[key] = entry;
  const keys = Object.keys(cache);
  if (keys.length > CACHE_MAX) {
    keys.sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0));
    for (const old of keys.slice(0, keys.length - CACHE_MAX)) delete cache[old];
  }
  saveJson(CACHE_KEY, cache);
}

// Verifies every track's year. Emits onUpdate(uri, year, src) per verdict —
// src is 'mb' | 'it' | 'edit' | 'miss' (year 0). Overrides and cached verdicts
// resolve instantly; the rest go MusicBrainz-first, then iTunes.
export async function verifyYears(tracks, { onUpdate, onProgress, signal } = {}) {
  const cache = loadJson(CACHE_KEY);
  const overrides = loadOverrides();
  const emit = (t, y, src, unsure) => onUpdate?.(t.uri, y, src, !!unsure);

  const pending = [];
  for (const t of tracks) {
    if (overrides[t.uri]) {
      emit(t, overrides[t.uri], 'edit');
      continue;
    }
    const hit = cache[keyOf(t)];
    if (hit && (hit.y || Date.now() - (hit.t || 0) < MISS_TTL_MS)) {
      emit(t, hit.y, hit.y ? hit.s : 'miss', hit.u);
      continue;
    }
    pending.push(t);
  }

  const total = pending.length;
  let done = 0;
  // Live remaining-time estimate: during the batch phase every unresolved
  // track is pessimistically priced as a lane track (the estimate can only
  // shrink); once the lane is known it's exact.
  const LANE_S = 3.6;
  const BATCH_S = 1.3;
  let batchesLeft = 0;
  let inLanePhase = false;
  const eta = () => {
    const unresolved = total - done;
    return Math.round(unresolved * LANE_S + (inLanePhase ? 0 : batchesLeft * BATCH_S));
  };
  const tick = (n) => {
    done += n;
    onProgress?.(done, total, eta());
  };
  if (total === 0) return;

  try {
    // Pass 1 — MusicBrainz, batched by ISRC. An ISRC hit alone is NOT a
    // verdict: MB recording entries created from reissues carry the reissue's
    // date. It only stands when it independently agrees with Spotify's year
    // AND the track isn't from a compilation (a comp date "agreeing" with an
    // MB entry sourced from the same comp is one wrong source, twice).
    // Everything else goes to the corroboration lane with the MB year as one
    // candidate among several.
    const withIsrc = pending.filter((t) => t.isrc);
    const lane = pending.filter((t) => !t.isrc).map((t) => ({ t, isrcY: 0 }));
    batchesLeft = Math.ceil(withIsrc.length / MB_BATCH);
    onProgress?.(0, total, eta());
    const mbSweep = async (list) => {
      // Tracks from FAILED requests (rate limit, network) are returned for a
      // later retry; definitive misses join the lane immediately.
      const failed = [];
      for (let i = 0; i < list.length; i += MB_BATCH) {
        if (signal?.aborted) return failed;
        const batch = list.slice(i, i + MB_BATCH);
        const found = await mbLookup([...new Set(batch.map((t) => t.isrc))], signal);
        batchesLeft = Math.max(0, batchesLeft - 1);
        if (!found) {
          failed.push(...batch);
          continue;
        }
        for (const t of batch) {
          const y = found[t.isrc];
          const sy = t.year || 0;
          if (y && !t.comp && Math.abs(y - sy) <= 2) {
            cachePut(cache, t.isrc, { y, s: 'mb', t: Date.now() });
            emit(t, y, 'mb');
            tick(1);
          } else {
            lane.push({ t, isrcY: y || 0 });
          }
        }
      }
      return failed;
    };

    let failed = await mbSweep(withIsrc);
    if (failed.length && !signal?.aborted) {
      batchesLeft = Math.ceil(failed.length / MB_BATCH);
      console.warn(
        `[flutster] MusicBrainz requests failed for ${failed.length} tracks — retrying in ${MB_RETRY_COOLDOWN_MS / 1000}s`
      );
      await sleep(MB_RETRY_COOLDOWN_MS);
      failed = await mbSweep(failed);
      if (failed.length) {
        console.warn(`[flutster] MusicBrainz still unavailable for ${failed.length} tracks`);
        lane.push(...failed.map((t) => ({ t, isrcY: 0 })));
      }
    }
    if (signal?.aborted) return;
    console.debug(
      `[flutster] year check: ${tracks.length - total} cached, ${done} confirmed by MusicBrainz+Spotify agreement, ` +
        `${lane.length} need corroboration (Discogs + iTunes)`
    );

    // Pass 2 — the corroboration lane. Discogs (physical-release authority)
    // and iTunes (confidence-gated vote) run in parallel per track, with the
    // MB ISRC year as a third candidate; MB title search is a last resort
    // when nothing corroborates. EARLIEST trusted year wins. Flag `unsure`
    // when no second source lands within 3 years of the verdict, and when
    // Spotify's own year is earlier than everything the sources found (the
    // min-rule will keep it, but nothing supports it).
    inLanePhase = true;
    onProgress?.(done, total, eta());
    const home = itunesCountry();
    for (const { t, isrcY } of lane) {
      if (signal?.aborted) return;
      const itChain = async () => {
        let r = await itunesLookup(t, home, signal);
        if (r && !r.y && home !== 'us') r = (await itunesLookup(t, 'us', signal)) ?? r;
        return r;
      };
      const [dg, it] = await Promise.all([discogsLookup(t, signal), itChain()]);
      const cand = [
        { y: isrcY, s: 'mb', trusted: true },
        { y: dg || 0, s: 'dg', trusted: true },
        { y: it?.y || 0, s: 'it', trusted: !!it?.conf },
      ].filter((c) => c.y);
      const near = (y) => cand.filter((c) => Math.abs(c.y - y) <= 3).length;
      let trusted = cand.filter((c) => c.trusted);
      let vY = trusted.length ? Math.min(...trusted.map((c) => c.y)) : 0;
      if (!vY || near(vY) < 2) {
        const mt = await mbTitleLookup(t, signal);
        if (mt) {
          cand.push({ y: mt, s: 'mb', trusted: true });
          trusted = cand.filter((c) => c.trusted);
          vY = Math.min(...trusted.map((c) => c.y));
        }
      }
      let verdict = 0;
      let src = '';
      let unsure = false;
      if (vY) {
        verdict = vY;
        src = trusted.find((c) => c.y === vY).s;
        unsure = near(vY) < 2;
      } else if (it?.y) {
        verdict = it.y; // scattered, uncorroborated vote — best guess, flagged
        src = 'it';
        unsure = true;
      }
      const sy = t.year || 0;
      if (verdict && plausibleYear(sy) && sy < verdict - 2) unsure = true;
      const answered = isrcY > 0 || dg !== null || it !== null;
      if (!answered) {
        emit(t, 0, 'miss'); // every request failed — report but don't cache
      } else {
        cachePut(cache, keyOf(t), { y: verdict, s: src, ...(unsure ? { u: 1 } : {}), t: Date.now() });
        emit(t, verdict, verdict ? src : 'miss', unsure);
      }
      tick(1);
    }
  } catch (e) {
    if (signal?.aborted) return;
    throw e;
  }
}
