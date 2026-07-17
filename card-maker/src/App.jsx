import { useEffect, useMemo, useRef, useState } from 'react';
import { login, logout, handleRedirect, fetchPlaylist, fetchMyPlaylists, redirectUri, getClientId, setClientId, parsePlaylistId } from './spotify.js';
import { verifyYears, saveOverride, plausibleYear } from './years.js';
import { makeFrontsPdf, makeBacksPdf, estimatePerPage } from './pdf.js';
import { cardColors, rz, INK } from './cardstyle.js';

const A4_W = 210; // mm — page width drives the auto card size

const pad2 = (y) => String(y % 100).padStart(2, '0');

// Decade buckets drive all color in the UI: index into DEC_CLASSES/DEC_VARS.
const DEC_CLASSES = ['dec60', 'dec70', 'dec80', 'dec90', 'dec00', 'dec10'];
const DEC_VARS = ['--dec60', '--dec70', '--dec80', '--dec90', '--dec00', '--dec10'];
const DEC_LABELS = ['’60s', '’70s', '’80s', '’90s', '’00s', '’10s+'];
function decIdx(year) {
  if (!year) return -1;
  if (year < 1970) return 0;
  if (year >= 2010) return 5;
  return Math.floor((year - 1970) / 10) + 1;
}
const decClass = (year) => DEC_CLASSES[decIdx(year)] || '';

// Decade fingerprints (the little era-mix bar under each playlist) need the
// tracks' years. They're lazy-loaded for every playlist in the background and
// cached as { [id]: { n: trackTotal, fp: [six counts] } } — n lets a changed
// playlist (different track total) invalidate its entry.
const FP_KEY = 'flutster_fp';
function loadFpMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(FP_KEY) || '{}');
    const out = {};
    for (const [id, v] of Object.entries(raw)) {
      // Migrate the first release's bare-array format; n:-1 forces a refresh.
      out[id] = Array.isArray(v) ? { n: -1, fp: v } : v;
    }
    return out;
  } catch {
    return {};
  }
}
function fingerprint(tracks) {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const t of tracks) {
    const i = decIdx(t.year);
    if (i >= 0) counts[i]++;
  }
  return counts;
}

// Track cache: skip re-fetching a playlist whose track total hasn't changed.
// The total is a cheap staleness proxy (edits that keep the count slip through
// until the count next changes — acceptable for a print tool).
const PL_KEY = 'flutster_playlists';
// Bump when the track tuple shape changes; v2 added the ISRC, which the year
// verifier needs — serving a pre-v2 entry silently downgrades every track to
// the slow iTunes fallback.
const PL_V = 3; // v3 added the compilation flag
function loadPlCache() {
  try {
    return JSON.parse(localStorage.getItem(PL_KEY) || '{}');
  } catch {
    return {};
  }
}
function plCacheGet(id, count) {
  const e = loadPlCache()[id];
  if (!e || e.v !== PL_V || count == null || e.count !== count) return null;
  return {
    name: e.name,
    tracks: e.tracks.map(([uri, title, artist, year, isrc, comp]) => ({ uri, title, artist, year, isrc: isrc || '', comp: !!comp })),
  };
}
function plCachePut(id, count, name, tracks) {
  if (count == null) return;
  const cache = loadPlCache();
  cache[id] = {
    v: PL_V,
    count,
    name,
    ts: Date.now(),
    // Cached years are Spotify's own (year0 when verification already ran) —
    // corrections re-apply from the flutster_years cache on every load.
    tracks: tracks.map((t) => [t.uri, t.title, t.artist, t.year0 ?? t.year, t.isrc || '', t.comp ? 1 : 0]),
  };
  const ids = Object.keys(cache);
  if (ids.length > 40) {
    ids.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
    for (const old of ids.slice(0, ids.length - 40)) delete cache[old];
  }
  try {
    localStorage.setItem(PL_KEY, JSON.stringify(cache));
  } catch {
    localStorage.removeItem(PL_KEY); // over quota: drop the cache, not the app
  }
}

// "Keep this guess" acknowledgements from the review modal, keyed by track
// uri → the year that was acknowledged. Only honored while the verdict still
// matches — a changed verdict re-flags the card.
const ACK_KEY = 'flutster_yearok';
function loadAcks() {
  try {
    return JSON.parse(localStorage.getItem(ACK_KEY) || '{}');
  } catch {
    return {};
  }
}

// Songs-per-year stats used by the timeline strip.
function yearStats(tracks) {
  const years = tracks.map((t) => t.year).filter((y) => y > 0);
  if (years.length < 2) return { dated: years.length };
  const minY = Math.min(...years);
  const maxY = Math.max(...years);
  const span = Math.max(1, maxY - minY);
  const counts = Array.from({ length: span + 1 }, (_, i) => ({ y: minY + i, c: 0 }));
  for (const y of years) counts[y - minY].c++;
  const maxC = Math.max(...counts.map((d) => d.c));
  const peak = counts.find((d) => d.c === maxC);
  return { dated: years.length, minY, maxY, span, counts, maxC, peak };
}

