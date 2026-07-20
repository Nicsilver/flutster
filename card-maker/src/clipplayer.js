// Preview audio is a two-stage engine. An <audio> element goes first: it is
// what iPhones need (WebAudio is silenced by the physical mute switch, media
// elements are not). If the element's pipeline never produces data (some
// desktop setups refuse the audio/x-m4p clips), the same bytes are fetched
// and decoded through WebAudio instead, which handles them everywhere.

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

// Hybrid player state: { mode: 'el'|'wa', el, ctx, buf, src, startedAt }.
export function createClipPlayer() {
  const p = { mode: '' };

  function waStart(offset) {
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

  async function start(url) {
    // Stage 1: media element (iPhone-safe; ignores the mute switch).
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

  function stop() {
    p.el?.pause();
    p.el?.removeAttribute('src');
    try {
      p.src?.stop();
    } catch {}
    p.src = null;
    p.ctx?.resume().catch(() => {});
  }

  function pause() {
    if (p.mode === 'el') p.el.pause();
    else if (p.mode === 'wa') p.ctx.suspend().catch(() => {});
  }

  function resume() {
    if (p.mode === 'el') p.el.play().catch(() => {});
    else if (p.mode === 'wa') p.ctx.resume().catch(() => {});
  }

  // wasPaused: whether playback was paused before the restart — only then
  // does the element/context need an explicit nudge back into motion (a
  // WebAudio buffer source can't be seeked, so waStart(0) always re-creates
  // it regardless of paused state).
  function restart(wasPaused) {
    if (p.mode === 'el') {
      p.el.currentTime = 0;
      if (wasPaused) p.el.play().catch(() => {});
    } else if (p.mode === 'wa') {
      waStart(0);
      if (wasPaused) p.ctx.resume().catch(() => {});
    }
  }

  function tapPlay() {
    if (p.mode === 'el') p.el.play().catch(() => {});
    else p.ctx?.resume().catch(() => {});
  }

  function position() {
    if (p.mode === 'el' && p.el) return p.el.currentTime;
    if (p.mode === 'wa' && p.buf) return Math.max(0, (p.ctx.currentTime - p.startedAt) % p.buf.duration);
    return 0;
  }

  function dispose() {
    stop();
    p.ctx?.close().catch(() => {});
  }

  return {
    start,
    stop,
    pause,
    resume,
    restart,
    tapPlay,
    position,
    dispose,
    get mode() {
      return p.mode;
    },
  };
}
