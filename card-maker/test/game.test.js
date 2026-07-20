import { describe, it, expect } from 'vitest';
import { slotCorrect, insertCard, decVar, newGame, gameReducer } from '../src/game.js';

const mk = (year, id) => ({ uri: `spotify:track:${id || year}`, title: `Song ${year}`, artist: 'Artist', year });
const team = (cards, tokens = 2, name = 'T') => ({ name, tokens, cards });

function baseState(overrides = {}) {
  return {
    v: 1,
    phase: 'turn',
    pile: [],
    current: mk(1995, 'cur'),
    teams: [team([mk(1990, 'a')], 2, 'A'), team([mk(2000, 'b')], 2, 'B')],
    turn: 0,
    target: 10,
    placedSlot: null,
    stealSlot: null,
    outcome: null,
    winner: null,
    ...overrides,
  };
}

describe('slotCorrect', () => {
  const cards = [mk(1990), mk(2000)];
  it('accepts a year that falls within its gap', () => {
    expect(slotCorrect(cards, 0, 1980)).toBe(true);
    expect(slotCorrect(cards, 1, 1995)).toBe(true);
    expect(slotCorrect(cards, 2, 2010)).toBe(true);
  });
  it('rejects a year outside its gap', () => {
    expect(slotCorrect(cards, 0, 1995)).toBe(false);
    expect(slotCorrect(cards, 2, 1995)).toBe(false);
  });
  it('treats a tied year as correct on either adjacent slot', () => {
    expect(slotCorrect(cards, 0, 1990)).toBe(true);
    expect(slotCorrect(cards, 1, 1990)).toBe(true);
    expect(slotCorrect(cards, 1, 2000)).toBe(true);
    expect(slotCorrect(cards, 2, 2000)).toBe(true);
  });
});

describe('insertCard', () => {
  it('inserts keeping year order', () => {
    const cards = [mk(1990), mk(2000)];
    expect(insertCard(cards, mk(1995)).map((c) => c.year)).toEqual([1990, 1995, 2000]);
    expect(insertCard(cards, mk(1980)).map((c) => c.year)).toEqual([1980, 1990, 2000]);
    expect(insertCard(cards, mk(2010)).map((c) => c.year)).toEqual([1990, 2000, 2010]);
  });
  it('is stable on ties (inserts after existing equal years)', () => {
    const cards = [mk(1990, 'x')];
    const next = insertCard(cards, mk(1990, 'y'));
    expect(next.map((c) => c.uri)).toEqual(['spotify:track:x', 'spotify:track:y']);
  });
  it('does not mutate the input array', () => {
    const cards = [mk(1990)];
    insertCard(cards, mk(1995));
    expect(cards).toHaveLength(1);
  });
});

describe('decVar', () => {
  it('buckets by decade', () => {
    expect(decVar(1965)).toBe('--dec60');
    expect(decVar(1975)).toBe('--dec70');
    expect(decVar(1985)).toBe('--dec80');
    expect(decVar(1995)).toBe('--dec90');
    expect(decVar(2005)).toBe('--dec00');
    expect(decVar(2015)).toBe('--dec10');
  });
});

describe('newGame', () => {
  it('deals one starter card per team and 2 tokens each', () => {
    const tracks = [mk(2000, '1'), mk(2010, '2'), mk(1990, '3'), mk(1980, '4')];
    const g = newGame({ tracks, names: ['A', 'B'], target: 10 });
    expect(g.teams[0].cards).toEqual([mk(2000, '1')]);
    expect(g.teams[1].cards).toEqual([mk(2010, '2')]);
    expect(g.teams[0].tokens).toBe(2);
    expect(g.teams[1].tokens).toBe(2);
    expect(g.pile).toEqual([mk(1990, '3'), mk(1980, '4')]);
    expect(g.phase).toBe('turn');
    expect(g.turn).toBe(0);
  });
});

