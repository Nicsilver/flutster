// iTunes 30-second preview availability, for preview-playback mode: a card
// without a preview would be silent there, so the deck view warns before
// printing. ISRC lookup matches the exact recording; a title+artist search is
// the fallback. Results are cached (availability changes rarely).
const KEY = 'flutster_prev'; // { [isrc|uri]: 1 | 0 }

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

const flat = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

async function json(url, signal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

// Search-only on purpose: iTunes' lookup endpoint ignores the isrc parameter
// (0 hits across a 79-track live probe), and the no-Spotify-API mode has no
// ISRCs anyway — so the search lane tries several query shapes and
// storefronts before giving up. Probed hit rate on the real deck: ~96%.
async function clipUrl(t, signal) {
  const artist = String(t.artist).split(',')[0];
  const title = String(t.title).split(' - ')[0].split(' (')[0];
  const fa = flat(artist);
  const ft = flat(title);
  const match = (r) =>
    (r.results || []).find(
      (x) =>
        x.previewUrl &&
        (flat(x.artistName).includes(fa) || fa.includes(flat(x.artistName))) &&
        (flat(x.trackName).includes(ft) || ft.includes(flat(x.trackName)))
    );
  const attempts = [
    [`${artist} ${title}`, 'DK'],
    [title, 'DK'], // title-only: artist spellings differ more than titles do
    [`${artist} ${title}`, 'US'],
  ];
  for (const [term, country] of attempts) {
    const r = await json(
      `https://itunes.apple.com/search?term=${encodeURIComponent(term.slice(0, 80))}&entity=song&limit=10&country=${country}`,
      signal
    );
    const hit = match(r);
    if (hit) return hit.previewUrl;
    await new Promise((res) => setTimeout(res, 180));
  }
  return null;
}

// The /play page needs the actual clip URL; scanned cards repeat within a
// party, so remember them for the session.
const urlMem = new Map();
export async function findPreviewUrl(t, signal) {
  const key = t.isrc || t.uri || `${t.artist}|${t.title}`;
  if (urlMem.has(key)) return urlMem.get(key);
  const url = await clipUrl(t, signal);
  urlMem.set(key, url);
  return url;
}

// onUpdate(uri, ok) fires for every track; cached tracks resolve instantly.
export async function checkPreviews(tracks, { signal, onUpdate } = {}) {
  if (!mem) mem = load();
  let dirty = 0;
  for (const t of tracks) {
    if (signal?.aborted) break;
    const key = t.isrc || t.uri;
    if (mem[key] != null) {
      onUpdate?.(t.uri, !!mem[key]);
      continue;
    }
    try {
      const ok = !!(await findPreviewUrl(t, signal));
      mem[key] = ok ? 1 : 0;
      if (++dirty % 10 === 0) save();
      onUpdate?.(t.uri, ok);
    } catch {
      if (signal?.aborted) break;
      // Transient failure (rate limit, network): don't cache, don't flag.
      onUpdate?.(t.uri, true);
    }
    // iTunes tolerates gentle traffic; stay well under its informal limits.
    await new Promise((r) => setTimeout(r, 500));
  }
  if (dirty) save();
}
