const SCOPES = 'playlist-read-private playlist-read-collaborative';
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

// The user supplies their own Spotify app's Client ID (see the setup screen).
export function getClientId() {
  return localStorage.getItem('flutster_client_id') || '';
}
export function setClientId(v) {
  localStorage.setItem('flutster_client_id', (v || '').trim());
}

// Must match a redirect URI registered in the Spotify dashboard exactly.
export function redirectUri() {
  return window.location.origin + window.location.pathname;
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return new Uint8Array(digest);
}

function randomString(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => ('0' + b.toString(16)).slice(-2)).join('');
}

export async function login() {
  const verifier = randomString(48);
  sessionStorage.setItem('pkce_verifier', verifier);
  const challenge = b64url(await sha256(verifier));
  const params = new URLSearchParams({
    client_id: getClientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location = `${AUTH_URL}?${params.toString()}`;
}

export async function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const err = params.get('error');
  if (err) {
    window.history.replaceState({}, '', redirectUri());
    throw new Error('Spotify login was cancelled or failed: ' + err);
  }
  const code = params.get('code');
  if (!code) return getStoredToken();

  const verifier = sessionStorage.getItem('pkce_verifier');
  const body = new URLSearchParams({
    client_id: getClientId(),
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier || '',
  });
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await resp.json();
  window.history.replaceState({}, '', redirectUri());
  if (data.access_token) {
    sessionStorage.setItem(
      'spotify_token',
      JSON.stringify({ access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 })
    );
  } else {
    throw new Error('Token exchange failed: ' + (data.error_description || JSON.stringify(data)));
  }
  return getStoredToken();
}

export function getStoredToken() {
  const raw = sessionStorage.getItem('spotify_token');
  if (!raw) return null;
  try {
    const t = JSON.parse(raw);
    if (Date.now() > t.expires_at - 5000) return null;
    return t.access_token;
  } catch {
    return null;
  }
}

export function logout() {
  sessionStorage.removeItem('spotify_token');
}

async function api(path, token) {
  const resp = await fetch('https://api.spotify.com/v1' + path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 401) throw new Error('AUTH');
  if (!resp.ok) throw new Error(`Spotify API error ${resp.status}`);
  return resp.json();
}

export async function fetchMyPlaylists(token) {
  const out = [];
  let offset = 0;
  for (;;) {
    const page = await api(`/me/playlists?limit=50&offset=${offset}`, token);
    for (const p of page.items || []) {
      if (!p) continue;
      out.push({
        id: p.id,
        uri: p.uri,
        name: p.name,
        image: p.images?.[0]?.url || '',
        count: p.tracks?.total ?? 0,
      });
    }
    if (!page.next) break;
    offset += 50;
  }
  return out;
}

export function parsePlaylistId(url) {
  const m = String(url).match(/playlist[/:]([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

export async function fetchPlaylist(url, token) {
  const id = parsePlaylistId(url);
  if (!id) throw new Error('That is not a valid Spotify playlist link.');
  const meta = await api(`/playlists/${id}?fields=name`, token);
  const tracks = [];
  let offset = 0;
  for (;;) {
    const page = await api(
      `/playlists/${id}/tracks?limit=100&offset=${offset}&fields=${encodeURIComponent(
        'items(track(uri,id,name,artists(name),album(release_date,album_type),external_ids)),next'
      )}`,
      token
    );
    for (const it of page.items || []) {
      const t = it.track;
      if (!t || !t.uri || !t.uri.startsWith('spotify:track:')) continue;
      const year = parseInt((t.album?.release_date || '').slice(0, 4), 10) || 0;
      tracks.push({
        uri: t.uri,
        id: t.id,
        title: t.name || '',
        artist: (t.artists || []).map((a) => a.name).join(', '),
        year,
        isrc: t.external_ids?.isrc || '',
        // Compilation dates are the main source of wrong years — the verifier
        // refuses to fast-path tracks that come from one.
        comp: t.album?.album_type === 'compilation',
      });
    }
    if (!page.next) break;
    offset += 100;
  }
  return { name: meta.name || 'Playlist', tracks };
}