describe('gameReducer: place / resolve', () => {
  it('correct placement inserts in year order when no steal is offered', () => {
    const s = baseState({ teams: [team([mk(1990, 'a')], 2, 'A'), team([mk(2000, 'b')], 0, 'B')] });
    const s2 = gameReducer(s, { type: 'place', slot: 1 });
    expect(s2.phase).toBe('reveal');
    expect(s2.outcome.placedOk).toBe(true);
    expect(s2.teams[0].cards.map((c) => c.year)).toEqual([1990, 1995]);
  });

  it('wrong placement discards the card', () => {
    const s = baseState({ teams: [team([mk(1990, 'a')], 2, 'A'), team([mk(2000, 'b')], 0, 'B')] });
    const s2 = gameReducer(s, { type: 'place', slot: 0 });
    expect(s2.outcome.placedOk).toBe(false);
    expect(s2.outcome.stole).toBe(false);
    expect(s2.teams[0].cards).toHaveLength(1);
    expect(s2.teams[1].cards).toHaveLength(1);
  });

  it('offers a steal when the other team has tokens, resolving nothing yet', () => {
    const s = baseState();
    const s2 = gameReducer(s, { type: 'place', slot: 1 });
    expect(s2.phase).toBe('steal');
    expect(s2.placedSlot).toBe(1);
    expect(s2.teams).toEqual(s.teams);
  });

  it('equal years count as correct on either adjacent slot', () => {
    const active = team([mk(1990, 'a'), mk(2000, 'b')], 0, 'A');
    const s = baseState({ current: mk(1990, 'cur'), teams: [active, team([], 0, 'B')] });
    expect(gameReducer(s, { type: 'place', slot: 0 }).outcome.placedOk).toBe(true);
    expect(gameReducer(s, { type: 'place', slot: 1 }).outcome.placedOk).toBe(true);
  });
});

describe('gameReducer: steal', () => {
  it('costs a token and a correct steal moves the card to the stealer, sorted', () => {
    const active = team([mk(1990, 'a'), mk(2000, 'b')], 2, 'A');
    const other = team([mk(1970, 'c')], 2, 'B');
    let s = baseState({ current: mk(1985, 'cur'), teams: [active, other] });
    s = gameReducer(s, { type: 'place', slot: 2 }); // wrong: 1985 doesn't belong after 2000
    expect(s.phase).toBe('steal');
    s = gameReducer(s, { type: 'steal', slot: 0 }); // other's guess about the SAME timeline: before 1990
    expect(s.teams[1].tokens).toBe(1);
    expect(s.teams[1].cards.map((c) => c.year)).toEqual([1970, 1985]);
    expect(s.teams[0].cards.map((c) => c.year)).toEqual([1990, 2000]);
    expect(s.outcome.placedOk).toBe(false);
    expect(s.outcome.stole).toBe(true);
  });

  it('a wrong steal guess discards, no token refunded', () => {
    const active = team([mk(1990, 'a'), mk(2000, 'b')], 2, 'A');
    const other = team([mk(1970, 'c')], 2, 'B');
    let s = baseState({ current: mk(1985, 'cur'), teams: [active, other] });
    s = gameReducer(s, { type: 'place', slot: 2 });
    s = gameReducer(s, { type: 'steal', slot: 1 }); // 1985 doesn't belong between 1990 and 2000 either
    expect(s.outcome.stole).toBe(false);
    expect(s.teams[1].tokens).toBe(1);
    expect(s.teams[0].cards).toHaveLength(2);
    expect(s.teams[1].cards).toHaveLength(1);
  });

  it('rejects a steal at the same slot as the placement', () => {
    const active = team([mk(1990, 'a'), mk(2000, 'b')], 2, 'A');
    const other = team([mk(1970, 'c')], 2, 'B');
    let s = baseState({ current: mk(1985, 'cur'), teams: [active, other] });
    s = gameReducer(s, { type: 'place', slot: 2 });
    const s2 = gameReducer(s, { type: 'steal', slot: 2 });
    expect(s2).toBe(s);
  });

  it('stealPass resolves with no steal attempted', () => {
    const active = team([mk(1990, 'a')], 2, 'A');
    const other = team([mk(2000, 'b')], 2, 'B');
    let s = baseState({ current: mk(1985, 'cur'), teams: [active, other] });
    s = gameReducer(s, { type: 'place', slot: 1 }); // wrong: 1985 not after 1990
    s = gameReducer(s, { type: 'stealPass' });
    expect(s.phase).toBe('reveal');
    expect(s.outcome.stole).toBe(false);
    expect(s.teams[0].cards).toHaveLength(1);
    expect(s.teams[1].cards).toHaveLength(1);
  });
});