const SHUFFLE_ICON = (
  <svg className="st-ic" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 3h5v5" /><path d="M4 20 21 3" /><path d="M21 16v5h-5" /><path d="M15 15l6 6" /><path d="M4 4l5 5" />
  </svg>
);

// Light is the default; dark is a stored opt-in.
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('flutster_theme') || 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('flutster_theme', next);
    setTheme(next);
  };
  return { isDark: theme === 'dark', toggle };
}

export default function App() {
  const [clientId, setCid] = useState(getClientId());
  const [token, setToken] = useState(null);
  const [authError, setAuthError] = useState('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [playlist, setPlaylist] = useState(null);
  const [busy, setBusy] = useState('');
  const [myLists, setMyLists] = useState([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [fpMap, setFpMap] = useState(loadFpMap);
  const [verif, setVerif] = useState(null);
  const [acks, setAcks] = useState(loadAcks);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewUris, setReviewUris] = useState([]);
  const [printPop, setPrintPop] = useState(false);
  const [stripHidden, setStripHidden] = useState(false);
  const verifRun = useRef(0);
  const verifCtrl = useRef(null);
  const playlistRef = useRef(null);
  const theme = useTheme();
  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);

  const [perRow, setPerRow] = useState(3);
  const [cut, setCut] = useState(true);
  const [flip, setFlip] = useState('long');
  const [cardStyle, setCardStyle] = useState(() => localStorage.getItem('flutster_cardstyle') || 'color');
  const [capOn, setCapOn] = useState(false);
  const [capN, setCapN] = useState(2);
  const [railQuery, setRailQuery] = useState('');
  const [order, setOrder] = useState([]);
  const [excluded, setExcluded] = useState(new Set());
  const [sheetPage, setSheetPage] = useState(0);

  useEffect(() => {
    handleRedirect()
      .then((t) => setToken(t))
      .catch((e) => setAuthError(e.message));
  }, []);

  useEffect(() => {
    if (!token) return;
    setLoadingLists(true);
    fetchMyPlaylists(token)
      .then(setMyLists)
      .catch(() => {})
      .finally(() => setLoadingLists(false));
  }, [token]);

  // Lazy-load a fingerprint for every playlist. Sequential on purpose — this
  // walks each playlist's full track list, so keep it gentle on the rate limit.
  useEffect(() => {
    if (!token || myLists.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const pl of myLists) {
        if (cancelled) return;
        const known = loadFpMap()[pl.id];
        if (known && known.n === pl.count) continue;
        let tracks = plCacheGet(pl.id, pl.count)?.tracks;
        if (!tracks) {
          try {
            const data = await fetchPlaylist(pl.uri, token);
            tracks = data.tracks;
            plCachePut(pl.id, pl.count, data.name, tracks);
          } catch (e) {
            if (e.message === 'AUTH') return; // token died; foreground handles it
            continue;
          }
        }
        if (cancelled) return;
        setFp(pl.id, pl.count, fingerprint(tracks));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, myLists]);

  const marginMm = 8; // auto — fixed page margin
  const gapMm = 2; // auto — fixed gap between cards
  // "Cards per row" is the only size control; the card size (square) is derived to fit A4.
  const cardMm = Math.round(((A4_W - 2 * marginMm - (perRow - 1) * gapMm) / perRow) * 10) / 10;
  const opts = { cardMm, marginMm, gapMm, cut, flip, style: cardStyle };
  const grid = useMemo(() => estimatePerPage(opts), [cardMm, marginMm, gapMm]);

  const orderIdx =
    playlist && order.length === playlist.tracks.length
      ? order
      : playlist
      ? playlist.tracks.map((_, i) => i)
      : [];
  // Display sorted by year (undated last). Within a year, the current shuffle
  // order decides sequence — so Shuffle only reshuffles cards inside their own
  // year, which is also what the per-year cap uses to pick survivors.
  const orderPos = new Map(orderIdx.map((idx, pos) => [idx, pos]));
  const ordered = orderIdx
    .map((i) => ({ ...playlist.tracks[i], _idx: i }))
    .sort((a, b) => {
      const ya = a.year || Infinity;
      const yb = b.year || Infinity;
      if (ya !== yb) return ya - yb;
      return orderPos.get(a._idx) - orderPos.get(b._idx);
    });
  const included = ordered.filter((t) => !excluded.has(t._idx));
  const tracks = capOn ? capPerYear(included, Math.max(1, capN || 1)) : included;
  // Cards whose year still needs a human: uncertain or unfound, not manually
  // edited, and not acknowledged in the review modal.
  const flagged = playlist
    ? playlist.tracks.filter((t) => (t.unv || t.unsure) && t.ysrc !== 'edit' && acks[t.uri] !== t.year)
    : [];
  // Reviewing can start while the check is still running: newly flagged
  // cards append to the open modal (never removed or reordered underfoot).
  useEffect(() => {
    if (!reviewOpen) return;
    setReviewUris((prev) => {
      const have = new Set(prev);
      const add = flagged.filter((t) => !have.has(t.uri)).map((t) => t.uri);
      return add.length ? [...prev, ...add] : prev;
    });
  }, [reviewOpen, flagged]);
  // The all-clear strip shows briefly, then gets out of the way.
  useEffect(() => {
    if (verif && !verif.running && flagged.length === 0 && !stripHidden) {
      const id = setTimeout(() => setStripHidden(true), 4000);
      return () => clearTimeout(id);
    }
  }, [verif, flagged.length, stripHidden]);
  const finalSet = new Set(tracks.map((t) => t._idx));
  const overCap = included.length - tracks.length;
  const pages = Math.max(1, Math.ceil(tracks.length / grid.perPage));
  const isLink = /^https?:\/\//i.test(railQuery.trim()) || /spotify:playlist/i.test(railQuery);
  const q = railQuery.trim().toLowerCase();
  const shownLists = !q || isLink ? myLists : myLists.filter((pl) => pl.name.toLowerCase().includes(q));

  function setFp(id, n, fp) {
    setFpMap((prev) => {
      const next = { ...prev, [id]: { n, fp } };
      try {
        localStorage.setItem(FP_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  // A verified year lands as: year = what the cards print, year0 = Spotify's
  // claim, ysrc = where the correction came from ('mb'/'it'/'edit'), unv =
  // nothing could confirm it. The earliest plausible year wins — a remaster
  // album on Spotify often already carries the original date.
  function applyYear(uri, y, src, unsure) {
    setPlaylist((p) => {
      if (!p) return p;
      return {
        ...p,
        tracks: p.tracks.map((t) => {
          if (t.uri !== uri) return t;
          if (src === 'miss') return { ...t, unv: !t.ysrc };
          const y0 = t.year0 ?? t.year;
          const eff = src === 'edit' ? y : plausibleYear(y0) && y0 < y ? y0 : y;
          return {
            ...t,
            year: eff,
            year0: y0,
            ysrc: eff !== y0 || src === 'edit' ? src : '',
            unv: false,
            unsure: src === 'edit' ? false : !!unsure,
          };
        }),
      };
    });
  }

  function startVerify(data, id, count) {
    const run = ++verifRun.current;
    setStripHidden(false);
    setReviewOpen(false);
    setPrintPop(false);
    verifCtrl.current?.abort();
    const ctrl = new AbortController();
    verifCtrl.current = ctrl;
    const spotifyYear = new Map(data.tracks.map((t) => [t.uri, t.year]));
    let fixed = 0;
    setVerif({ running: true, done: 0, total: 0, fixed: 0 });
    verifyYears(data.tracks, {
      signal: ctrl.signal,
      onProgress: (done, total, eta) => {
        if (run === verifRun.current) setVerif((v) => ({ ...v, done, total, eta }));
      },
      onUpdate: (uri, y, src, unsure) => {
        if (run !== verifRun.current) return;
        if (src !== 'edit' && src !== 'miss') {
          const sy = spotifyYear.get(uri) || 0;
          const eff = plausibleYear(sy) && sy < y ? sy : y;
          if (eff !== sy) fixed++;
        }
        applyYear(uri, y, src, unsure);
      },
    })
      .catch(() => {})
      .finally(() => {
        if (run !== verifRun.current) return;
        setVerif((v) => ({ ...v, running: false, fixed }));
        // Corrections can move cards across decades — refresh the rail bar.
        const tracks = playlistRef.current?.tracks;
        if (id && tracks) setFp(id, count ?? -1, fingerprint(tracks));
      });
  }

  function editYear(uri, y) {
    saveOverride(uri, y);
    applyYear(uri, y, 'edit');
  }

  function ackTracks(list) {
    setAcks((prev) => {
      const next = { ...prev };
      for (const t of list) next[t.uri] = t.year;
      try {
        localStorage.setItem(ACK_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  function unackTrack(t) {
    setAcks((prev) => {
      const next = { ...prev };
      delete next[t.uri];
      try {
        localStorage.setItem(ACK_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  function openReview() {
    setPrintPop(false);
    setReviewUris(flagged.map((t) => t.uri));
    setReviewOpen(true);
  }

  async function onLoad(link = url) {
    setError('');
    setPlaylist(null);
    setLoading(true);
    try {
      const id = parsePlaylistId(link);
      const count = id ? myLists.find((p) => p.id === id)?.count ?? null : null;
      let data = id ? plCacheGet(id, count) : null;
      if (!data) {
        data = await fetchPlaylist(link, token);
        if (id) plCachePut(id, count, data.name, data.tracks);
      }
      if (data.tracks.length === 0) throw new Error('No playable tracks found in that playlist.');
      setPlaylist(data);
      setOrder(data.tracks.map((_, i) => i));
      setExcluded(new Set());
      setSheetPage(0);
      if (id) setFp(id, count ?? -1, fingerprint(data.tracks));
      startVerify(data, id, count);
    } catch (e) {
      if (e.message === 'AUTH') {
        setToken(null);
        setError('Session expired — please log in again.');
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }

  function choose(pl) {
    setSelectedId(pl.id);
    setUrl(pl.uri);
    onLoad(pl.uri);
  }

  function shuffle() {
    setOrder((prev) => {
      const a = prev.length ? [...prev] : playlist ? playlist.tracks.map((_, i) => i) : [];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    });
  }

  function toggleCard(idx) {
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }

  async function download(kind) {
    if (!playlist) return;
    setBusy(kind);
    try {
      const doc =
        kind === 'fronts'
          ? await makeFrontsPdf(tracks, opts)
          : await makeBacksPdf(tracks, opts);
      const safe = playlist.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      doc.save(`flutster-${safe}-${kind}.pdf`);
    } finally {
      setBusy('');
    }
  }

  const themeBtn = (
    <button className="ghost sm" onClick={theme.toggle}>
      {theme.isDark ? 'Light' : 'Dark'}
    </button>
  );

  if (!clientId) {
    return (
      <Shell narrow isDark={theme.isDark} action={themeBtn}>
        <SetupClientId onSaved={(id) => { setClientId(id); setCid(id); }} />
      </Shell>
    );
  }

  if (!token) {
    return (
      <Shell
        narrow
        isDark={theme.isDark}
        action={<>{themeBtn}<button className="ghost sm" onClick={() => { setClientId(''); setCid(''); }}>Change ID</button></>}
      >
        <section className="hero fade-in">
          <span className="pill">Spotify · QR · print at home</span>
          <h2 className="hero-title">Turn a playlist into a card game.</h2>
          <p className="lead">
            Double-sided Flutster cards — QR codes on the front, year · artist · title
            on the back — ready to print and cut.
          </p>
          {authError && <p className="error">{authError}</p>}
          <button className="primary big" onClick={login}>
            <span className="sp-dot" /> Log in with Spotify
          </button>
          <p className="hint">
            First time? Add this redirect URI in your{' '}
            <a className="link" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify dashboard</a>:{' '}
            <CopyCode text={redirectUri()} />
          </p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell wide isDark={theme.isDark} action={<>{themeBtn}<button className="ghost sm" onClick={() => { logout(); setToken(null); }}>Log out</button></>}>
      <div className="studio fade-in">
        {/* LEFT — playlists */}
        <aside className="st-rail">
          <div className="st-rh">Playlists{myLists.length > 0 && <span className="badge">{myLists.length}</span>}</div>
          <div className="st-search">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 5 1.5-1.5-5-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z"/></svg>
            <input
              placeholder="Search or paste a link…"
              value={railQuery}
              onChange={(e) => setRailQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && isLink) onLoad(railQuery); }}
            />
          </div>
          {error && <p className="error">{error}</p>}
          <div className="st-pllist">
            {loadingLists && <p className="hint">Loading your playlists…</p>}
            {!loadingLists && shownLists.length === 0 && (
              <p className="hint">{isLink ? 'Press Enter to load this link.' : 'No playlists match.'}</p>
            )}
            {shownLists.map((pl) => (
              <button
                key={pl.id}
                className={'st-plrow' + (selectedId === pl.id ? ' active' : '')}
                onClick={() => choose(pl)}
                title={pl.name}
              >
                <div className="st-plc">{pl.image ? <img src={pl.image} alt="" /> : <span>♪</span>}</div>
                <div className="st-plmeta">
                  <b>{pl.name}</b>
                  <Fingerprint counts={fpMap[pl.id]?.fp} />
                  <span>{pl.count} tracks</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* MIDDLE — action row, timeline, deck */}
        <main className="st-mid">
          {loading ? (
            <div className="st-empty">Loading playlist…</div>
          ) : !playlist ? (
            <div className="st-empty">
              <div className="st-empty-ic">🎴</div>
              <p>Pick a playlist on the left — or paste a link — to start building cards.</p>
            </div>
          ) : (
            <>
              <div className="st-act">
                <h2>{playlist.name}</h2>
                <span className="st-actmeta">
                  {tracks.length} cards · {pages} page{pages !== 1 ? 's' : ''}
                  {overCap > 0 && <> · {overCap} over cap</>}
                </span>
                <span className="grow" />
                <button className="primary" onClick={() => download('fronts')} disabled={!!busy}>
                  {busy === 'fronts' ? 'Building…' : 'Fronts · QR'}
                </button>
                <span className="printwrap">
                  <button
                    className="primary alt"
                    disabled={!!busy}
                    onClick={() => {
                      if (printPop) return setPrintPop(false);
                      if (flagged.length > 0) return setPrintPop(true);
                      download('backs');
                    }}
                  >
                    {busy === 'backs' ? 'Building…' : 'Backs · answers'}
                    {flagged.length > 0 && <span className="flagbadge">{flagged.length}</span>}
                  </button>
                  {printPop && (
                    <div className="printpop">
                      <b>{flagged.length} year{flagged.length !== 1 ? 's' : ''} still flagged</b>
                      <p>These cards would print with unconfirmed years.</p>
                      <div className="printpop-row">
                        <button className="primary sm-cta" onClick={openReview}>Review first</button>
                        <button
                          className="ghost sm"
                          onClick={() => {
                            setPrintPop(false);
                            download('backs');
                          }}
                        >
                          Print anyway
                        </button>
                      </div>
                    </div>
                  )}
                </span>
              </div>

              {verif && verif.running && (
                <div className="vstrip">
                  <div className="vrow">
                    <span className="vspin" aria-hidden="true" />
                    <span className="vtitle">Checking years…</span>
                    <span className="vbar">
                      <i style={{ width: verif.total ? `${Math.round((Math.min(verif.done, verif.total) / verif.total) * 100)}%` : '10%' }} />
                    </span>
                    <span className="vcount">
                      {verif.total ? `${Math.min(verif.done, verif.total)} / ${verif.total}` : '…'}
                      {verif.eta > 5 && ` · ~${verif.eta >= 90 ? `${Math.ceil(verif.eta / 60)} min` : `${Math.ceil(verif.eta / 10) * 10}s`} left`}
                    </span>
                    {flagged.length > 0 && (
                      <button className="primary vreview" onClick={openReview}>
                        Review {flagged.length} so far
                      </button>
                    )}
                  </div>
                  <p className="vhint">
                    Old songs take a while — this runs in the background, so keep arranging your deck.
                    Already-checked songs are instant next time.
                  </p>
                </div>
              )}
              {verif && !verif.running && flagged.length > 0 && (
                <div className="vstrip warn">
                  <div className="vrow">
                    <span className="vtitle">
                      Years checked — <b className="vwarn">{flagged.length} need your eyes</b>
                    </span>
                    <span className="vhint inline">
                      {verif.fixed > 0 && <>{verif.fixed} corrected · </>}
                      {flagged.length} uncertain or unfound
                    </span>
                    <span className="grow" />
                    <button className="primary vreview" onClick={openReview}>
                      Review {flagged.length} flagged
                    </button>
                  </div>
                </div>
              )}
              {verif && !verif.running && flagged.length === 0 && !stripHidden && (
                <div className="vstrip ok">
                  <div className="vrow">
                    <span className="vtitle vok">
                      ✓ {playlist.tracks.length} years checked
                      {verif.fixed > 0 && <> · {verif.fixed} corrected</>}
                    </span>
                  </div>
                </div>
              )}

              <TimelineStrip tracks={tracks} />

              <div className="backs-head">
                <span className="mini-cap">Card backs</span>
                <div className="backs-actions">
                  <button className="st-tbtn" onClick={shuffle}>{SHUFFLE_ICON} Shuffle</button>
                  {excluded.size > 0 && (
                    <button className="st-tbtn" onClick={() => setExcluded(new Set())}>Reset</button>
                  )}
                </div>
              </div>
              <p className="pick-hint">Tap a card to include or exclude it.</p>
              <div className="backs-preview">
                {ordered.map((t) => {
                  const state = excluded.has(t._idx) ? 'excluded' : finalSet.has(t._idx) ? 'in' : 'over';
                  return (
                    <div
                      className={`pcard ${decClass(t.year)} ${state}`}
                      key={t._idx}
                      onClick={() => toggleCard(t._idx)}
                      title="Include / exclude"
                    >
                      <YearTag t={t} onEdit={editYear} />
                      <b>{t.artist}</b>
                      <i>{t.title}</i>
                      {state !== 'in' && <span className="cap-tag">{state === 'over' ? 'over cap' : 'off'}</span>}
                    </div>
                  );
                })}
              </div>

              <div className="printnote">
                <span className="printnote-ic">🖨️</span>
                <div>
                  Print the <b>Fronts</b> PDF, put the stack back in the tray, flip on the{' '}
                  <b>{flip === 'long' ? 'long edge (left↔right)' : 'short edge (top↕bottom)'}</b>,
                  then print the <b>Backs</b> PDF. Use <b>100% / actual size</b> (no “fit to page”) and do one test sheet first.
                </div>
              </div>
            </>
          )}
        </main>

        {/* RIGHT — real sheet preview + layout settings */}
        <aside className="st-rail st-right">
          <div className="st-rh">Print preview</div>
          <SheetPreview
            tracks={tracks}
            grid={grid}
            page={Math.min(sheetPage, pages - 1)}
            pages={pages}
            onPage={setSheetPage}
            marginMm={marginMm}
            gapMm={gapMm}
            cut={cut}
            hasPlaylist={!!playlist}
            cardStyle={cardStyle}
          />
          <div className="st-a4cap">A4 · {grid.cols}×{grid.rows} grid · {cardMm} mm cards</div>
          <div className="st-setrow">
            <span>Cards per row</span>
            <div className="st-stepper">
              <button type="button" onClick={() => setPerRow((n) => Math.max(1, n - 1))} disabled={perRow <= 1} aria-label="Fewer per row">−</button>
              <b>{perRow}</b>
              <button type="button" onClick={() => setPerRow((n) => Math.min(6, n + 1))} disabled={perRow >= 6} aria-label="More per row">+</button>
            </div>
          </div>
          <div className="st-setrow">
            <span>Cut guides</span>
            <label className="toggle">
              <input type="checkbox" checked={cut} onChange={(e) => setCut(e.target.checked)} />
              <span className="track"><span className="thumb" /></span>
            </label>
          </div>
          <div className="st-setrow">
            <span>Flip edge</span>
            <select className="st-flip" value={flip} onChange={(e) => setFlip(e.target.value)}>
              <option value="long">Long edge</option>
              <option value="short">Short edge</option>
            </select>
          </div>
          <div className="st-setrow">
            <span>Card style</span>
            <select
              className="st-flip"
              value={cardStyle}
              onChange={(e) => { setCardStyle(e.target.value); localStorage.setItem('flutster_cardstyle', e.target.value); }}
            >
              <option value="color">Colour</option>
              <option value="bw">B&W · ink saver</option>
            </select>
          </div>
          <div className="st-setrow">
            <span>Cap per year</span>
            <span className="pair">
              <label className="toggle">
                <input type="checkbox" checked={capOn} onChange={(e) => setCapOn(e.target.checked)} />
                <span className="track"><span className="thumb" /></span>
              </label>
              <span className="st-stepper">
                <button type="button" onClick={() => setCapN((n) => Math.max(1, n - 1))} disabled={!capOn} aria-label="Fewer per year">−</button>
                <b>{capN}</b>
                <button type="button" onClick={() => setCapN((n) => Math.min(20, n + 1))} disabled={!capOn} aria-label="More per year">+</button>
              </span>
            </span>
          </div>
        </aside>
      </div>
      {reviewOpen && playlist && (
        <ReviewModal
          tracks={reviewUris.map((u) => playlist.tracks.find((t) => t.uri === u)).filter(Boolean)}
          checking={!!verif?.running}
          acks={acks}
          onEdit={editYear}
          onKeep={(t) => ackTracks([t])}
          onUnkeep={unackTrack}
          onKeepAll={(list) => ackTracks(list)}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </Shell>
  );
}

function Shell({ children, action, narrow, wide, isDark }) {
  return (
    <div className={'wrap' + (narrow ? ' wrap-narrow' : '') + (wide ? ' wrap-wide' : '')}>
      <header className="topbar">
        <div className="brand">
          {/* Bare mark, theme-matched — the tiled icon stays in the favicon. */}
          <img className="logo" src={`${import.meta.env.BASE_URL}${isDark ? 'mark-dark.svg' : 'mark-light.svg'}`} alt="Flutster" width="46" height="46" />
          <div className="brand-text">
            <h1>Flutster</h1>
            <span className="tag">Card Maker</span>
          </div>
        </div>
        <div className="top-actions">{action}</div>
      </header>
      {children}
      <footer>
        Cards encode a <code>spotify:track</code> URI — scan them in Flutster. Personal use.
      </footer>
    </div>
  );
}

function Fingerprint({ counts }) {
  if (!counts) return null;
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  return (
    <span className="st-fp">
      {counts.map((c, i) =>
        c > 0 ? (
          <span key={i} style={{ width: `${(c / total) * 100}%`, background: `var(${DEC_VARS[i]})` }} />
        ) : null
      )}
    </span>
  );
}

function TimelineStrip({ tracks }) {
  const [hover, setHover] = useState(null);
  const ys = yearStats(tracks);
  if (ys.dated < 2) return null;
  // Consecutive same-decade runs become labeled tick segments under the bars.
  const segs = [];
  const total = ys.span + 1;
  let start = 0;
  for (let i = 1; i <= total; i++) {
    if (i === total || decIdx(ys.minY + i) !== decIdx(ys.minY + start)) {
      const idx = decIdx(ys.minY + start);
      segs.push({ pct: ((i - start) / total) * 100, cls: DEC_CLASSES[idx], label: DEC_LABELS[idx] });
      start = i;
    }
  }
  return (
    <div className="st-tl">
      <div className="st-tl-head">
        <b>Timeline</b>
        <span className={hover ? 'on' : ''}>
          {hover
            ? `${hover.y} · ${hover.c} song${hover.c !== 1 ? 's' : ''}`
            : `${ys.dated} dated · ’${pad2(ys.minY)}–’${pad2(ys.maxY)}`}
        </span>
      </div>
      <div className="st-bars" onMouseLeave={() => setHover(null)}>
        {ys.counts.map((d) => (
          <div
            key={d.y}
            className={'bar ' + decClass(d.y) + (d.c === 0 ? ' zero' : '')}
            style={{ height: d.c === 0 ? '3px' : `${Math.max(9, Math.round((d.c / ys.maxC) * 100))}%` }}
            onMouseEnter={() => setHover(d)}
            title={`${d.y} · ${d.c} song${d.c !== 1 ? 's' : ''}`}
          />
        ))}
      </div>
      <div className="st-ticks">
        {segs.map((s, i) => (
          <span key={i} className={s.cls} style={{ width: `${s.pct}%` }}>
            {s.pct > 7 ? s.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

// Year on a deck card: shows corrections (struck-through Spotify year) and is
// click-to-edit — the printed deck should never be hostage to bad metadata.
function YearTag({ t, onEdit }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  const commit = () => {
    const y = parseInt(v, 10);
    if (plausibleYear(y) && y !== t.year) onEdit(t.uri, y);
    setEditing(false);
  };
  if (editing) {
    return (
      <input
        className="yr yr-in"
        autoFocus
        value={v}
        inputMode="numeric"
        maxLength={4}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setV(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }
  const corrected = t.ysrc && t.ysrc !== 'edit' && t.year0 > 0 && t.year0 !== t.year;
  const srcName = { mb: 'MusicBrainz', it: 'iTunes', dg: 'Discogs' }[t.ysrc] || t.ysrc;
  const title =
    t.ysrc === 'edit'
      ? 'Edited by you — click to change.'
      : corrected
      ? `Spotify said ${t.year0} — corrected via ${srcName}${t.unsure ? ' (uncertain: sources disagree)' : ''}. Click to edit.`
      : t.unv
      ? 'Could not verify this year — click to edit.'
      : t.unsure
      ? 'Uncertain — sources disagree on this year. Click to edit.'
      : 'Click to edit the year.';
  return (
    <span
      className={'yr' + (corrected ? ' yr-fix' : '') + (t.ysrc === 'edit' ? ' yr-edited' : '') + (t.unv || t.unsure ? ' yr-unv' : '')}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        setV(String(t.year || ''));
        setEditing(true);
      }}
    >
      {t.year || '—'}
      {corrected && <s>{t.year0}</s>}
    </span>
  );
}

const SRC_NAMES = { mb: 'MusicBrainz', it: 'iTunes', dg: 'Discogs' };

function googleUrl(t) {
  const title = String(t.title || '').split(' - ')[0].trim();
  const artist = String(t.artist || '').split(',')[0].trim();
  return 'https://www.google.com/search?q=' + encodeURIComponent(`${artist} ${title} release year`);
}

// One written line of context per flagged song — reads like a person, not a
// spreadsheet.
function rowSentence(t) {
  const y0 = t.year0 ?? t.year;
  if (t.ysrc === 'edit') {
    return (
      <>
        You set <b>{t.year}</b>
      </>
    );
  }
  if (t.unv) {
    return (
      <>
        Not found anywhere — Spotify's <b>{y0 || '—'}</b> stays unless you fix it
      </>
    );
  }
  if (!t.ysrc) {
    return (
      <>
        Nothing backs Spotify's <b>{t.year}</b> — sources point later
      </>
    );
  }
  const src = SRC_NAMES[t.ysrc] || t.ysrc;
  if (t.ysrc === 'it') {
    return (
      <>
        Spotify says <s>{y0}</s> · iTunes guesses <b>{t.year}</b>, low confidence
      </>
    );
  }
  return (
    <>
      Spotify says <s>{y0}</s> · only {src} disagrees with <b>{t.year}</b>
    </>
  );
}

// Review modal: one row per flagged card — Spotify's claim, our guess with the
// reason it's flagged, the year that will print (editable), and a Google
// lookup. Rows stay put as they're resolved so nothing jumps underfoot.
function ReviewModal({ tracks, checking, acks, onEdit, onKeep, onUnkeep, onKeepAll, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const resolved = (t) => t.ysrc === 'edit' || acks[t.uri] === t.year || !(t.unv || t.unsure);
  const open = tracks.filter((t) => !resolved(t));
  return (
    <div className="rvm-back" onClick={onClose} role="dialog" aria-modal="true" aria-label="Review years">
      <div className="rvm" onClick={(e) => e.stopPropagation()}>
        <div className="rvm-strip" aria-hidden="true" />
        <div className="rvm-head">
          <h3>Review years</h3>
          <span className="rvm-sub">
            {open.length === 0
              ? checking
                ? 'All resolved so far — still checking, more may appear.'
                : 'All resolved — this deck is ready to print.'
              : `${open.length} of ${tracks.length} left${checking ? ' · still checking, more may appear' : ''}`}
          </span>
        </div>
        <div className="rvm-body">
          {tracks.map((t) => {
            const done = resolved(t);
            return (
              <div key={t.uri} className={'rvr' + (done ? ' done' : '')}>
                <div className="rvr-main">
                  <div className="rvr-t">
                    {t.title} <span className="rvr-a">· {t.artist}</span>
                  </div>
                  <div className="rvr-s">
                    {rowSentence(t)}
                    {t.ysrc !== 'edit' && (
                      <>
                        {' · '}
                        <a className="rv-look" href={googleUrl(t)} target="_blank" rel="noreferrer">
                          look it up ↗
                        </a>
                      </>
                    )}
                  </div>
                </div>
                {done ? (
                  <span className="rvr-kept">{t.year || '—'}</span>
                ) : (
                  <RowYear t={t} onEdit={onEdit} onKeep={onKeep} done={done} />
                )}
                <button
                  className={'rv-ok' + (done ? ' on' : '')}
                  title={
                    t.ysrc === 'edit'
                      ? 'Resolved by your edit'
                      : done
                      ? 'Marked correct — click to unmark'
                      : 'Mark this year as correct'
                  }
                  aria-label={`Mark year for ${t.title} as correct`}
                  aria-pressed={done}
                  disabled={t.ysrc === 'edit'}
                  onClick={() => (done ? onUnkeep(t) : onKeep(t))}
                >
                  ✓
                </button>
              </div>
            );
          })}
        </div>
        <div className="rvm-foot">
          <span className="rvm-sub">
            {tracks.length - open.length} of {tracks.length} checked
          </span>
          <span className="grow" />
          {open.length > 0 && (
            <button className="ghost sm" onClick={() => onKeepAll(open)}>
              Mark all correct
            </button>
          )}
          <button className="primary sm-cta" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function RowYear({ t, onEdit, onKeep, done }) {
  const [v, setV] = useState(String(t.year || ''));
  useEffect(() => setV(String(t.year || '')), [t.year]);
  // Blur only saves a CHANGED year — tabbing through rows must not silently
  // acknowledge every guess. Enter also confirms an unchanged one.
  const commit = (confirmKeep) => {
    const y = parseInt(v, 10);
    if (!plausibleYear(y)) return setV(String(t.year || ''));
    if (y !== t.year) onEdit(t.uri, y);
    else if (confirmKeep && !done) onKeep(t);
  };
  return (
    <input
      className={'rv-in' + (done ? ' ok' : '')}
      value={v}
      inputMode="numeric"
      maxLength={4}
      aria-label={`Year for ${t.title}`}
      onChange={(e) => setV(e.target.value.replace(/\D/g, ''))}
      onBlur={() => commit(false)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(true);
      }}
    />
  );
}

// Mini render of the real card design (155): double skyline, wide year pill.
function CellBack({ t, cardStyle }) {
  const { seed, palette } = cardColors(t.uri);
  const bw = cardStyle === 'bw';
  const pill = bw ? INK : palette[1];
  const strip = (edge, s) => (
    <span className={'cellsky ' + edge}>
      {Array.from({ length: 9 }, (_, i) => (
        <i
          key={i}
          style={{
            height: `${rz(s, i, edge === 't' ? 8 : 14, edge === 't' ? 20 : 38)}%`,
            background: bw ? INK : palette[(s + i) % palette.length],
          }}
        />
      ))}
    </span>
  );
  return (
    <>
      {strip('t', seed + 4)}
      <span className="yr yrpill" style={{ background: pill }}>{t.year || '—'}</span>
      <b>{t.artist}</b>
      <i>{t.title}</i>
      {strip('b', seed)}
    </>
  );
}

function SheetPreview({ tracks, grid, page, pages, onPage, marginMm, gapMm, cut, hasPlaylist, cardStyle }) {
  const p = Math.max(0, page);
  const cells = Array.from({ length: grid.perPage }, (_, i) => tracks[p * grid.perPage + i] || null);
  const density = grid.cols >= 5 ? ' tiny' : grid.cols === 4 ? ' dense' : '';
  return (
    <>
      <div
        className={'sheet' + density}
        style={{
          padding: `${(marginMm / 210) * 100}%`,
          gap: `${(gapMm / 210) * 100}%`,
          gridTemplateColumns: `repeat(${grid.cols}, 1fr)`,
        }}
      >
        {cells.map((t, i) => (
          <div key={i} className={'sheet-cell' + (cut && (t || !hasPlaylist) ? ' cut' : '')}>
            {t && <CellBack t={t} cardStyle={cardStyle} />}
          </div>
        ))}
      </div>
      {hasPlaylist && (
        <div className="sheet-pager">
          <button className="sheet-arrow" onClick={() => onPage(Math.max(0, p - 1))} disabled={p <= 0} aria-label="Previous sheet">‹</button>
          Sheet <b>{p + 1}</b> of <b>{pages}</b>
          <button className="sheet-arrow" onClick={() => onPage(Math.min(pages - 1, p + 1))} disabled={p >= pages - 1} aria-label="Next sheet">›</button>
        </div>
      )}
    </>
  );
}

// Keep at most n tracks per year, in playlist order.
function capPerYear(tracks, n) {
  const seen = {};
  const out = [];
  for (const t of tracks) {
    const y = t.year || 0;
    seen[y] = (seen[y] || 0) + 1;
    if (seen[y] <= n) out.push(t);
  }
  return out;
}

function CopyCode({ text }) {
  const [ok, setOk] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text);
    setOk(true);
    setTimeout(() => setOk(false), 1200);
  };
  return (
    <span className="copycode">
      <code>{text}</code>
      <button type="button" className="copybtn" onClick={copy}>{ok ? '✓ Copied' : 'Copy'}</button>
    </span>
  );
}

function SetupClientId({ onSaved }) {
  const [v, setV] = useState('');
  const save = () => v.trim() && onSaved(v.trim());
  return (
    <section className="hero fade-in setup">
      <span className="pill">One-time setup · ~3 min</span>
      <h2 className="hero-title">Use your own Spotify app</h2>
      <p className="lead">
        The card maker runs on your own free Spotify developer app, so it works just
        for you — nothing shared, no accounts to trust.
      </p>
      <ol className="setup-steps">
        <li>Open <a className="link" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com/dashboard</a> and press <b>Create app</b>.</li>
        <li>Add this <b>Redirect URI</b> exactly: <CopyCode text={redirectUri()} /></li>
        <li>Under APIs, tick <b>Web API</b>.</li>
        <li>In <b>Users and Access</b>, add your own Spotify account.</li>
        <li>Copy the app's <b>Client ID</b> and paste it below.</li>
      </ol>
      <div className="setup-save">
        <label className="cid-field">
          <span className="cid-label">Spotify Client ID</span>
          <input
            className="cid-input"
            placeholder="Paste your 32-character Client ID"
            value={v}
            autoFocus
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </label>
        <button className="primary cid-save" disabled={!v.trim()} onClick={save}>
          Save &amp; continue
        </button>
      </div>
      <p className="hint cid-hint">Stored only in this browser — you can change it anytime from the top-right.</p>
    </section>
  );
}
