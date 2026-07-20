// Digital game deck source: localStorage caches only (see PLAN.md "Deck
// source = localStorage caches only"). The game never fetches playlists from
// Spotify — it reuses whatever the studio already cached while the player
// browsed decks there. The only network call is the `resolveMeta` fallback
// for pasted decks whose title/artist never got cached.
import { loadOverrides, plausibleYear } from './years.js';
import { resolveMeta } from './meta.js';

const PL_KEY = 'flutster_playlists';
const PL_V = 4; // must match App.jsx's PL_V — older entries lack fields this reads
const DECKS_KEY = 'flutster_pdecks';
const YEARS_KEY = 'flutster_years3';

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

export function listGameDecks() {
  const out = [];
  const playlists = loadJson(PL_KEY, {});
  for (const [id, e] of Object.entries(playlists)) {
    if (!e || e.v !== PL_V) continue;
    out.push({ kind: 'pl', id, name: e.name, count: (e.tracks || []).length });
  }
  const pasted = loadJson(DECKS_KEY, []);
  for (const d of pasted) {
    out.push({ kind: 'pasted', k: d.k, name: d.name, count: (d.ids || []).length });
  }
  return out;
}

export function effectiveYear(uri, isrc, spotifyYear) {
  const overrides = loadOverrides();
  if (overrides[uri]) return overrides[uri];
  const cache = loadJson(YEARS_KEY, {});
  const hit = cache[isrc || uri];
  if (hit && hit.y > 0) {
    return plausibleYear(spotifyYear) && spotifyYear < hit.y ? spotifyYear : hit.y;
  }
  return plausibleYear(spotifyYear) ? spotifyYear : 0;
}

export async function loadGameDeck(ref) {
  if (ref.kind === 'pl') {
    const playlists = loadJson(PL_KEY, {});
    const e = playlists[ref.id];
    if (!e || e.v !== PL_V) return { name: ref.name || 'Playlist', tracks: [], dropped: 0 };
    const tracks = [];
    let dropped = 0;
    for (const [uri, title, artist, spotifyYear, isrc] of e.tracks || []) {
      const year = effectiveYear(uri, isrc || '', spotifyYear);
      if (!year) {
        dropped++;
        continue;
      }
      tracks.push({ uri, title, artist, year });
    }
    return { name: e.name || ref.name || 'Playlist', tracks, dropped };
  }

  // pasted deck
  const pasted = loadJson(DECKS_KEY, []);
  const d = pasted.find((x) => x.k === ref.k);
  if (!d) return { name: ref.name || 'Deck', tracks: [], dropped: 0 };
  const metaCache = loadJson('flutster_meta', {});
  const tracks = [];
  let dropped = 0;
  for (const id of d.ids || []) {
    const uri = `spotify:track:${id}`;
    let meta = metaCache[id];
    if (!meta) {
      const resolved = await resolveMeta(id);
      meta = resolved ? [resolved.title, resolved.artist] : null;
    }
    if (!meta) {
      dropped++;
      continue;
    }
    const year = effectiveYear(uri, '', 0);
    if (!year) {
      dropped++;
      continue;
    }
    tracks.push({ uri, title: meta[0], artist: meta[1], year });
  }
  return { name: d.name || 'Deck', tracks, dropped };
}