describe('gameReducer: bonus', () => {
  it('adds exactly one token, once', () => {
    let s = baseState({
      phase: 'reveal',
      outcome: { placedOk: true, stole: false, bonus: false, bonusJudged: false },
    });
    s = gameReducer(s, { type: 'bonus', ok: true });
    expect(s.teams[0].tokens).toBe(3);
    expect(s.outcome.bonusJudged).toBe(true);
    const s2 = gameReducer(s, { type: 'bonus', ok: true });
    expect(s2.teams[0].tokens).toBe(3);
    expect(s2).toBe(s);
  });

  it('a "no" verdict judges without granting a token', () => {
    const s = baseState({
      phase: 'reveal',
      outcome: { placedOk: true, stole: false, bonus: false, bonusJudged: false },
    });
    const s2 = gameReducer(s, { type: 'bonus', ok: false });
    expect(s2.teams[0].tokens).toBe(2);
    expect(s2.outcome.bonusJudged).toBe(true);
  });

  it('credits the team named in the action, even when it is not the active team', () => {
    const s = baseState({
      phase: 'reveal',
      turn: 0,
      outcome: { placedOk: true, stole: false, bonus: false, bonusJudged: false },
    });
    const s2 = gameReducer(s, { type: 'bonus', ok: true, team: 1 });
    expect(s2.teams[1].tokens).toBe(3);
    expect(s2.teams[0].tokens).toBe(2);
    expect(s2.outcome.bonusJudged).toBe(true);
  });

  it('giveToken adds a token to the named team in any phase, capped at 5', () => {
    const s = baseState({ phase: 'turn', teams: [team([mk(1990, 'a')], 2, 'A'), team([mk(2000, 'b')], 5, 'B')] });
    const s2 = gameReducer(s, { type: 'giveToken', team: 1 });
    expect(s2.teams[1].tokens).toBe(5); // already capped
    const s3 = gameReducer(s, { type: 'giveToken', team: 0 });
    expect(s3.teams[0].tokens).toBe(3);
    expect(gameReducer(s, { type: 'giveToken' }).teams[0].tokens).toBe(3); // defaults to turn
  });

  it('caps tokens at 5 but still marks the bonus judged', () => {
    const s = baseState({
      phase: 'reveal',
      teams: [team([mk(1990, 'a')], 5, 'A'), team([mk(2000, 'b')], 2, 'B')],
      outcome: { placedOk: true, stole: false, bonus: false, bonusJudged: false },
    });
    const s2 = gameReducer(s, { type: 'bonus', ok: true });
    expect(s2.teams[0].tokens).toBe(5);
    expect(s2.outcome.bonus).toBe(true);
    expect(s2.outcome.bonusJudged).toBe(true);
  });
});

describe('gameReducer: skip / skipFree', () => {
  it('skip costs a token and clears the mystery card', () => {
    const s = baseState();
    const s2 = gameReducer(s, { type: 'skip' });
    expect(s2.teams[0].tokens).toBe(1);
    expect(s2.current).toBe(null);
  });

  it('skip is ineligible without a token', () => {
    const s = baseState({ teams: [team([mk(1990, 'a')], 0, 'A'), team([mk(2000, 'b')], 2, 'B')] });
    const s2 = gameReducer(s, { type: 'skip' });
    expect(s2).toBe(s);
  });

  it('skipFree clears the mystery card at no cost', () => {
    const s = baseState();
    const s2 = gameReducer(s, { type: 'skipFree' });
    expect(s2.teams[0].tokens).toBe(2);
    expect(s2.current).toBe(null);
  });
});

