// Preview-mode metadata: pasted track ids resolve to { title, artist } via
// the credential-free Cloudflare mirror (see worker/meta-worker.js). Results
// cache locally and at the mirror's edge, so reloading a deck costs nothing.
const WORKER = 'https://flutster-meta.nic-silver.workers.dev';
const KEY = 'flutster_meta'; // { [trackId]: [title, artist] }

let mem = null;
function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(mem));
  } catch {}
}

async function resolveOne(id) {
  const r = await fetch(`${WORKER}/track/${id}`);
  if (!r.ok) throw new Error('META');
  const j = await r.json();
  if (!j.title) throw new Error('META');
  return [j.title, j.artist || ''];
}

// Single-track lookup for the /play page's scanner.
export async function resolveMeta(id) {
  if (!mem) mem = load();
  if (mem[id]) return { title: mem[id][0], artist: mem[id][1] };
  try {
    const hit = await resolveOne(id);
    mem[id] = hit;
    save();
    return { title: hit[0], artist: hit[1] };
  } catch {
    return null;
  }
}

// Resolves pasted ids into the track shape the rest of the app expects.
// No ISRC and no Spotify year in this mode: the year verifier's search
// lanes date every card from scratch.
export async function fetchPastedTracks(ids, onProgress) {
  if (!mem) mem = load();
  const tracks = [];
  let failed = 0;
  let done = 0;
  const queue = [...ids];
  const workers = Array.from({ length: 4 }, async () => {
    for (;;) {
      const id = queue.shift();
      if (!id) return;
      let hit = mem[id];
      if (!hit) {
        try {
          hit = await resolveOne(id);
          mem[id] = hit;
          save();
        } catch {
          failed++;
        }
      }
      if (hit) {
        tracks.push({
          uri: `spotify:track:${id}`,
          id,
          title: hit[0],
          artist: hit[1],
          year: 0,
          isrc: '',
          comp: false,
        });
      }
      onProgress?.(++done, ids.length);
    }
  });
  await Promise.all(workers);
  // Restore paste order (parallel resolution scrambles it).
  const pos = new Map(ids.map((id, i) => [id, i]));
  tracks.sort((a, b) => pos.get(a.id) - pos.get(b.id));
  return { name: `Pasted deck · ${tracks.length} songs`, tracks, failed };
}

export function deckKey(ids) {
  let h = 0;
  for (const c of ids.join(',')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

// Saved pasted decks, so a deck can be reloaded and reprinted later.
const DECKS_KEY = 'flutster_pdecks'; // [{ k, name, ids, ts }]
export function loadSavedDecks() {
  try {
    return JSON.parse(localStorage.getItem(DECKS_KEY) || '[]');
  } catch {
    return [];
  }
}
export function saveDeck(k, name, ids) {
  const decks = loadSavedDecks().filter((d) => d.k !== k);
  decks.unshift({ k, name, ids, ts: Date.now() });
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(decks.slice(0, 20)));
  } catch {}
  return decks;
}
