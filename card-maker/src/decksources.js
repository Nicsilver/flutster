// Deck-database sources for the /play page, mirroring the app's CardResolver:
// user-supplied JSON URLs mapping card numbers to tracks, for decks whose QR
// carries a card number instead of a Spotify link (official Hitster-style).
// Flutster ships no deck data; sources are the user's own.
const KEY = 'flutster_decksources'; // [url, ...]
const WORKER = 'https://flutster-meta.nic-silver.workers.dev';

export function loadSources() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveSources(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
}

// hitstergame.com/dk/aaaa0047/00230 -> { deck: 'aaaa0047', number: '00230' };
// bare deck/number pairs count too, same as the app.
export function tryParseCard(raw) {
  const s = String(raw).trim();
  let m = s.match(/hitstergame\.com\/([a-z]{2})\/([a-z0-9]+)\/(\d{3,6})/i);
  if (m) return { deck: m[2].toLowerCase(), number: m[3] };
  m = s.match(/([a-z0-9]{4,})\/(\d{3,6})/i);
  if (m) return { deck: m[1].toLowerCase(), number: m[2] };
  return null;
}

const decks = new Map(); // deck -> Map(number -> {uri, title, artist, year})
let loadedSig = null;

export function cardCount() {
  let n = 0;
  for (const d of decks.values()) n += d.size;
  return n;
}

async function fetchSource(url) {
  // Direct first; most self-hosted sources allow CORS. The official DB does
  // not, so the metadata mirror has a JSON-only passthrough.
  try {
    const r = await fetch(url);
    if (r.ok) return await r.json();
  } catch {}
  const r = await fetch(`${WORKER}/db?u=${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error('DB');
  return r.json();
}

function merge(data) {
  let added = 0;
  const add = (deck, number, uri, title = '', artist = '', year = 0) => {
    if (!decks.has(deck)) decks.set(deck, new Map());
    decks.get(deck).set(String(number), { uri, title, artist, year });
    added++;
  };
  if (data && Array.isArray(data.gamesets)) {
    for (const g of data.gamesets) {
      const sku = g?.sku != null ? String(g.sku) : null;
      const cards = g?.gameset_data?.cards;
      if (!sku || !Array.isArray(cards)) continue;
      for (const c of cards) {
        const sp = c?.Spotify != null ? String(c.Spotify) : '';
        const num = c?.CardNumber != null ? String(c.CardNumber) : null;
        if (!sp || num == null) continue;
        add(sku, num, `spotify:track:${sp}`);
      }
    }
  } else if (data && data.cards && typeof data.cards === 'object' && data.deck != null) {
    const deck = String(data.deck);
    for (const [number, t] of Object.entries(data.cards)) {
      add(deck, number, String(t.uri), t.title || '', t.artist || '', Number(t.year) || 0);
    }
  } else if (data && Array.isArray(data.decks)) {
    for (const d of data.decks) added += merge(d);
  }
  return added;
}

export async function loadAllSources() {
  const srcs = loadSources();
  const sig = srcs.join('|');
  if (sig === loadedSig) return cardCount();
  decks.clear();
  for (const s of srcs) {
    try {
      merge(await fetchSource(s));
    } catch {
      // A dead source shouldn't take down the rest.
    }
  }
  loadedSig = sig;
  return cardCount();
}

export function invalidateSources() {
  loadedSig = null;
}

export function resolveCard(card) {
  const d = decks.get(card.deck);
  if (!d) return null;
  return d.get(card.number) || d.get(String(parseInt(card.number, 10))) || null;
}
