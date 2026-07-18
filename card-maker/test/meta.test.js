import { describe, it, expect, beforeEach } from 'vitest';
import { deckKey, loadSavedDecks, saveDeck } from '../src/meta.js';

describe('deckKey', () => {
  it('is locked across releases (print ledgers are keyed by it)', () => {
    // A deckKey change would orphan every flutster_printed ledger.
    expect(deckKey(['2WfaOiMkCvy7F5fcp2zZ8L', '7J1uxwnxfQLu4APicE5Rnj'])).toBe('11m6oc6');
  });

  it('is deterministic and order-sensitive', () => {
    const a = ['aaa', 'bbb'];
    expect(deckKey(a)).toBe(deckKey([...a]));
    expect(deckKey(['aaa', 'bbb'])).not.toBe(deckKey(['bbb', 'aaa']));
  });
});

describe('saved pasted decks', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a deck', () => {
    saveDeck('k1', 'My deck', ['id1', 'id2']);
    const decks = loadSavedDecks();
    expect(decks).toHaveLength(1);
    expect(decks[0]).toMatchObject({ k: 'k1', name: 'My deck', ids: ['id1', 'id2'] });
  });

  it('re-saving the same key replaces, newest first', () => {
    saveDeck('k1', 'One', ['a']);
    saveDeck('k2', 'Two', ['b']);
    saveDeck('k1', 'One again', ['a', 'c']);
    const decks = loadSavedDecks();
    expect(decks.map((d) => d.k)).toEqual(['k1', 'k2']);
    expect(decks[0].name).toBe('One again');
  });

  it('keeps at most 20 decks', () => {
    for (let i = 0; i < 25; i++) saveDeck(`k${i}`, `Deck ${i}`, ['x']);
    expect(loadSavedDecks()).toHaveLength(20);
    expect(loadSavedDecks()[0].k).toBe('k24');
  });

  it('survives corrupt storage', () => {
    localStorage.setItem('flutster_pdecks', '{not json');
    expect(loadSavedDecks()).toEqual([]);
  });
});
