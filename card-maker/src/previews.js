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

// The search lane must stand alone: in no-Spotify-API mode there is no ISRC,
// so it tries several query shapes before giving up. ISRC lookup, when an
// ISRC exists, is an exact-recording shortcut on top.
async function hasPreview(t, signal) {
  if (t.isrc) {
    const r = await json(`https://itunes.apple.com/lookup?isrc=${t.isrc}&entity=song&country=DK`, signal);
    if ((r.results || []).some((x) => x.previewUrl)) return true;
  }
  const artist = String(t.artist).split(',')[0];
  const title = String(t.title).split(' - ')[0].split(' (')[0];
  const fa = flat(artist);
  const ft = flat(title);
  const match = (r) =>
    (r.results || []).some(
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
    if (match(r)) return true;
    await new Promise((res) => setTimeout(res, 180));
  }
  return false;
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
      const ok = await hasPreview(t, signal);
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