describe('gameReducer: buy', () => {
  it('pays 3 tokens and inserts the top card revealed, leaving current untouched', () => {
    const s = baseState({
      teams: [team([mk(1990, 'a')], 3, 'A'), team([], 2, 'B')],
      pile: [mk(1985, 'p1'), mk(2005, 'p2')],
    });
    const s2 = gameReducer(s, { type: 'buy' });
    expect(s2.teams[0].tokens).toBe(0);
    expect(s2.teams[0].cards.map((c) => c.year)).toEqual([1985, 1990]);
    expect(s2.pile).toEqual([mk(2005, 'p2')]);
    expect(s2.current).toEqual(s.current);
    expect(s2.phase).toBe('turn');
  });

  it('requires 3 tokens', () => {
    const s = baseState({ teams: [team([mk(1990, 'a')], 2, 'A'), team([], 2, 'B')], pile: [mk(1985, 'p1')] });
    expect(gameReducer(s, { type: 'buy' })).toBe(s);
  });

  it('ends the game (win check) when a bought card reaches the target', () => {
    const s = baseState({
      target: 2,
      teams: [team([mk(1990, 'a')], 3, 'A'), team([], 2, 'B')],
      pile: [mk(1985, 'p1')],
    });
    const s2 = gameReducer(s, { type: 'buy' });
    expect(s2.phase).toBe('over');
    expect(s2.winner).toBe(0);
  });
});

describe('gameReducer: next / win / empty pile', () => {
  it('declares a winner once a team reaches the target', () => {
    const s = baseState({
      phase: 'reveal',
      target: 2,
      teams: [team([mk(1990, 'a'), mk(1995, 'cur')], 2, 'A'), team([mk(2000, 'b')], 2, 'B')],
      outcome: { placedOk: true, stole: false, bonus: false, bonusJudged: true },
    });
    const s2 = gameReducer(s, { type: 'next' });
    expect(s2.phase).toBe('over');
    expect(s2.winner).toBe(0);
  });

  it('otherwise advances to the other team and clears turn state', () => {
    const s = baseState({
      phase: 'reveal',
      outcome: { placedOk: true, stole: false, bonus: false, bonusJudged: true },
    });
    const s2 = gameReducer(s, { type: 'next' });
    expect(s2.phase).toBe('turn');
    expect(s2.turn).toBe(1);
    expect(s2.current).toBe(null);
    expect(s2.placedSlot).toBe(null);
    expect(s2.stealSlot).toBe(null);
    expect(s2.outcome).toBe(null);
  });

  it('empty pile ends the game with the most-cards team winning', () => {
    const s = baseState({ pile: [], teams: [team([mk(1990, 'a'), mk(1991, 'b')], 2, 'A'), team([mk(2000, 'c')], 2, 'B')] });
    const s2 = gameReducer(s, { type: 'draw' });
    expect(s2.phase).toBe('over');
    expect(s2.winner).toBe(0);
  });

  it('empty pile with equal card counts is a draw', () => {
    const s = baseState({ pile: [], teams: [team([mk(1990, 'a')], 2, 'A'), team([mk(2000, 'c')], 2, 'B')] });
    const s2 = gameReducer(s, { type: 'draw' });
    expect(s2.winner).toBe('draw');
  });
});

describe('serialization', () => {
  it('round-trips through JSON and keeps working on the revived object', () => {
    const tracks = [mk(2000, '1'), mk(2010, '2'), mk(1990, '3'), mk(1980, '4'), mk(1970, '5')];
    let s = newGame({ tracks, names: ['A', 'B'], target: 10 });
    s = gameReducer(s, { type: 'draw' });
    const revived = JSON.parse(JSON.stringify(s));
    expect(revived).toEqual(s);
    const s2 = gameReducer(revived, { type: 'place', slot: 1 });
    expect(s2.phase).toBe('steal');
  });
});
