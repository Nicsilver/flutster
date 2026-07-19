import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { parseTrackIds, playTrack, resumePlayback, pausePlayback, seekPlayback, fetchDevices, transferPlayback } from './spotify.js';
import { resolveMeta } from './meta.js';
import { findPreviewUrl } from './previews.js';
import { loadSources, saveSources, tryParseCard, resolveCard, loadAllSources, invalidateSources, cardCount } from './decksources.js';

// Blind scan-and-play in the browser, mirroring the phone app's look: full
// screen camera, then a paper guess screen with no title or artist shown.
//
// Preview audio is a two-stage engine. An <audio> element goes first: it is
// what iPhones need (WebAudio is silenced by the physical mute switch, media
// elements are not). If the element's pipeline never produces data (some
// desktop setups refuse the audio/x-m4p clips), the same bytes are fetched
// and decoded through WebAudio instead, which handles them everywhere.
const ICONS = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  replay: 'M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  gear: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  note: 'M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z',
  rew: 'M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z',
  fwd: 'M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z',
};

function Icon({ d, size = 24 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path fill="currentColor" d={d} />
    </svg>
  );
}

export default function PlayScreen({ token, onExit }) {
  // scan | resolving | tap | playing | miss | nodevice | error
  const [phase, setPhase] = useState('scan');
  // Game-night immersion: go fullscreen on touch devices (hides the status
  // bar and browser chrome on Android; iOS Safari has no fullscreen API for
  // pages, so this silently no-ops there). Works when /play is entered via a
  // tap (transient activation); a cold URL load stays windowed.
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.catch(() => {});
    return () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);
  const [source, setSource] = useState(() =>
    token && localStorage.getItem('flutster_playsrc') === 'spotify' ? 'spotify' : 'preview'
  );
  const [msg, setMsg] = useState('');
  const [paused, setPaused] = useState(false);
  const [sec, setSec] = useState(0);
  const [camErr, setCamErr] = useState('');
  const [srcOpen, setSrcOpen] = useState(false);
  const [sources, setSources] = useState(loadSources);
  const [deckCards, setDeckCards] = useState(0);
  const [newSrc, setNewSrc] = useState('');
  const videoRef = useRef(null);
  const busyRef = useRef(false);
  const uriRef = useRef('');
  // Hybrid player: { mode: 'el'|'wa', el, ctx, buf, src, startedAt }
  const playerRef = useRef({ mode: '' });

  function pickSource(s) {
    setSource(s);
    localStorage.setItem('flutster_playsrc', s);
  }

  // Deck databases load in the background so number-cards resolve instantly.
  useEffect(() => {
    let gone = false;
    loadAllSources().then((n) => {
      if (!gone) setDeckCards(n);
    });
    return () => {
      gone = true;
    };
  }, [sources]);

  function elResult(a) {
    return new Promise((resolve) => {
      let done = false;
      let graceTimer;
      const finish = (v) => {
        if (done) return;
        done = true;
        a.removeEventListener('playing', onOk);
        a.removeEventListener('error', onBad);
        clearTimeout(graceTimer);
        resolve(v);
      };
      const onOk = () => finish('playing');
      const onBad = () => finish('fallback');
      a.addEventListener('playing', onOk);
      a.addEventListener('error', onBad);
      // A pipeline that has produced no data after 4s is considered broken
      // (that is the failure shape, not slow networks: the bytes fetch in
      // well under a second); one that has data gets more time.
      graceTimer = setTimeout(() => {
        if (a.readyState >= 1) graceTimer = setTimeout(() => finish('fallback'), 8000);
        else finish('fallback');
      }, 4000);
      a.play()
        .then(() => finish('playing'))
        .catch((e) => finish(e.name === 'NotAllowedError' ? 'tap' : 'fallback'));
    });
  }

  async function startPreview(url) {
    // Stage 1: media element (iPhone-safe; ignores the mute switch).
    const p = playerRef.current;
    if (!p.el) {
      p.el = new Audio();
      p.el.loop = true;
    }
    p.mode = 'el';
    p.el.src = url;
    const r1 = await elResult(p.el);
    if (r1 === 'playing') return 'playing';
    if (r1 === 'tap') return 'tap';
    // Stage 2: WebAudio (decodes clips some media pipelines refuse).
    try {
      p.el.pause();
      p.el.removeAttribute('src');
      const buf = await Promise.race([
        fetch(url).then((r) => {
          if (!r.ok) throw new Error('CLIP');
          return r.arrayBuffer();
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('CLIP')), 15000)),
      ]);
      const ctx = p.ctx || new (window.AudioContext || window.webkitAudioContext)();
      p.ctx = ctx;
      p.buf = await ctx.decodeAudioData(buf);
      p.mode = 'wa';
      waStart(0);
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
        if (ctx.state === 'suspended') return 'tap';
      }
      return 'playing';
    } catch {
      return 'error';
    }
  }

  function waStart(offset) {
    const p = playerRef.current;
    try {
      p.src?.stop();
    } catch {}
    const src = p.ctx.createBufferSource();
    src.buffer = p.buf;
    src.loop = true;
    src.connect(p.ctx.destination);
    src.start(0, offset % p.buf.duration);
    p.src = src;
    p.startedAt = p.ctx.currentTime - offset;
  }

  function stopClip() {
    const p = playerRef.current;
    p.el?.pause();
    p.el?.removeAttribute('src');
    try {
      p.src?.stop();
    } catch {}
    p.src = null;
    p.ctx?.resume().catch(() => {});
  }

  async function onScan(text) {
    if (busyRef.current) return;
    let id = parseTrackIds(text)[0];
    let known = null;
    if (!id) {
      const card = tryParseCard(text);
      if (!card) return;
      busyRef.current = true;
      setMsg('');
      setPhase('resolving');
      await loadAllSources().then(setDeckCards);
      const hit = resolveCard(card);
      if (!hit) {
        setMsg(
          loadSources().length === 0
            ? `This card carries a number (${card.deck}/${card.number}), not a song link. Add a deck database under Sources (the gear icon) to play decks like this.`
            : `Card ${card.deck}/${card.number} is not in your deck sources.`
        );
        setPhase('error');
        busyRef.current = false;
        return;
      }
      id = hit.uri.split(':').pop();
      known = hit.title ? hit : null;
      busyRef.current = false;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    uriRef.current = `spotify:track:${id}`;
    setMsg('');
    setSec(0);
    setPaused(false);
    setPhase('resolving');
    try {
      if (source === 'spotify' && token) {
        try {
          await playTrack(uriRef.current, token);
        } catch (e) {
          if (e.message !== 'NO_DEVICE') throw e;
          // Spotify is often open somewhere but idle, which the play endpoint
          // treats as "no device". Wake the likeliest device and retry once;
          // only give up when the account truly has no device online.
          const devices = await fetchDevices(token).catch(() => []);
          const dev = devices.find((d) => d.is_active) || devices[0];
          if (!dev) throw e;
          await transferPlayback(dev.id, token);
          await new Promise((r) => setTimeout(r, 700));
          await playTrack(uriRef.current, token);
        }
        setPhase('playing');
      } else {
        const meta = known || (await resolveMeta(id));
        if (!meta) throw new Error('META');
        const url = await findPreviewUrl({ uri: uriRef.current, title: meta.title, artist: meta.artist });
        if (!url) {
          setPhase('miss');
          busyRef.current = false;
          return;
        }
        const res = await startPreview(url);
        if (res === 'playing') setPhase('playing');
        else if (res === 'tap') setPhase('tap');
        else throw new Error('CLIP');
      }
    } catch (e) {
      if (e.message === 'NO_DEVICE') {
        setPhase('nodevice');
        busyRef.current = false;
        return;
      }
      setMsg(
        e.message === 'PREMIUM'
          ? 'Full-song playback needs Spotify Premium. Switch to previews above.'
          : e.message === 'AUTH'
          ? 'Spotify login expired. Log in again from the card maker, then come back.'
          : e.message === 'META'
          ? 'Could not identify this card. Check your connection and rescan.'
          : 'The clip failed to load. Check your connection and rescan.'
      );
      setPhase('error');
    }
    busyRef.current = false;
  }

  // Camera + scan loop, alive only on the scan screen. Native BarcodeDetector
  // where it exists (Android Chrome), jsQR canvas fallback elsewhere (iOS).
  useEffect(() => {
    if (phase !== 'scan') return;
    let stream;
    let timer;
    let detector;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    (async () => {
      try {
        // Without explicit resolution browsers default to 640×480, which
        // looks far worse than the app's camera and decodes worse too.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        // Close-range QR needs continuous focus where the camera supports it.
        stream.getVideoTracks()[0]
          ?.applyConstraints({ advanced: [{ focusMode: 'continuous' }] })
          .catch(() => {});
      } catch {
        setCamErr('Camera access is needed to scan cards. Allow it in the browser and reload.');
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      if ('BarcodeDetector' in window) {
        try {
          detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch {}
      }
      timer = setInterval(async () => {
        if (stopped || busyRef.current || !video.videoWidth) return;
        let text = '';
        if (detector) {
          try {
            const codes = await detector.detect(video);
            text = codes[0]?.rawValue || '';
          } catch {}
        } else {
          // 800 px keeps jsQR fast (~0.5 MP per pass) while leaving enough
          // pixels to read a card-sized QR at arm's length.
          const w = Math.min(800, video.videoWidth || 800);
          const h = Math.round((video.videoHeight / video.videoWidth) * w) || 600;
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          text = jsQR(img.data, w, h)?.data || '';
        }
        if (text) onScan(text);
      }, 300);
    })();
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, source, token]);

  // Position clock while playing.
  useEffect(() => {
    if (phase !== 'playing') return;
    const t = setInterval(() => {
      const p = playerRef.current;
      if (source === 'preview' && p.mode === 'el' && p.el) setSec(p.el.currentTime);
      else if (source === 'preview' && p.mode === 'wa' && p.buf) {
        setSec(Math.max(0, (p.ctx.currentTime - p.startedAt) % p.buf.duration));
      } else setSec((s) => (paused ? s : s + 0.5));
    }, 500);
    return () => clearInterval(t);
  }, [phase, paused, source]);

  // Test hook: lets an automated check inject a scan without a camera.
  useEffect(() => {
    window.flutsterScan = (t) => onScan(t);
    return () => {
      delete window.flutsterScan;
    };
  });

  useEffect(() => {
    return () => {
      stopClip();
      playerRef.current.ctx?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePause() {
    const p = playerRef.current;
    if (source === 'spotify' && token) {
      paused ? resumePlayback(token).catch(() => {}) : pausePlayback(token);
    } else if (p.mode === 'el') {
      paused ? p.el.play().catch(() => {}) : p.el.pause();
    } else if (p.mode === 'wa') {
      paused ? p.ctx.resume().catch(() => {}) : p.ctx.suspend().catch(() => {});
    }
    setPaused(!paused);
  }

  // Full songs only: the position clock is our own stopwatch, same
  // extrapolation the app uses.
  function seekBy(delta) {
    const target = Math.max(0, sec + delta);
    seekPlayback(Math.round(target * 1000), token);
    setSec(target);
  }

  function restart() {
    const p = playerRef.current;
    if (source === 'spotify' && token) {
      seekPlayback(0, token);
      if (paused) resumePlayback(token).catch(() => {});
    } else if (p.mode === 'el') {
      p.el.currentTime = 0;
      if (paused) p.el.play().catch(() => {});
    } else if (p.mode === 'wa') {
      waStart(0);
      if (paused) p.ctx.resume().catch(() => {});
    }
    setSec(0);
    setPaused(false);
  }

  function tapPlay() {
    const p = playerRef.current;
    if (p.mode === 'el') p.el.play().catch(() => {});
    else p.ctx?.resume().catch(() => {});
    setPhase('playing');
  }

  function guess() {
    if (source === 'spotify' && token) pausePlayback(token);
    stopClip();
    setPhase('scan');
  }

  // Keyboard controls for laptop play: space = the primary action (guess /
  // tap to play / scan again), left-right = 15s seek (full songs only),
  // up-down = pause. Re-registered each render so the handlers see fresh
  // state; skipped while typing in a field.
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'Space') {
        if (phase === 'playing' || phase === 'miss' || phase === 'error' || phase === 'nodevice') guess();
        else if (phase === 'tap') tapPlay();
        else return;
        e.preventDefault();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (phase !== 'playing' || source !== 'spotify' || !token) return;
        seekBy(e.key === 'ArrowLeft' ? -15 : 15);
        e.preventDefault();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (phase !== 'playing') return;
        togglePause();
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function addSource() {
    const v = newSrc.trim();
    if (!v) return;
    const next = [...sources.filter((s) => s !== v), v];
    saveSources(next);
    invalidateSources();
    setSources(next);
    setNewSrc('');
  }

  function removeSource(url) {
    const next = sources.filter((s) => s !== url);
    saveSources(next);
    invalidateSources();
    setSources(next);
  }

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;
  const onCamera = phase === 'scan' && !camErr;

  return (
    <div className={'playroot' + (onCamera ? ' oncam' : '')}>
      {phase === 'scan' && (
        <div className="play-cam">
          {!camErr && <video ref={videoRef} playsInline muted />}
          <div className="play-overlay">
            <div className="play-head">
              <span className="play-brand">Flutster</span>
              <span className="grow" />
              <div className="play-src">
                <button
                  className={'src-pill' + (source === 'preview' ? ' on' : '')}
                  onClick={() => pickSource('preview')}
                >
                  Previews
                </button>
                <button
                  className={'src-pill' + (source === 'spotify' ? ' on' : '')}
                  disabled={!token}
                  title={token ? 'Full songs on your active Spotify device' : 'Log in on the card maker first'}
                  onClick={() => pickSource('spotify')}
                >
                  Spotify
                </button>
              </div>
              <button className="play-ic" title="Deck sources" onClick={() => setSrcOpen(true)}>
                <Icon d={ICONS.gear} size={22} />
              </button>
              <button className="play-ic" title="Back to the card maker" onClick={() => { guess(); onExit(); }}>
                <Icon d={ICONS.close} size={22} />
              </button>
            </div>
            {camErr ? (
              <p className="play-camerr">{camErr}</p>
            ) : (
              <>
                <div className="cam-frame" />
                <p className="play-point">Point at a music card</p>
              </>
            )}
          </div>
        </div>
      )}

      {phase !== 'scan' && (
        <div className="play-paper">
          <div className="play-head">
            <button className="play-ic ink" title="Back to scanning" onClick={guess}>
              <Icon d={ICONS.close} size={26} />
            </button>
            <span className="grow" />
          </div>

          {phase === 'resolving' && (
            <div className="play-mid">
              <div className="play-spin" />
              <h2>Finding the song…</h2>
            </div>
          )}

          {phase === 'tap' && (
            <div className="play-mid">
              <button className="tap-play" onClick={tapPlay}>
                <Icon d={ICONS.play} size={52} />
              </button>
              <h2>Tap to play</h2>
            </div>
          )}

          {phase === 'playing' && (
            <>
              <div className="play-mid">
                <span className="play-noteic">
                  <Icon d={ICONS.note} size={120} />
                </span>
                <h2 className="play-big">Guess the year</h2>
                {source === 'preview' && <p className="play-sub">30 second preview</p>}
                <div className="play-time">{fmt(sec)}</div>
                <div className="play-row">
                  {source === 'spotify' && token && (
                    <button className="ctl side" onClick={() => seekBy(-15)} aria-label="Back 15 seconds" title="Back 15s">
                      <Icon d={ICONS.rew} size={34} />
                    </button>
                  )}
                  <button className="ctl" onClick={togglePause} aria-label={paused ? 'Play' : 'Pause'}>
                    <Icon d={paused ? ICONS.play : ICONS.pause} size={44} />
                  </button>
                  {source === 'spotify' && token && (
                    <button className="ctl side" onClick={() => seekBy(15)} aria-label="Forward 15 seconds" title="Forward 15s">
                      <Icon d={ICONS.fwd} size={34} />
                    </button>
                  )}
                </div>
                <button className="play-restart" onClick={restart}>
                  <Icon d={ICONS.replay} size={22} /> Restart
                </button>
              </div>
              <div className="play-foot">
                <button className="guess-btn" onClick={guess}>GUESS</button>
              </div>
            </>
          )}

          {phase === 'miss' && (
            <>
              <div className="play-mid">
                <span className="play-noteic dim">
                  <Icon d={ICONS.note} size={120} />
                </span>
                <h2>No preview for this one</h2>
                <p className="play-sub">Put the card back and draw another.</p>
              </div>
              <div className="play-foot">
                <button className="guess-btn" onClick={guess}>SCAN NEXT</button>
              </div>
            </>
          )}

          {phase === 'nodevice' && (
            <>
              <div className="play-mid">
                <h2>Wake up Spotify</h2>
                <p className="play-sub">
                  Flutster plays through your Spotify app, and Spotify isn&rsquo;t running
                  anywhere right now. Takes ten seconds to fix:
                </p>
                <ol className="play-steps">
                  <li>Open the <b>Spotify app</b> on this phone, a computer, or a speaker.</li>
                  <li>Play <b>any song</b> for a moment, then pause it.</li>
                  <li>Come back here and scan the card again.</li>
                </ol>
                <a className="play-openapp" href="spotify:">Open Spotify</a>
              </div>
              <div className="play-foot">
                <button className="guess-btn" onClick={guess}>SCAN AGAIN</button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <>
              <div className="play-mid">
                <h2>Hmm.</h2>
                <p className="play-sub">{msg}</p>
              </div>
              <div className="play-foot">
                <button className="guess-btn" onClick={guess}>SCAN AGAIN</button>
              </div>
            </>
          )}
        </div>
      )}

      {srcOpen && (
        <div className="rvm-back" onClick={() => setSrcOpen(false)} role="dialog" aria-modal="true" aria-label="Deck sources">
          <div className="play-sheet" onClick={(e) => e.stopPropagation()}>
            <h3>Deck sources</h3>
            <p>
              For cards that carry a card number instead of a song link (official Hitster-style
              decks): add a deck database URL that maps card numbers to tracks. Flutster ships no
              deck data; search the web for your gameset&rsquo;s database.
            </p>
            {sources.map((s) => (
              <div className="play-srcrow" key={s}>
                <code>{s}</code>
                <button className="play-ic ink" title="Remove" onClick={() => removeSource(s)}>
                  <Icon d={ICONS.close} size={18} />
                </button>
              </div>
            ))}
            <div className="play-srcadd">
              <input
                placeholder="https://…/database.json"
                value={newSrc}
                onChange={(e) => setNewSrc(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addSource()}
              />
              <button className="primary sm-cta" disabled={!newSrc.trim()} onClick={addSource}>
                Add
              </button>
            </div>
            <div className="play-srcfoot">
              <span className="hintline">
                {deckCards > 0 ? `${deckCards.toLocaleString()} cards loaded` : 'No cards loaded'}
              </span>
              <span className="grow" />
              <button className="ghost sm" onClick={() => setSrcOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
