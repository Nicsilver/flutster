// Pure Hitster-style rule engine. No React, no audio, no storage, no
// Date.now()/Math.random() — tracks arrive already shuffled (the UI shuffles
// before dispatching init) so the reducer stays fully deterministic. That
// determinism is deliberate: a later session adds 2-device play by sending
// actions over a WebRTC data channel and replaying them through this same
// reducer unchanged, so nothing here may depend on wall-clock time, RNG, or
// any browser API.

export function slotCorrect(cards, slot, year) {
  const left = slot > 0 ? cards[slot - 1].year : -Infinity;
  const right = slot < cards.length ? cards[slot].year : Infinity;
  return left <= year && year <= right;
}

// Stable: a tie lands after existing cards of the same year, keeping insert
// order reproducible (matters for the JSON-roundtrip / replay guarantee).
export function insertCard(cards, track) {
  const next = [...cards];
  let i = 0;
  while (i < next.length && next[i].year <= track.year) i++;
  next.splice(i, 0, track);
  return next;
}

export function decVar(year) {
  if (year < 1970) return '--dec60';
  if (year < 1980) return '--dec70';
  if (year < 1990) return '--dec80';
  if (year < 2000) return '--dec90';
  if (year < 2010) return '--dec00';
  return '--dec10';
}

function pickWinner(teams) {
  const [a, b] = teams;
  if (a.cards.length > b.cards.length) return 0;
  if (b.cards.length > a.cards.length) return 1;
  return 'draw';
}

export function newGame({ tracks, names, target }) {
  const pile = tracks.slice();
  const starter0 = pile.shift();
  const starter1 = pile.shift();
  return {
    v: 1,
    phase: 'turn',
    pile,
    current: null,
    teams: [
      { name: names?.[0] || 'Team 1', tokens: 2, cards: starter0 ? [starter0] : [] },
      { name: names?.[1] || 'Team 2', tokens: 2, cards: starter1 ? [starter1] : [] },
    ],
    turn: 0,
    target,
    placedSlot: null,
    stealSlot: null,
    outcome: null,
    winner: null,
  };
}

// Shared by 'place' (no steal offered), 'stealPass' and 'steal': scores the
// active team's placement against the current mystery card, and — when a
// steal was attempted — the challenger's guess against the SAME (active)
// timeline. A won steal still inserts by year into the stealer's OWN
// timeline (insertCard), not at the literal slot index, since the two
// timelines rarely line up card-for-card.
function resolve(state, placedSlot, stealSlot) {
  const activeIdx = state.turn;
  const otherIdx = 1 - state.turn;
  const active = state.teams[activeIdx];
  const current = state.current;
  const placedOk = slotCorrect(active.cards, placedSlot, current.year);
  let teams = state.teams;
  let stole = false;
  if (placedOk) {
    teams = state.teams.map((t, i) => (i === activeIdx ? { ...t, cards: insertCard(t.cards, current) } : t));
  } else if (stealSlot != null && slotCorrect(active.cards, stealSlot, current.year)) {
    stole = true;
    teams = state.teams.map((t, i) => (i === otherIdx ? { ...t, cards: insertCard(t.cards, current) } : t));
  }
  return {
    ...state,
    teams,
    phase: 'reveal',
    placedSlot,
    stealSlot,
    outcome: { placedOk, stole, bonus: false, bonusJudged: false },
  };
}

export function gameReducer(state, action) {
  switch (action.type) {
    case 'draw': {
      if (state.phase !== 'turn') return state;
      if (state.pile.length === 0) return { ...state, phase: 'over', winner: pickWinner(state.teams) };
      return { ...state, pile: state.pile.slice(1), current: state.pile[0] };
    }

    case 'place': {
      if (state.phase !== 'turn' || !state.current) return state;
      const otherIdx = 1 - state.turn;
      if (state.teams[otherIdx].tokens >= 1) {
        return { ...state, phase: 'steal', placedSlot: action.slot };
      }
      return resolve(state, action.slot, null);
    }

    case 'stealPass': {
      if (state.phase !== 'steal') return state;
      return resolve(state, state.placedSlot, null);
    }

    case 'steal': {
      if (state.phase !== 'steal') return state;
      if (action.slot === state.placedSlot) return state;
      const otherIdx = 1 - state.turn;
      const teams = state.teams.map((t, i) => (i === otherIdx ? { ...t, tokens: t.tokens - 1 } : t));
      return resolve({ ...state, teams }, state.placedSlot, action.slot);
    }

    case 'bonus': {
      if (state.phase !== 'reveal' || state.outcome.bonusJudged) return state;
      // action.team lets either team receive the honor-system bonus (table mode
      // drags a supply token onto either pile); ?? keeps older actions/saves working
      const team = action.team ?? state.turn;
      const teams = action.ok
        ? state.teams.map((t, i) => (i === team ? { ...t, tokens: Math.min(5, t.tokens + 1) } : t))
        : state.teams;
      return { ...state, teams, outcome: { ...state.outcome, bonus: !!action.ok, bonusJudged: true } };
    }

    // Honor-system: grab a token from the supply onto a pile at any time (in case
    // a team forgot to take one). Capped at 5 like the bonus.
    case 'giveToken': {
      const team = action.team ?? state.turn;
      return {
        ...state,
        teams: state.teams.map((t, i) => (i === team ? { ...t, tokens: Math.min(5, t.tokens + 1) } : t)),
      };
    }

    case 'next': {
      if (state.phase !== 'reveal') return state;
      const winIdx = state.teams.findIndex((t) => t.cards.length >= state.target);
      if (winIdx !== -1) return { ...state, phase: 'over', winner: winIdx };
      return {
        ...state,
        phase: 'turn',
        turn: 1 - state.turn,
        current: null,
        placedSlot: null,
        stealSlot: null,
        outcome: null,
      };
    }

    case 'skip': {
      if (state.phase !== 'turn') return state;
      const activeIdx = state.turn;
      if (state.teams[activeIdx].tokens < 1) return state;
      const teams = state.teams.map((t, i) => (i === activeIdx ? { ...t, tokens: t.tokens - 1 } : t));
      return { ...state, teams, current: null };
    }

    case 'skipFree': {
      if (state.phase !== 'turn') return state;
      return { ...state, current: null };
    }

    case 'buy': {
      if (state.phase !== 'turn') return state;
      const activeIdx = state.turn;
      if (state.teams[activeIdx].tokens < 3 || state.pile.length === 0) return state;
      const bought = state.pile[0];
      const pile = state.pile.slice(1);
      const teams = state.teams.map((t, i) =>
        i === activeIdx ? { ...t, tokens: t.tokens - 3, cards: insertCard(t.cards, bought) } : t
      );
      const winIdx = teams.findIndex((t) => t.cards.length >= state.target);
      if (winIdx !== -1) return { ...state, teams, pile, phase: 'over', winner: winIdx };
      if (pile.length === 0) return { ...state, teams, pile, phase: 'over', winner: pickWinner(teams) };
      return { ...state, teams, pile };
    }

    default:
      return state;
  }
}
