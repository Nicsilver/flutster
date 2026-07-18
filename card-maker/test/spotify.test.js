import { describe, it, expect } from 'vitest';
import { parseTrackIds, parsePlaylistId } from '../src/spotify.js';

const ID1 = '2WfaOiMkCvy7F5fcp2zZ8L';
const ID2 = '7J1uxwnxfQLu4APicE5Rnj';

describe('parseTrackIds', () => {
  it('reads the Spotify copy format: one track URL per line', () => {
    const text = `https://open.spotify.com/track/${ID1}\nhttps://open.spotify.com/track/${ID2}`;
    expect(parseTrackIds(text)).toEqual([ID1, ID2]);
  });

  it('reads bare spotify:track: URIs', () => {
    expect(parseTrackIds(`spotify:track:${ID1}`)).toEqual([ID1]);
  });

  it('reads intl-prefixed URLs and query strings', () => {
    expect(parseTrackIds(`https://open.spotify.com/intl-da/track/${ID1}?si=abc123`)).toEqual([ID1]);
  });

  it('drops duplicates but preserves first-seen order', () => {
    const text = `spotify:track:${ID2} spotify:track:${ID1} spotify:track:${ID2}`;
    expect(parseTrackIds(text)).toEqual([ID2, ID1]);
  });

  it('ignores junk and short ids', () => {
    expect(parseTrackIds('hello world')).toEqual([]);
    expect(parseTrackIds('spotify:track:tooShort123')).toEqual([]);
    expect(parseTrackIds('')).toEqual([]);
    expect(parseTrackIds(null)).toEqual([]);
  });
});

describe('parsePlaylistId', () => {
  it('reads playlist URLs and URIs', () => {
    expect(parsePlaylistId('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x')).toBe('37i9dQZF1DXcBWIGoYBM5M');
    expect(parsePlaylistId('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toBe('37i9dQZF1DXcBWIGoYBM5M');
  });

  it('returns null for anything else', () => {
    expect(parsePlaylistId('https://open.spotify.com/track/' + ID1)).toBe(null);
    expect(parsePlaylistId('')).toBe(null);
  });
});
