// Original-release-year verification. Spotify's album.release_date is the date
// of whichever album edition the track sits on — remasters, compilations and
// re-uploads all report the wrong year for the game. Two sources fix this:
//   1. MusicBrainz — recording search by ISRC (batched, ~15 per request at
//      1 req/s), whose `first-release-date` is the recording's original year.
//   2. iTunes Search — artist+title fallback for tracks MusicBrainz misses;
//      Apple propagates a song's original date onto compilation entries, but
//      matching is fuzzy, so it only runs when there's no exact ISRC hit.
// Verdicts are cached in localStorage so each track costs the network once.

const CACHE_KEY = 'flutster_years'; // { [isrc|uri]: { y, s: 'mb'|'it', t } } — y:0 = known miss
const FIX_KEY = 'flutster_yearfix'; // { [track uri]: year } manual overrides
const MB_BATCH = 15;
const MB_GAP_MS = 1100; // MusicBrainz allows ~1 request/second
const IT_GAP_MS = 3500; // iTunes tolerates ~20 requests/minute
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
    let resp;
    try {
      resp = await fetch(url, { signal });
    } catch (e) {
      if (signal?.aborted) throw e;
      return null;
    }
    if (resp.status === 503) {
      await sleep(3000 * (attempt + 1));
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

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
// "Song - Remastered 2011" / "Song (Live)" → "song" for comparing versions.
const baseTitle = (s) => norm(String(s || '').replace(/\s*[([].*?[)\]]/g, '').split(' - ')[0]);

function itunesCountry() {
  const m = String(globalThis.navigator?.language || '').match(/-([A-Za-z]{2})\b/);
  return m ? m[1].toLowerCase() : 'us';
}

// Fuzzy search — only trusted because the artist must match, and because the
// verdict is the MOST COMMON year across matching entries (earliest on ties):
// Apple propagates a song's original date onto reissues so real entries
// cluster on it, while lone junk-dated entries get outvoted. Returns a year,
// 0 for a genuine miss, or null when the request failed (don't cache).
async function itunesLookup(track, country, signal) {
  const artist = String(track.artist || '').split(',')[0].trim();
  const title = String(track.title || '').split(' - ')[0].trim();
  const url =
    `https://itunes.apple.com/search?media=music&entity=song&limit=25&country=${country}` +
    `&term=${encodeURIComponent(`${artist} ${title}`)}`;
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
  const wantTitle = baseTitle(track.title);
  if (!wantArtist || !wantTitle) return 0;
  const votes = {};
  for (const r of data.results || []) {
    const a = norm(r.artistName);
    if (!(a.includes(wantArtist) || wantArtist.includes(a))) continue;
    if (baseTitle(r.trackName) !== wantTitle) continue;
    const y = parseInt(String(r.releaseDate || '').slice(0, 4), 10);
    if (plausibleYear(y)) votes[y] = (votes[y] || 0) + 1;
  }
  let best = 0;
  for (const [ys, n] of Object.entries(votes)) {
    const y = Number(ys);
    if (!best || n > votes[best] || (n === votes[best] && y < best)) best = y;
  }
  return best;
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
  const emit = (t, y, src) => onUpdate?.(t.uri, y, src);

  const pending = [];
  for (const t of tracks) {
    if (overrides[t.uri]) {
      emit(t, overrides[t.uri], 'edit');
      continue;
    }
    const hit = cache[keyOf(t)];
    if (hit && (hit.y || Date.now() - (hit.t || 0) < MISS_TTL_MS)) {
      emit(t, hit.y, hit.y ? hit.s : 'miss');
      continue;
    }
    pending.push(t);
  }

  const total = pending.length;
  let done = 0;
  const tick = (n) => {
    done += n;
    onProgress?.(done, total);
  };
  if (total === 0) return;
  onProgress?.(0, total);

  try {
    // Pass 1 — MusicBrainz, batched by ISRC.
    const withIsrc = pending.filter((t) => t.isrc);
    let leftovers = pending.filter((t) => !t.isrc);
    for (let i = 0; i < withIsrc.length; i += MB_BATCH) {
      if (signal?.aborted) return;
      const batch = withIsrc.slice(i, i + MB_BATCH);
      if (i > 0) await sleep(MB_GAP_MS);
      const found = await mbLookup([...new Set(batch.map((t) => t.isrc))], signal);
      for (const t of batch) {
        const y = found?.[t.isrc];
        if (y) {
          cachePut(cache, t.isrc, { y, s: 'mb', t: Date.now() });
          emit(t, y, 'mb');
          tick(1);
        } else {
          leftovers.push(t); // MB miss (or failed batch) — try iTunes
        }
      }
    }

    // Pass 2 — iTunes for the stragglers, gently.
    const home = itunesCountry();
    let first = true;
    for (const t of leftovers) {
      if (signal?.aborted) return;
      if (!first) await sleep(IT_GAP_MS);
      first = false;
      let y = await itunesLookup(t, home, signal);
      if (y === 0 && home !== 'us') {
        await sleep(IT_GAP_MS);
        y = await itunesLookup(t, 'us', signal);
      }
      if (y === null) {
        emit(t, 0, 'miss'); // request failed — report but don't cache the miss
      } else {
        cachePut(cache, keyOf(t), { y, s: 'it', t: Date.now() });
        emit(t, y, y ? 'it' : 'miss');
      }
      tick(1);
    }
  } catch (e) {
    if (signal?.aborted) return;
    throw e;
  }
}
