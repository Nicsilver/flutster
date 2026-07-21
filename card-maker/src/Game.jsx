import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { gameReducer, newGame, decVar } from './game.js';
import { listGameDecks, loadGameDeck } from './deckload.js';
import { createClipPlayer } from './clipplayer.js';
import { playTrackWithWake, pausePlayback, resumePlayback, seekPlayback } from './spotify.js';
import { findPreviewUrl } from './previews.js';

const STORAGE_KEY = 'flutster_game';

const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  replay: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  rew: 'M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z',
  fwd: 'M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z',
  moon: 'M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36A5.4 5.4 0 0 1 11.5 4.1 9 9 0 0 0 12 3z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM2 13h2a1 1 0 0 0 0-2H2a1 1 0 0 0 0 2zm18 0h2a1 1 0 0 0 0-2h-2a1 1 0 0 0 0 2zM11 2v2a1 1 0 0 0 2 0V2a1 1 0 0 0-2 0zm0 18v2a1 1 0 0 0 2 0v-2a1 1 0 0 0-2 0zM5.99 4.58 4.93 3.51a1 1 0 0 0-1.42 1.42l1.07 1.06a1 1 0 0 0 1.41-1.41zm12.02 12.02-1.06-1.06a1 1 0 0 0-1.41 1.41l1.06 1.07a1 1 0 0 0 1.41-1.42zm1.48-11.67a1 1 0 0 0-1.42 0l-1.06 1.07a1 1 0 0 0 1.41 1.41l1.07-1.06a1 1 0 0 0 0-1.42zM7.05 16.95a1 1 0 0 0-1.42 0l-1.06 1.06a1 1 0 0 0 1.42 1.42l1.06-1.07a1 1 0 0 0 0-1.41z',
};

// Bare Flutster mark, theme-matched (base-safe, like the topbar logo).
function markSrc(isDark) {
  return `${import.meta.env.BASE_URL}${isDark ? 'mark-dark.svg' : 'mark-light.svg'}`;
}

function ThemeToggle({ theme, className }) {
  if (!theme) return null;
  return (
    <button
      className={'play-ic ink' + (className ? ' ' + className : '')}
      title={theme.isDark ? 'Switch to light' : 'Switch to dark'}
      onClick={theme.toggle}
    >
      <Icon d={theme.isDark ? ICONS.sun : ICONS.moon} size={20} />
    </button>
  );
}

function Icon({ d, size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d={d} />
    </svg>
  );
}

function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return s && s.phase !== 'over' ? s : null;
  } catch {
    return null;
  }
}

// The UI shuffles before dispatching init — the reducer stays deterministic
// and serializable for a future P2P mode (see game.js).
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

const HUES = ['--dec60', '--dec70', '--dec80', '--dec90', '--dec00', '--dec10'];

// Fixed 6-hue equalizer skyline (deterministic bar heights, no per-card leak).
function Skyline({ n, flipped }) {
  return (
    <span className={'gb-sky' + (flipped ? ' flipped' : '')}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} style={{ background: `var(${HUES[i % 6]})`, height: 6 + ((i * 7 + 3) % 11) }} />
      ))}
    </span>
  );
}

// A placed timeline card, dressed like the printed deck: equalizer skylines
// top and bottom framing a decade-coloured year over title/artist.
function BoardCard({ c, className }) {
  return (
    <div className={'gb-tcard' + (className ? ' ' + className : '')} style={{ '--dc': `var(${decVar(c.year)})` }}>
      <Skyline n={7} />
      <span className="gb-tcyr">{c.year}</span>
      <span className="gb-tct">{c.title}</span>
      <span className="gb-tca">{c.artist}</span>
      <Skyline n={7} flipped />
    </div>
  );
}

