import { describe, it, expect, beforeEach } from 'vitest';
import { effectiveYear, listGameDecks, loadGameDeck } from '../src/deckload.js';

beforeEach(() => localStorage.clear());

describe('effectiveYear', () => {
  const URI = 'spotify:track:abc';
  const ISRC = 'USRC12345678';

  it('a manual override wins outright', () => {
    localStorage.setItem('flutster_yearfix', JSON.stringify({ [URI]: 1975 }));
    localStorage.setItem('flutster_years3', JSON.stringify({ [URI]: { y: 1999, s: 'mb' } }));
    expect(effectiveYear(URI, '', 2010)).toBe(1975);
  });

  it('applies the min-rule: an earlier plausible Spotify year beats the verdict', () => {
    localStorage.setItem('flutster_years3', JSON.stringify({ [URI]: { y: 2000, s: 'mb' } }));
    expect(effectiveYear(URI, '', 1995)).toBe(1995);
  });

  it('keeps the verdict when Spotify is not earlier', () => {
    localStorage.setItem('flutster_years3', JSON.stringify({ [URI]: { y: 1990, s: 'mb' } }));
    expect(effectiveYear(URI, '', 2005)).toBe(1990);
  });

  it('keeps the verdict when the Spotify year is implausible', () => {
    localStorage.setItem('flutster_years3', JSON.stringify({ [URI]: { y: 1990, s: 'mb' } }));
    expect(effectiveYear(URI, '', 0)).toBe(1990);
  });

  it('falls back to the plausible Spotify year with no verdict', () => {
    expect(effectiveYear(URI, '', 2008)).toBe(2008);
  });

  it('drops the track (returns 0) with no verdict and no plausible Spotify year', () => {
    expect(effectiveYear(URI, '', 0)).toBe(0);
  });

  it('reads the verdict by ISRC when present, over the URI', () => {
    localStorage.setItem('flutster_years3', JSON.stringify({ [ISRC]: { y: 1988, s: 'mb' } }));
    expect(effectiveYear(URI, ISRC, 0)).toBe(1988);
  });
});

describe('listGameDecks', () => {
  it('lists cached Spotify playlists and saved pasted decks together', () => {
    localStorage.setItem(
      'flutster_playlists',
      JSON.stringify({
        pl1: { v: 4, name: 'My Mix', count: 2, tracks: [['spotify:track:a', 'A', 'Art', 2000, '', 0], ['spotify:track:b', 'B', 'Art', 2010, '', 0]] },
        stale: { v: 3, name: 'Old', count: 1, tracks: [] },
      })
    );
    localStorage.setItem('flutster_pdecks', JSON.stringify([{ k: 'k1', name: 'Pasted', ids: ['id1', 'id2'], ts: 1 }]));
    const decks = listGameDecks();
    expect(decks).toContainEqual({ kind: 'pl', id: 'pl1', name: 'My Mix', count: 2 });
    expect(decks).toContainEqual({ kind: 'pasted', k: 'k1', name: 'Pasted', count: 2 });
    expect(decks.find((d) => d.id === 'stale')).toBeUndefined();
  });
});

describe('loadGameDeck', () => {
  it('loads a cached playlist, dropping tracks with no plausible year', () => {
    localStorage.setItem(
      'flutster_playlists',
      JSON.stringify({
        pl1: {
          v: 4,
          name: 'My Mix',
          count: 2,
          tracks: [
            ['spotify:track:a', 'A', 'Art', 2000, '', 0],
            ['spotify:track:b', 'B', 'Art', 0, '', 0],
          ],
        },
      })
    );
    return loadGameDeck({ kind: 'pl', id: 'pl1', name: 'My Mix' }).then((deck) => {
      expect(deck.tracks).toEqual([{ uri: 'spotify:track:a', title: 'A', artist: 'Art', year: 2000 }]);
      expect(deck.dropped).toBe(1);
    });
  });

  it('loads a pasted deck from cached metadata without any network call', () => {
    localStorage.setItem('flutster_pdecks', JSON.stringify([{ k: 'k1', name: 'Pasted', ids: ['id1', 'id2'], ts: 1 }]));
    localStorage.setItem('flutster_meta', JSON.stringify({ id1: ['Song One', 'Artist One'], id2: ['Song Two', 'Artist Two'] }));
    localStorage.setItem(
      'flutster_years3',
      JSON.stringify({
        'spotify:track:id1': { y: 1985, s: 'mb' },
        'spotify:track:id2': { y: 0, s: 'miss' },
      })
    );
    return loadGameDeck({ kind: 'pasted', k: 'k1', name: 'Pasted' }).then((deck) => {
      expect(deck.tracks).toEqual([{ uri: 'spotify:track:id1', title: 'Song One', artist: 'Artist One', year: 1985 }]);
      expect(deck.dropped).toBe(1);
    });
  });
});
