// Dev-only Spotify API stub. Enable with `localStorage.flutster_stub = '1'`
// (plus any flutster_client_id) and open /?code=x to "log in" without real
// credentials. Spotify endpoints are faked; MusicBrainz and iTunes calls go
// out for real, so the year-verification flow runs end-to-end. Loaded behind
// import.meta.env.DEV in main.jsx — never part of a production build.

// Spotify years below are deliberately wrong in the ways real metadata is
// wrong: remaster date, compilation date, re-release date.
const TRACKS = [
  ['spotify:track:stub0000001', 'Bohemian Rhapsody - Remastered 2011', 'Queen', '2011-01-01', 'GBUM71029604', 'album'],
  ['spotify:track:stub0000002', 'Billie Jean', 'Michael Jackson', '2005-06-01', 'USSM19902991', 'compilation'],
  ['spotify:track:stub0000003', 'Never Gonna Give You Up', 'Rick Astley', '2022-03-05', 'GBARL9300135', 'compilation'],
  ['spotify:track:stub0000004', 'Kvinde min', "Gasolin'", '2019-01-01', '', 'compilation'], // no ISRC
  ['spotify:track:stub0000005', 'Totally Made Up Song Xyzq', 'The Nonexistents', '1999-01-01', 'ZZXYZ0000001', 'album'], // unverifiable
  ['spotify:track:stub0000006', 'Butcher Pete (Pt. 1)', 'Roy Brown', '2021-01-01', 'QZZZZ2100001', 'compilation'], // pre-digital: ISRC unknown to MB
  ["spotify:track:stub0000007", "Ain't That A Kick In The Head", 'Dean Martin', '2002-01-01', '', 'compilation'], // apostrophe + comp-date case
];

const realFetch = window.fetch.bind(window);
const json = (obj) =>
  Promise.resolve(new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } }));

window.fetch = (input, init) => {
  const u = String(typeof input === 'string' ? input : input?.url || input);
  if (u.startsWith('https://accounts.spotify.com/api/token')) {
    return json({ access_token: 'stub-token', expires_in: 3600 });
  }
  if (u.includes('api.spotify.com/v1/me/playlists')) {
    return json({
      items: [{ id: 'stubpl', uri: 'spotify:playlist:stubpl', name: 'Stub Deck', images: [], tracks: { total: TRACKS.length } }],
      next: null,
    });
  }
  if (u.includes('api.spotify.com/v1/playlists/stubpl/tracks')) {
    return json({
      items: TRACKS.map(([uri, name, artist, date, isrc, albumType]) => ({
        track: {
          uri,
          id: uri.split(':')[2],
          name,
          artists: [{ name: artist }],
          album: { release_date: date, album_type: albumType },
          external_ids: { isrc },
        },
      })),
      next: null,
    });
  }
  if (u.includes('api.spotify.com/v1/playlists/stubpl')) {
    return json({ name: 'Stub Deck' });
  }
  return realFetch(input, init);
};

console.info('[flutster] dev Spotify stub active — playlist "Stub Deck" is fake, year lookups are real');