// Imperative drag: clone the source node, follow the pointer, snap to the
// nearest target within 130px. No React state changes mid-drag — the drop
// callback dispatches and the component re-renders once. Ported from the
// approved table-mode mock.
function startDrag(e, srcEl, { targets, expandSlots }, onDrop, onCancel) {
  // pointermove events carry button -1 even for the left mouse button, so
  // only guard real pointerdowns (a tap-probe hands over a pointermove)
  if (e.type === 'pointerdown' && e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  const clone = srcEl.cloneNode(true);
  clone.classList.add('gb-clone');
  clone.classList.remove('away', 'pulse', 'glow', 'grab', 'droptarget');
  const r = srcEl.getBoundingClientRect();
  clone.style.width = r.width + 'px';
  clone.style.height = r.height + 'px';
  document.body.appendChild(clone);
  srcEl.style.opacity = '0.25';
  if (expandSlots) document.body.classList.add('gb-dragging');
  let near = null;
  let hit = null;
  const list = targets();
  const move = (ev) => {
    clone.style.left = ev.clientX + 'px';
    clone.style.top = ev.clientY + 'px';
    clone.classList.toggle('flipped', ev.clientY < window.innerHeight / 2);
    // Slots snap by center distance (they expand while dragging). Larger drop
    // areas (a whole team zone, the pile, a token pile) register when the
    // pointer is anywhere INSIDE them — center distance would force a drag all
    // the way to a tall zone's midpoint. A slot hit always wins over an area.
    let slotHit = null;
    let slotD = 130;
    let areaHit = null;
    let areaSize = Infinity;
    let nearHit = null;
    let nearD = 150;
    for (const t of list) {
      const tr = t.el.getBoundingClientRect();
      const cx = tr.left + tr.width / 2;
      const cy = tr.top + tr.height / 2;
      const d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      if (t.slot != null) {
        if (d < slotD) {
          slotD = d;
          slotHit = t;
        }
      } else {
        const inside =
          ev.clientX >= tr.left && ev.clientX <= tr.right && ev.clientY >= tr.top && ev.clientY <= tr.bottom;
        if (inside) {
          const size = tr.width * tr.height;
          if (size < areaSize) {
            areaSize = size;
            areaHit = t;
          }
        } else if (d < nearD) {
          nearD = d;
          nearHit = t;
        }
      }
    }
    const best = slotHit || areaHit || nearHit;
    if (near && (!best || best.el !== near)) near.classList.remove('near', 'droptarget');
    if (best) best.el.classList.add(best.slot != null ? 'near' : 'droptarget');
    near = best ? best.el : null;
    hit = best;
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    document.body.classList.remove('gb-dragging');
    if (near) near.classList.remove('near', 'droptarget');
    clone.remove();
    srcEl.style.opacity = '';
    if (hit) onDrop(hit);
    else onCancel?.();
  };
  move(e);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function SetupScreen({
  onExit,
  theme,
  decks,
  deckRef,
  onPickDeck,
  deckMeta,
  loadingDeck,
  err,
  name1,
  setName1,
  name2,
  setName2,
  target,
  setTarget,
  source,
  setSource,
  token,
  canStart,
  onStart,
}) {
  return (
    <div className="gameroot gset">
      <div className="gset-card">
        <div className="gset-edge" />
        <div className="gset-body">
          <div className="gset-head">
            <span className="gset-eyebrow">New game</span>
            <span className="gset-headbtns">
              <ThemeToggle theme={theme} />
              <button className="play-ic ink" title="Close" onClick={onExit}>
                <Icon d={ICONS.close} size={22} />
              </button>
            </span>
          </div>
          <h1 className="gset-title">Who is playing?</h1>
          <p className="gset-sub">One device, two teams. Pass it around the table.</p>

          <div className="gset-split">
            <label className="gset-half" style={{ '--tc': 'var(--dec00)' }}>
              <span className="gset-e">Team 1</span>
              <input value={name1} onChange={(e) => setName1(e.target.value)} placeholder="Team 1" aria-label="Team 1 name" />
            </label>
            <span className="gset-seam" />
            <label className="gset-half" style={{ '--tc': 'var(--dec80)' }}>
              <span className="gset-e">Team 2</span>
              <input value={name2} onChange={(e) => setName2(e.target.value)} placeholder="Team 2" aria-label="Team 2 name" />
            </label>
          </div>

          <div className="gset-settings">
            <div className="gset-deck">
              <span className="gset-lab">Deck</span>
              {decks.length === 0 ? (
                <p className="play-sub">
                  Open a playlist in the card maker first — decks you&rsquo;ve viewed there appear here.
                </p>
              ) : (
                <div className="gset-decks">
                  {decks.map((d) => {
                    const key = d.kind === 'pl' ? d.id : d.k;
                    const active = deckRef && (deckRef.kind === 'pl' ? deckRef.id === d.id : deckRef.k === d.k);
                    return (
                      <button
                        key={key}
                        type="button"
                        className={'gset-chip' + (active ? ' on' : '')}
                        onClick={() => onPickDeck(d)}
                      >
                        {d.name} <span className="n">{d.count}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {loadingDeck && <p className="play-sub">Loading deck…</p>}
              {deckMeta && !loadingDeck && (
                <p className="play-sub">
                  {deckMeta.dropped > 0
                    ? `${deckMeta.dropped} song${deckMeta.dropped === 1 ? '' : 's'} skipped — no verified year.`
                    : 'Every song has a year.'}
                </p>
              )}
              {err && <p className="error">{err}</p>}
            </div>

            <div className="gset-row">
              <span className="gset-lab">First to</span>
              <span className="gset-seg">
                {[5, 10, 15].map((n) => (
                  <button key={n} className={target === n ? 'on' : ''} onClick={() => setTarget(n)}>
                    {n}
                  </button>
                ))}
              </span>
            </div>

            <div className="gset-row">
              <span className="gset-lab">Sound</span>
              <span className="gset-seg">
                <button className={source === 'preview' ? 'on' : ''} onClick={() => setSource('preview')}>
                  Previews
                </button>
                <button
                  className={source === 'spotify' ? 'on' : ''}
                  disabled={!token}
                  title={token ? 'Full songs on your active Spotify device' : 'Log in on the card maker first'}
                  onClick={() => setSource('spotify')}
                >
                  Spotify
                </button>
              </span>
            </div>
          </div>

          <button className="gset-start" disabled={!canStart} onClick={onStart}>
            START GAME
          </button>
        </div>
      </div>
    </div>
  );
}

function GamePlay({ initial, token, source, theme, onExit, onPlayAgain, onNewGame }) {
  const [state, dispatch] = useReducer(gameReducer, initial);
  const mark = markSrc(theme?.isDark);
  const playerRef = useRef(null);
  function getPlayer() {
    if (!playerRef.current) playerRef.current = createClipPlayer();
    return playerRef.current;
  }

  const [audioPhase, setAudioPhase] = useState('loading'); // loading | tap | playing | miss | nodevice | error
  const [paused, setPaused] = useState(false);
  const [sec, setSec] = useState(0);
  const [pendingBuy, setPendingBuy] = useState(0); // 0-2 tokens dropped on the pile toward a buy
  const [revealStage, setRevealStage] = useState(0); // 0/1 = flip in place, 2 = bonus + draw window
  const prevTeamsRef = useRef(null); // teams snapshot captured just before a resolving dispatch
  const mysteryRef = useRef(null);
  const pileRef = useRef(null);
  const flightRef = useRef(null); // {fromRect, fromFlip} of the flipped card, captured before stage 2

  // Persist on every change while the game is live; a finished game is
  // dropped from storage so a reload never offers to "resume" it.
  useEffect(() => {
    if (state.phase === 'over') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  useEffect(() => {
    window.flutsterGame = { state, dispatch };
    return () => {
      delete window.flutsterGame;
    };
  });

  useEffect(() => {
    setPendingBuy(0);
  }, [state.phase, state.current?.uri]);

  // Reveal plays in two beats: stage 1 flips the card in place (rendered from
  // the pre-resolve rows in prevTeamsRef, since the reducer already inserted
  // it), stage 2 settles into the real rows and opens the bonus/draw window.
  // Between the beats a clone flies the card from where it flipped to its final
  // sorted slot — across the table (with a 180° tumble) when it's stolen (see
  // the flight layout effect below).
  useEffect(() => {
    if (state.phase !== 'reveal') {
      setRevealStage(0);
      return;
    }
    flightRef.current = null;
    setRevealStage(1);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRevealStage(2);
      return;
    }
    const t = setTimeout(() => {
      // Snapshot the flipped card's spot BEFORE stage 2 reflows it away.
      const flipEl = document.querySelector('.gb-tlrow .gb-flipin');
      flightRef.current = flipEl
        ? { fromRect: flipEl.getBoundingClientRect(), fromFlip: flipEl.closest('.gb-zone.flip') ? 180 : 0 }
        : null;
      setRevealStage(2);
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.current?.uri]);

  // The flight: at stage 2 the card's final resting slot exists (marked
  // .gb-flydest). Clone it, park the clone over the destination, and animate it
  // in from where it flipped — a viewport-space transform so a rotated (flipped)
  // team zone just becomes part of the tumble instead of breaking the math.
  useLayoutEffect(() => {
    if (revealStage < 2) return;
    const f = flightRef.current;
    flightRef.current = null;
    if (!f) return;
    const dest = document.querySelector('.gb-flydest');
    if (!dest) return;
    const to = dest.getBoundingClientRect();
    const dx = f.fromRect.left + f.fromRect.width / 2 - (to.left + to.width / 2);
    const dy = f.fromRect.top + f.fromRect.height / 2 - (to.top + to.height / 2);
    const toFlip = dest.closest('.gb-zone.flip') ? 180 : 0;
    // A card that lands where it flipped (correct placement, no steal) needs no
    // flight — let its settle pop play instead.
    if (Math.hypot(dx, dy) < 6 && f.fromFlip === toFlip) return;
    const clone = dest.cloneNode(true);
    clone.classList.remove('gb-settle', 'gb-flydest');
    clone.classList.add('gb-flyclone');
    Object.assign(clone.style, {
      position: 'fixed', left: `${to.left}px`, top: `${to.top}px`,
      width: `${to.width}px`, height: `${to.height}px`, margin: '0', zIndex: '150', transformOrigin: 'center',
    });
    document.body.appendChild(clone);
    dest.style.visibility = 'hidden';
    const anim = clone.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) rotate(${f.fromFlip}deg) scale(1)`, offset: 0 },
        { transform: `translate(0px, 0px) rotate(${toFlip}deg) scale(1.06)`, offset: 0.85 },
        { transform: `translate(0px, 0px) rotate(${toFlip}deg) scale(1)`, offset: 1 },
      ],
      { duration: 560, easing: 'cubic-bezier(.22,.61,.36,1)', fill: 'both' }
    );
    const done = () => {
      clone.remove();
      if (dest.isConnected) dest.style.visibility = '';
    };
    anim.onfinish = done;
    anim.oncancel = done;
    return () => anim.cancel();
  }, [revealStage]);

  // Blind playback: fires once per fresh mystery card, while the round is
  // still being guessed. Steal reuses whatever is already playing.
  useEffect(() => {
    const uri = state.current?.uri;
    if (!uri || state.phase !== 'turn') return;
    let cancelled = false;
    setPaused(false);
    setSec(0);
    setAudioPhase('loading');
    (async () => {
      if (source === 'spotify' && token) {
        try {
          await playTrackWithWake(uri, token);
          if (!cancelled) setAudioPhase('playing');
        } catch (e) {
          if (cancelled) return;
          setAudioPhase(e.message === 'NO_DEVICE' ? 'nodevice' : 'error');
        }
      } else {
        const t = state.current;
        const url = await findPreviewUrl({ uri: t.uri, title: t.title, artist: t.artist });
        if (cancelled) return;
        if (!url) {
          setAudioPhase('miss');
          return;
        }
        const res = await getPlayer().start(url);
        if (cancelled) return;
        if (res === 'playing') setAudioPhase('playing');
        else if (res === 'tap') setAudioPhase('tap');
        else setAudioPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.current?.uri, state.phase === 'turn']);

  // No preview anywhere: skip it for free and move straight to the next card.
  useEffect(() => {
    if (audioPhase !== 'miss') return;
    const t = setTimeout(() => {
      dispatch({ type: 'skipFree' });
      dispatch({ type: 'draw' });
    }, 1400);
    return () => clearTimeout(t);
  }, [audioPhase]);

  // Steal handoff pauses so both teams can talk without the song blasting.
  useEffect(() => {
    if (state.phase !== 'steal' || paused) return;
    if (source === 'spotify' && token) pausePlayback(token);
    else playerRef.current?.pause();
    setPaused(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // Reveal/over: the mystery is over, audio stops for good this round.
  useEffect(() => {
    if (state.phase !== 'reveal' && state.phase !== 'over') return;
    playerRef.current?.stop();
    if (source === 'spotify' && token) pausePlayback(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  useEffect(() => {
    return () => {
      playerRef.current?.dispose();
      if (source === 'spotify' && token) pausePlayback(token);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (audioPhase !== 'playing') return;
    const t = setInterval(() => {
      if (source === 'preview') setSec(getPlayer().position());
      else setSec((s) => (paused ? s : s + 0.5));
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioPhase, paused, source]);

  function togglePause() {
    if (source === 'spotify' && token) {
      paused ? resumePlayback(token).catch(() => {}) : pausePlayback(token);
    } else {
      paused ? playerRef.current?.resume() : playerRef.current?.pause();
    }
    setPaused(!paused);
  }
  function restart() {
    if (source === 'spotify' && token) {
      seekPlayback(0, token);
      if (paused) resumePlayback(token).catch(() => {});
    } else {
      playerRef.current?.restart(paused);
    }
    setSec(0);
    setPaused(false);
  }
  function tapPlay() {
    playerRef.current?.tapPlay();
    setAudioPhase('playing');
  }
  function seekBy(delta) {
    const t = Math.max(0, sec + delta);
    seekPlayback(Math.round(t * 1000), token);
    setSec(t);
  }
  function retryAudio() {
    if (!state.current) return;
    setAudioPhase('loading');
    playTrackWithWake(state.current.uri, token)
      .then(() => setAudioPhase('playing'))
      .catch((e) => setAudioPhase(e.message === 'NO_DEVICE' ? 'nodevice' : 'error'));
  }

  function doSkip() {
    if (state.teams[state.turn].tokens < 1) return;
    playerRef.current?.stop();
    if (source === 'spotify' && token) pausePlayback(token);
    dispatch({ type: 'skip' });
    dispatch({ type: 'draw' });
  }
  function doExit() {
    playerRef.current?.dispose();
    if (source === 'spotify' && token) pausePlayback(token);
    onExit();
  }

  // Live drop targets = the gaps in the active team's timeline (queried fresh
  // at drag start; the face-down gap is a .gb-slot, not .live, so it's excluded).
  const activeLiveSlots = () =>
    Array.from(document.querySelectorAll(`.gb-tlrow[data-team="${state.turn}"] .gb-slot.live`)).map((el) => ({
      el,
      slot: Number(el.dataset.slot),
    }));
  const activeTokenTargets = () => {
    const arr = [];
    if (mysteryRef.current) arr.push({ el: mysteryRef.current, act: 'skip' });
    if (pileRef.current && state.pile.length > 0) arr.push({ el: pileRef.current, act: 'buy' });
    return arr;
  };

  // Dropping the mystery card into a gap commits the placement outright (no
  // separate Lock tap): the reducer opens the steal window when the other team
  // still has a token, otherwise it resolves straight to the reveal.
  function onMysteryDown(e) {
    startDrag(e, e.currentTarget, { targets: activeLiveSlots, expandSlots: true }, (hit) => {
      prevTeamsRef.current = state.teams;
      dispatch({ type: 'place', slot: hit.slot });
    });
  }
  function onStealPass() {
    prevTeamsRef.current = state.teams;
    dispatch({ type: 'stealPass' });
  }
  function onBuyToken() {
    setPendingBuy((n) => {
      const next = n + 1;
      if (next >= 3) {
        dispatch({ type: 'buy' });
        return 0;
      }
      return next;
    });
  }
  function onTeamTokenDown(e, team) {
    if (state.phase === 'steal' && team === 1 - state.turn) {
      // Official steal: drop your token in the gap where the card really belongs.
      startDrag(e, e.currentTarget, { targets: activeLiveSlots, expandSlots: true }, (hit) => {
        prevTeamsRef.current = state.teams;
        dispatch({ type: 'steal', slot: hit.slot });
      });
    } else if (state.phase === 'turn' && team === state.turn) {
      startDrag(e, e.currentTarget, { targets: activeTokenTargets }, (hit) => {
        if (hit.act === 'skip') doSkip();
        else onBuyToken();
      });
    }
  }
  function onSupplyDown(e) {
    startDrag(
      e,
      e.currentTarget,
      {
        targets: () =>
          state.teams
            .map((_, i) => ({ el: document.querySelector(`.gb-tokens[data-pile="${i}"]`), team: i }))
            .filter((t) => t.el),
      },
      (hit) => {
        // During the bonus window a grab counts as the bonus (closes it);
        // otherwise it's just a free honor-system token.
        if (state.phase === 'reveal' && revealStage >= 2 && !state.outcome.bonusJudged) {
          dispatch({ type: 'bonus', ok: true, team: hit.team });
        } else {
          dispatch({ type: 'giveToken', team: hit.team });
        }
      }
    );
  }
  function onPileDown(e) {
    // Clone the whole pile, not the inner top card — the card's frame comes
    // from the descendant selector `.gb-pile .gb-pcard`, which stops matching
    // once the clone is detached to <body>.
    startDrag(
      e,
      pileRef.current || e.currentTarget,
      {
        // Draw = pull the card into the MIDDLE, where it becomes the next
        // mystery. The mid cell is a big, obvious target between both teams.
        targets: () => {
          const arr = [];
          const mid = document.querySelector('.gb-cell.mid');
          if (mid) arr.push({ el: mid, act: 'draw' });
          if (mysteryRef.current) arr.push({ el: mysteryRef.current, act: 'draw' });
          return arr;
        },
      },
      () => {
        // next may end the game; draw then no-ops on phase 'over'
        dispatch({ type: 'next' });
        dispatch({ type: 'draw' });
      }
    );
  }

  function outcomeMsg() {
    const year = state.current?.year;
    const active = state.teams[state.turn].name;
    const other = state.teams[1 - state.turn].name;
    const o = state.outcome;
    if (o.placedOk) return `${year}. Correct! The card joins ${active}'s timeline.`;
    if (o.stole) return `${year}. Stolen! ${other} had it right and takes the card.`;
    if (state.stealSlot != null) return `${year}. Both wrong. The card is out.`;
    return `${year}. Wrong spot. The card is out.`;
  }

  function captionFor(team) {
    const active = team === state.turn;
    const other = 1 - state.turn;
    const nm = (i) => state.teams[i].name;
    if (state.phase === 'turn') {
      if (active && audioPhase === 'miss') return { text: 'No preview, drawing another…', hot: true };
      return active
        ? {
            text: 'Listen, then drag the mystery card into your timeline. Tokens: 1 skips the song, 3 on the pile buys a card.',
            hot: true,
          }
        : { text: `${nm(state.turn)} is guessing. Get ready to judge.`, hot: false };
    }
    if (state.phase === 'steal') {
      return team === other
        ? {
            text: 'Music paused. Think that spot is wrong? Drag one of your tokens into the gap where the card really belongs. Or tap the card to let it flip.',
            hot: true,
          }
        : { text: `Placed. ${nm(other)} decides whether to steal.`, hot: false };
    }
    if (state.phase === 'reveal') {
      if (revealStage < 2) return { text: outcomeMsg(), hot: true };
      if (team === other) {
        return {
          text: state.outcome.bonusJudged
            ? 'Drag the top of the draw pile into the middle to start your turn.'
            : 'Did anyone name song + artist? Drag them a token from the supply. Then drag the top of the draw pile into the middle to start your turn.',
          hot: true,
        };
      }
      return { text: outcomeMsg(), hot: false };
    }
    return { text: '', hot: false };
  }

  function timelineItems(team) {
    const revealing1 = state.phase === 'reveal' && revealStage < 2 && prevTeamsRef.current;
    const cards = revealing1 ? prevTeamsRef.current[team].cards : state.teams[team].cards;
    const n = cards.length;
    const isActive = team === state.turn;
    const showLive = isActive && (state.phase === 'turn' || state.phase === 'steal');
    const facedownSlot = state.phase === 'steal' ? state.placedSlot : null;
    const revealAt = state.stealSlot != null ? state.stealSlot : state.placedSlot;
    const lost = state.outcome && !state.outcome.placedOk && !state.outcome.stole;
    const items = [];
    for (let slot = 0; slot <= n; slot++) {
      if (showLive && facedownSlot != null && slot === facedownSlot) {
        // Only the 'steal' phase reaches here: the committed card sits face-down
        // in its gap until the steal decision flips it.
        items.push(
          <div key={`gap${slot}`} className="gb-facedown locked" onClick={onStealPass}>
            <span className="gb-q">?</span>
            <span className="gb-hint">tap to flip</span>
          </div>
        );
      } else if (showLive) {
        items.push(<div key={`s${slot}`} className="gb-slot live" data-slot={slot} />);
      } else if (revealing1 && isActive && slot === revealAt) {
        items.push(<BoardCard key="reveal" c={state.current} className={lost ? 'gb-discard' : 'gb-flipin'} />);
      } else {
        items.push(<div key={`s${slot}`} className="gb-slot" />);
      }
      if (slot < n) {
        const c = cards[slot];
        const settle =
          state.phase === 'reveal' &&
          revealStage >= 2 &&
          c.uri === state.current?.uri &&
          ((state.outcome.placedOk && team === state.turn) || (state.outcome.stole && team === 1 - state.turn));
        items.push(<BoardCard key={`c${slot}${c.uri}`} c={c} className={settle ? 'gb-settle gb-flydest' : ''} />);
      }
    }
    return items;
  }

  function renderZone(team, flip) {
    const t = state.teams[team];
    const cap = captionFor(team);
    const shownTokens = t.tokens - (team === state.turn ? pendingBuy : 0);
    const canGrab =
      shownTokens > 0 &&
      ((state.phase === 'turn' && team === state.turn) ||
        (state.phase === 'steal' && team === 1 - state.turn));
    // The only steal cue: flash the challenger's token pile (no dimming anywhere).
    const flashTokens = state.phase === 'steal' && team === 1 - state.turn && shownTokens > 0;
    return (
      <div className={'gb-zone' + (flip ? ' flip' : '')} data-zone={team}>
        <div className={'gb-caption' + (cap.hot ? ' hot' : '')}>{cap.text}</div>
        <div className="gb-tlrow" data-team={team}>
          {timelineItems(team)}
        </div>
        <div className="gb-head">
          <span className={'gb-tokens' + (flashTokens ? ' flash' : '')} data-pile={team}>
            {Array.from({ length: Math.max(0, shownTokens) }, (_, i) => (
              <span
                key={i}
                className={'gb-token' + (canGrab ? ' grab' : '')}
                onPointerDown={canGrab ? (e) => onTeamTokenDown(e, team) : undefined}
              >
                <img className="gb-tokimg" src={mark} alt="" draggable="false" />
              </span>
            ))}
          </span>
        </div>
      </div>
    );
  }

  function renderCenter() {
    const drawGlow = state.phase === 'reveal' && revealStage >= 2;
    const bonusOpen = drawGlow && !state.outcome.bonusJudged;
    const mysteryAway = state.phase !== 'turn' || !state.current;
    const pulse = audioPhase === 'playing' && !paused && !mysteryAway;
    // Mirrored transport: one cluster faces each team so both can reach it.
    const audioBlock = (flip) => (
      <div className={'gb-audio' + (flip ? ' flip' : '')}>
        {audioPhase === 'loading' && <div className="play-spin" />}
        {audioPhase === 'tap' && (
          <button className="tap-play" onClick={tapPlay}>
            <Icon d={ICONS.play} size={36} />
          </button>
        )}
        {audioPhase === 'nodevice' && (
          <div className="gb-audiopanel">
            <p className="play-sub">
              Spotify isn&rsquo;t running anywhere. Open it, play anything for a second, then try again.
            </p>
            <button className="ghost sm" onClick={retryAudio}>
              Try again
            </button>
          </div>
        )}
        {audioPhase === 'error' && (
          <div className="gb-audiopanel">
            <p className="play-sub">Playback failed.</p>
            <button className="ghost sm" onClick={retryAudio}>
              Try again
            </button>
          </div>
        )}
        {audioPhase === 'playing' && (
          <>
            <div className="play-time">{paused ? 'PAUSED' : fmt(sec)}</div>
            <div className="play-row">
              {source === 'spotify' && token && (
                <button className="ctl side" onClick={() => seekBy(-15)} title="Back 15s">
                  <Icon d={ICONS.rew} size={22} />
                </button>
              )}
              <button className="ctl" onClick={togglePause} aria-label={paused ? 'Play' : 'Pause'}>
                <Icon d={paused ? ICONS.play : ICONS.pause} size={28} />
              </button>
              {source === 'spotify' && token && (
                <button className="ctl side" onClick={() => seekBy(15)} title="Forward 15s">
                  <Icon d={ICONS.fwd} size={22} />
                </button>
              )}
            </div>
            <button className="play-restart" onClick={restart}>
              <Icon d={ICONS.replay} size={16} /> Restart
            </button>
          </>
        )}
      </div>
    );
    return (
      <div className="gb-center">
        <div className="gb-cell left">
          <div className="gb-pilewrap">
            <div
              ref={pileRef}
              className={'gb-pile' + (drawGlow ? ' grab glow' : '')}
              onPointerDown={drawGlow ? onPileDown : undefined}
            >
              <span className="gb-pcard" />
              <span className="gb-pcard" />
              <span className="gb-pcard top">
                <Skyline n={9} />
                <span style={{ fontSize: 22, fontWeight: 800 }}>?</span>
                <Skyline n={9} flipped />
              </span>
            </div>
            <span className="gb-pilecount">{state.pile.length} left</span>
            {pendingBuy > 0 ? (
              <span className="gb-buybar">
                {[0, 1, 2].map((i) => (
                  <i key={i} className={i < pendingBuy ? 'on' : ''} />
                ))}
              </span>
            ) : (
              <span className="gb-buybar" style={{ visibility: 'hidden' }}>
                <i />
              </span>
            )}
          </div>
        </div>

        <div className="gb-cell mid">
          {audioBlock(true)}
          <div
            ref={mysteryRef}
            className={
              'gb-mystery' +
              (!mysteryAway && state.phase === 'turn' ? ' grab' : '') +
              (mysteryAway ? ' away' : '') +
              (pulse ? ' pulse' : '')
            }
            onPointerDown={state.phase === 'turn' && state.current ? onMysteryDown : undefined}
          >
            <Skyline n={11} />
            <span className="gb-q">?</span>
            <Skyline n={11} flipped />
          </div>
          {audioBlock(false)}
        </div>

        <div className="gb-cell right">
          <div className="gb-supplywrap">
            <div className={'gb-supply' + (bonusOpen ? ' glow' : '')}>
              {Array.from({ length: 8 }, (_, i) => (
                <span key={i} className="gb-token grab" onPointerDown={onSupplyDown}>
                  <img className="gb-tokimg" src={mark} alt="" draggable="false" />
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === 'over') {
    return (
      <div className="gb-board">
        <div className="gb-edge top on" />
        <div className="gb-edge bottom on" />
        <div className="game-mid" style={{ margin: 'auto', maxWidth: 920 }}>
          <h2>{state.winner === 'draw' ? "It's a draw" : `${state.teams[state.winner].name} wins!`}</h2>
          {[0, 1].map((team) => (
            <div key={team} className="gb-tlrow">
              {state.teams[team].cards.map((c, i) => (
                <BoardCard key={i} c={c} />
              ))}
            </div>
          ))}
          <div className="play-row">
            <button className="primary" onClick={onPlayAgain}>
              Play again
            </button>
            <button className="ghost" onClick={onNewGame}>
              New game
            </button>
          </div>
        </div>
        <ThemeToggle theme={theme} className="gb-theme" />
        <button className="play-ic ink gb-exit" title="Exit" onClick={doExit}>
          <Icon d={ICONS.close} size={24} />
        </button>
      </div>
    );
  }

  return (
    <div className="gb-board">
      <div className={'gb-edge top' + (state.turn === 1 ? ' on' : '')} />
      <div className={'gb-edge bottom' + (state.turn === 0 ? ' on' : '')} />
      {renderZone(1, true)}
      {renderCenter()}
      {renderZone(0, false)}
      <ThemeToggle theme={theme} className="gb-theme" />
      <button className="play-ic ink gb-exit" title="Exit" onClick={doExit}>
        <Icon d={ICONS.close} size={24} />
      </button>
    </div>
  );
}

export default function GameScreen({ token, theme, onExit }) {
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
    return () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  const [saved] = useState(loadSaved);
  const [screen, setScreen] = useState(saved ? 'resume' : 'setup');
  const [initial, setInitial] = useState(saved);
  const [mountKey, setMountKey] = useState(0);

  const [decks] = useState(listGameDecks);
  const [deckRef, setDeckRef] = useState(null);
  const [deckTracks, setDeckTracks] = useState(null);
  const [deckMeta, setDeckMeta] = useState(null);
  const [loadingDeck, setLoadingDeck] = useState(false);
  const [name1, setName1] = useState('Team 1');
  const [name2, setName2] = useState('Team 2');
  const [target, setTarget] = useState(10);
  const [source, setSource] = useState(() =>
    token && localStorage.getItem('flutster_playsrc') === 'spotify' ? 'spotify' : 'preview'
  );
  const [err, setErr] = useState('');

  async function pickDeck(ref) {
    setDeckRef(ref);
    setDeckTracks(null);
    setDeckMeta(null);
    setErr('');
    setLoadingDeck(true);
    try {
      const d = await loadGameDeck(ref);
      if (d.tracks.length < 2) setErr('This deck needs at least 2 songs with a known year.');
      setDeckTracks(d.tracks);
      setDeckMeta({ name: d.name, dropped: d.dropped });
    } catch {
      setErr('Could not load this deck.');
    } finally {
      setLoadingDeck(false);
    }
  }

  function buildInitial(tracks) {
    const shuffled = shuffle(tracks);
    let s = newGame({ tracks: shuffled, names: [name1.trim() || 'Team 1', name2.trim() || 'Team 2'], target });
    s = gameReducer(s, { type: 'draw' });
    return s;
  }

  function start() {
    if (!deckTracks || deckTracks.length < 2) return;
    try {
      localStorage.setItem('flutster_playsrc', source);
    } catch {}
    setInitial(buildInitial(deckTracks));
    setMountKey((k) => k + 1);
    setScreen('game');
  }

  function newGameFromOver() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setInitial(null);
    setScreen('setup');
  }

  function playAgain() {
    if (!deckTracks) {
      newGameFromOver();
      return;
    }
    setInitial(buildInitial(deckTracks));
    setMountKey((k) => k + 1);
    setScreen('game');
  }

  if (screen === 'resume') {
    return (
      <div className="gameroot">
        <div className="pm-a">
          <button className="play-ic ink pm-close" title="Close" onClick={onExit}>
            <Icon d={ICONS.close} size={26} />
          </button>
          <ThemeToggle theme={theme} className="pm-theme" />
          <div className="pm-a-mid">
            <h2>Resume your game?</h2>
            <p className="pm-lede">You left a game in progress.</p>
            <div className="pm-cards">
              {/* Resume: the board you left, mid-play */}
              <button className="pm-card a" onClick={() => setScreen('game')}>
                <span className="pm-preview">
                  <span className="pm-resumewrap">
                    <span className="pm-board" aria-hidden="true">
                      <span className="pm-brow top">
                        {['--dec00', '--dec90', '--dec70'].map((c, i) => (
                          <i key={i} className="pm-mcard" style={{ '--mc': `var(${c})` }} />
                        ))}
                      </span>
                      <span className="pm-bcenter">
                        <span className="pm-mystery">?</span>
                      </span>
                      <span className="pm-brow bot">
                        {['--dec80', '--dec60', '--dec10'].map((c, i) => (
                          <i key={i} className="pm-mcard" style={{ '--mc': `var(${c})` }} />
                        ))}
                      </span>
                    </span>
                    <span className="pm-playbadge" aria-hidden="true">
                      <Icon d={ICONS.play} size={16} />
                    </span>
                  </span>
                </span>
                <span className="pm-meta">
                  <span className="pm-t">Resume</span>
                  <span className="pm-s">Pick up where you left off</span>
                </span>
              </button>

              {/* New game: fresh two-team setup */}
              <button className="pm-card b" onClick={newGameFromOver}>
                <span className="pm-preview">
                  <span className="pm-setupmini" aria-hidden="true">
                    <span className="sh a">
                      <span className="dot" />
                      <span className="line" />
                    </span>
                    <span className="seam" />
                    <span className="sh b">
                      <span className="dot" />
                      <span className="line" />
                    </span>
                  </span>
                </span>
                <span className="pm-meta">
                  <span className="pm-t">New game</span>
                  <span className="pm-s">Start fresh</span>
                </span>
              </button>
            </div>
          </div>
          <div className="pm-floor" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (screen === 'setup') {
    return (
      <SetupScreen
        onExit={onExit}
        theme={theme}
        decks={decks}
        deckRef={deckRef}
        onPickDeck={pickDeck}
        deckMeta={deckMeta}
        loadingDeck={loadingDeck}
        err={err}
        name1={name1}
        setName1={setName1}
        name2={name2}
        setName2={setName2}
        target={target}
        setTarget={setTarget}
        source={source}
        setSource={setSource}
        token={token}
        canStart={!!deckTracks && deckTracks.length >= 2}
        onStart={start}
      />
    );
  }

  return (
    <GamePlay
      key={mountKey}
      initial={initial}
      token={token}
      source={source}
      theme={theme}
      onExit={onExit}
      onPlayAgain={playAgain}
      onNewGame={newGameFromOver}
    />
  );
}
