import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { parseTrackIds, playTrack, resumePlayback, pausePlayback, seekPlayback } from './spotify.js';
import { resolveMeta } from './meta.js';
import { findPreviewUrl } from './previews.js';

// Blind scan-and-play, in the browser: point the camera at a card and the
// song plays with the answer hidden, like the phone app. Two sources:
// previews (30s iTunes clips, no accounts) and Spotify (full songs on the
// user's active device; needs the main page's login + Premium).
//
// Previews play through WebAudio (fetch -> decodeAudioData -> buffer source)
// rather than an <audio> element: the clips are served as audio/x-m4p, which
// some media pipelines refuse to even probe, while decodeAudioData handles
// them fine. Suspending the AudioContext doubles as a pause clock.
export default function PlayScreen({ token, onExit }) {
  // scan | resolving | tap | playing | miss | error
  const [phase, setPhase] = useState('scan');
  const [source, setSource] = useState(() =>
    token && localStorage.getItem('flutster_playsrc') === 'spotify' ? 'spotify' : 'preview'
  );
  const [msg, setMsg] = useState('');
  const [paused, setPaused] = useState(false);
  const [sec, setSec] = useState(0);
  const [camErr, setCamErr] = useState('');
  const videoRef = useRef(null);
  const engineRef = useRef(null); // { ctx, buf, src, startedAt }
  const busyRef = useRef(false);
  const uriRef = useRef('');

  function pickSource(s) {
    setSource(s);
    localStorage.setItem('flutster_playsrc', s);
  }

  async function loadClip(url) {
    const buf = await Promise.race([
      fetch(url).then((r) => {
        if (!r.ok) throw new Error('CLIP');
        return r.arrayBuffer();
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CLIP')), 15000)),
    ]);
    const ctx =
      engineRef.current?.ctx || new (window.AudioContext || window.webkitAudioContext)();
    const audioBuf = await ctx.decodeAudioData(buf);
    engineRef.current = { ctx, buf: audioBuf, src: null, startedAt: 0 };
  }

  function startSrc(offset = 0) {
    const e = engineRef.current;
    if (!e) return;
    try {
      e.src?.stop();
    } catch {}
    const src = e.ctx.createBufferSource();
    src.buffer = e.buf;
    src.loop = true;
    src.connect(e.ctx.destination);
    src.start(0, offset % e.buf.duration);
    e.src = src;
    e.startedAt = e.ctx.currentTime - offset;
  }

  function stopSrc() {
    const e = engineRef.current;
    try {
      e?.src?.stop();
    } catch {}
    if (e) e.src = null;
  }

  async function onScan(text) {
    if (busyRef.current) return;
    const id = parseTrackIds(text)[0];
    if (!id) return;
    busyRef.current = true;
    uriRef.current = `spotify:track:${id}`;
    setMsg('');
    setSec(0);
    setPaused(false);
    setPhase('resolving');
    try {
      if (source === 'spotify' && token) {
        await playTrack(uriRef.current, token);
        setPhase('playing');
      } else {
        const meta = await resolveMeta(id);
        if (!meta) throw new Error('META');
        const url = await findPreviewUrl({ uri: uriRef.current, title: meta.title, artist: meta.artist });
        if (!url) {
          setPhase('miss');
          busyRef.current = false;
          return;
        }
        await loadClip(url);
        startSrc(0);
        const ctx = engineRef.current.ctx;
        if (ctx.state === 'suspended') {
          // Autoplay policy: the context only starts after a user gesture.
          await ctx.resume().catch(() => {});
          if (ctx.state === 'suspended') {
            setPhase('tap');
            busyRef.current = false;
            return;
          }
        }
        setPhase('playing');
      }
    } catch (e) {
      setMsg(
        e.message === 'NO_DEVICE'
          ? 'No active Spotify device. Open Spotify anywhere, play and pause any song once, then rescan.'
          : e.message === 'PREMIUM'
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
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
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
          const w = 480;
          const h = Math.round((video.videoHeight / video.videoWidth) * w) || 360;
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

  // Stopwatch while playing. The AudioContext clock freezes on suspend, so
  // preview position stays honest through pauses for free.
  useEffect(() => {
    if (phase !== 'playing') return;
    const t = setInterval(() => {
      const e = engineRef.current;
      if (source === 'preview' && e?.buf) {
        setSec(Math.max(0, (e.ctx.currentTime - e.startedAt) % e.buf.duration));
      } else {
        setSec((s) => (paused ? s : s + 0.5));
      }
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

  // Silence and release the audio pipeline when the screen unmounts.
  useEffect(() => {
    return () => {
      stopSrc();
      engineRef.current?.ctx.close().catch(() => {});
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePause() {
    if (source === 'spotify' && token) {
      paused ? resumePlayback(token).catch(() => {}) : pausePlayback(token);
    } else {
      const e = engineRef.current;
      if (e) paused ? e.ctx.resume().catch(() => {}) : e.ctx.suspend().catch(() => {});
    }
    setPaused(!paused);
  }

  function restart() {
    if (source === 'spotify' && token) {
      seekPlayback(0, token);
      if (paused) resumePlayback(token).catch(() => {});
    } else {
      startSrc(0);
      if (paused) engineRef.current?.ctx.resume().catch(() => {});
    }
    setSec(0);
    setPaused(false);
  }

  function guess() {
    if (source === 'spotify' && token) pausePlayback(token);
    stopSrc();
    engineRef.current?.ctx.resume().catch(() => {});
    setPhase('scan');
  }

  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s) % 60).padStart(2, '0')}`;

  return (
    <div className="play fade-in">
      <div className="play-top">
        <button className="ghost sm" onClick={() => { guess(); onExit(); }}>‹ Card maker</button>
        <span className="grow" />
        <div className="play-src">
          <button
            className={'src-pill' + (source === 'preview' ? ' on' : '')}
            onClick={() => pickSource('preview')}
          >
            30s previews
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
      </div>

      {phase === 'scan' && (
        <div className="play-stage">
          {camErr ? (
            <p className="error">{camErr}</p>
          ) : (
            <div className="cam-wrap">
              <video ref={videoRef} playsInline muted />
              <div className="cam-frame" />
            </div>
          )}
          <p className="play-hint">
            Point at a card.{' '}
            {source === 'preview'
              ? 'A 30 second clip plays with the answer hidden. No accounts needed.'
              : 'The full song plays on your active Spotify device.'}
          </p>
        </div>
      )}

      {phase === 'resolving' && (
        <div className="play-stage center">
          <div className="play-spin" />
          <h2>Finding the song…</h2>
        </div>
      )}

      {phase === 'tap' && (
        <div className="play-stage center">
          <button
            className="tap-play"
            onClick={() => {
              engineRef.current?.ctx.resume().catch(() => {});
              setPhase('playing');
            }}
          >
            ▶
          </button>
          <h2>Tap to play</h2>
        </div>
      )}

      {phase === 'playing' && (
        <div className="play-stage center">
          <div className="play-note">♪</div>
          <h2>Guess the year</h2>
          {source === 'preview' && <p className="play-sub">30 second preview</p>}
          <div className="play-time">{fmt(sec)}</div>
          <div className="play-ctl">
            <button className="ctl" onClick={togglePause} aria-label={paused ? 'Play' : 'Pause'}>
              {paused ? '▶' : '⏸'}
            </button>
            <button className="ctl sm" onClick={restart} aria-label="Restart">
              ↺
            </button>
          </div>
          <button className="guess-btn" onClick={guess}>GUESS</button>
        </div>
      )}

      {phase === 'miss' && (
        <div className="play-stage center">
          <div className="play-note off">♪</div>
          <h2>No preview for this one</h2>
          <p className="play-sub">Put the card back and draw another.</p>
          <button className="guess-btn" onClick={guess}>SCAN NEXT</button>
        </div>
      )}

      {phase === 'error' && (
        <div className="play-stage center">
          <h2>Hmm.</h2>
          <p className="play-sub">{msg}</p>
          <button className="guess-btn" onClick={guess}>SCAN AGAIN</button>
        </div>
      )}
    </div>
  );
}
