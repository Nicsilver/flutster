// Flutster metadata mirror, deployed as a Cloudflare Worker.
//
// Preview mode (no Spotify login) needs title + artist for pasted track
// links, but browsers cannot read Spotify's public track pages cross-origin.
// This worker fetches the public page server-side and returns the OpenGraph
// metadata as JSON. It holds NO credentials of any kind and only touches
// public pages; CORS is restricted to the card maker's origins and
// responses are cached hard at the edge.
//
// GET /track/{22-char id} -> { id, title, artist }

const ALLOWED = new Set([
  'https://nicsilver.github.io',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.has(origin) ? origin : 'https://nicsilver.github.io',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const m = url.pathname.match(/^\/track\/([A-Za-z0-9]{22})$/);
    if (!m) return json({ error: 'not-found' }, 404, cors);
    const id = m[1];

    const page = await fetch(`https://open.spotify.com/track/${id}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en',
      },
      cf: { cacheTtl: 60 * 60 * 24 * 30, cacheEverything: true },
    });
    if (!page.ok) return json({ error: 'upstream-' + page.status }, 502, cors);
    const html = await page.text();

    const meta = (prop) => {
      const mm = html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`));
      return mm ? decodeEntities(mm[1]) : '';
    };
    const title = meta('og:title');
    // og:description reads "Artist · Song · Year"; the shape has shifted over
    // the years but the artist is reliably the first segment.
    const artist = (meta('og:description').split(' · ')[0] || '').trim();
    if (!title) return json({ error: 'no-metadata' }, 502, cors);

    return json({ id, title, artist }, 200, {
      ...cors,
      'Cache-Control': 'public, max-age=2592000',
    });
  },
};
