import { describe, it, expect, beforeEach } from 'vitest';
import { tryParseCard, merge, resolveCard, clearDecksForTest, cardCount } from '../src/decksources.js';

describe('tryParseCard', () => {
  it('parses official Hitster card URLs', () => {
    expect(tryParseCard('https://www.hitstergame.com/dk/aaaa0047/00230')).toEqual({
      deck: 'aaaa0047',
      number: '00230',
    });
  });

  it('is case-insensitive and lowercases the deck', () => {
    expect(tryParseCard('HTTPS://WWW.HITSTERGAME.COM/DE/AAAA0012/00042')).toEqual({
      deck: 'aaaa0012',
      number: '00042',
    });
  });

  it('accepts bare deck/number pairs', () => {
    expect(tryParseCard('aaaa0047/00230')).toEqual({ deck: 'aaaa0047', number: '00230' });
  });

  it('rejects track URIs and unrelated URLs', () => {
    expect(tryParseCard('spotify:track:2WfaOiMkCvy7F5fcp2zZ8L')).toBe(null);
    expect(tryParseCard('https://example.com/12345')).toBe(null);
    expect(tryParseCard('')).toBe(null);
  });
});

describe('merge + resolveCard', () => {
  beforeEach(() => clearDecksForTest());

  it('merges the official gameset shape', () => {
    const added = merge({
      gamesets: [
        {
          sku: 'aaaa0047',
          gameset_data: {
            cards: [
              { CardNumber: '00230', Spotify: '2WfaOiMkCvy7F5fcp2zZ8L' },
              { CardNumber: '00231', Spotify: '7J1uxwnxfQLu4APicE5Rnj' },
              { CardNumber: '00232' }, // no Spotify id: skipped
            ],
          },
        },
      ],
    });
    expect(added).toBe(2);
    expect(cardCount()).toBe(2);
    expect(resolveCard({ deck: 'aaaa0047', number: '00230' })).toMatchObject({
      uri: 'spotify:track:2WfaOiMkCvy7F5fcp2zZ8L',
    });
  });

  it('merges our own {deck, cards} shape with metadata', () => {
    merge({
      deck: 'mydeck',
      cards: { 12: { uri: 'spotify:track:abc', title: 'T', artist: 'A', year: 1984 } },
    });
    expect(resolveCard({ deck: 'mydeck', number: '12' })).toEqual({
      uri: 'spotify:track:abc',
      title: 'T',
      artist: 'A',
      year: 1984,
    });
  });

  it('recurses into a {decks: []} bundle', () => {
    const added = merge({
      decks: [
        { deck: 'd1', cards: { 1: { uri: 'u1' } } },
        { deck: 'd2', cards: { 1: { uri: 'u2' } } },
      ],
    });
    expect(added).toBe(2);
    expect(resolveCard({ deck: 'd2', number: '1' }).uri).toBe('u2');
  });

  it('resolves zero-padded numbers against unpadded card keys', () => {
    // Some databases store CardNumber as 230 while the printed QR says 00230.
    merge({ deck: 'pad', cards: { 230: { uri: 'padded' } } });
    expect(resolveCard({ deck: 'pad', number: '00230' }).uri).toBe('padded');
  });

  it('returns null for unknown decks and numbers', () => {
    merge({ deck: 'd1', cards: { 1: { uri: 'u1' } } });
    expect(resolveCard({ deck: 'nope', number: '1' })).toBe(null);
    expect(resolveCard({ deck: 'd1', number: '999' })).toBe(null);
  });
});
