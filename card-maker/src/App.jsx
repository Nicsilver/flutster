import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { login, logout, handleRedirect, fetchPlaylist, fetchMyPlaylists, fetchTracks, parseTrackIds, redirectUri, getClientId, setClientId, parsePlaylistId } from './spotify.js';
import { verifyYears, saveOverride, plausibleYear } from './years.js';
import { checkPreviews } from './previews.js';
import { fetchPastedTracks, deckKey, loadSavedDecks, saveDeck } from './meta.js';
import { makeFrontsPdf, makeBacksPdf, estimatePerPage } from './pdf.js';
import { cardColors, rz, DESIGNS, designFor, loadDesigns, saveDesigns } from './cardstyle.js';
import PlayScreen from './Play.jsx';

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
const PL_V = 4; // v4 filtered out ghost tracks (v3 added the compilation flag)
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

// Printed ledger: which cards have physically been printed, per playlist,
// stored as uri → the year the card carried when it was printed. A later
// year correction makes the entry stale ("changed since print") so the
// card resurfaces as needing a reprint.
const PRINTED_KEY = 'flutster_printed';
function loadPrinted() {
  try {
    return JSON.parse(localStorage.getItem(PRINTED_KEY) || '{}');
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

// Below 900px the studio swaps its three side-by-side zones for a dock: two
// tabs (decks, songs) and a Print button that raises the layout rail as a
// bottom sheet. Desktop keeps the three-zone layout untouched.
// PWA install. Chrome-family browsers fire beforeinstallprompt when the site
// qualifies; stash the event so a visible Install button can raise the native
// prompt. iOS/WebKit never fires it (install is manual: Share → Add to Home
// Screen), so there the button opens instructions instead.
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  window.dispatchEvent(new Event('flutster-installable'));
});
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS masquerades as macOS but is the only "Mac" with touch.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function useInstall() {
  const [avail, setAvail] = useState(() => !isStandalone() && (deferredInstall !== null || isIOS()));
  const [iosHelp, setIosHelp] = useState(false);
  useEffect(() => {
    const onCan = () => setAvail(!isStandalone());
    const onDone = () => {
      deferredInstall = null;
      setAvail(false);
    };
    window.addEventListener('flutster-installable', onCan);
    window.addEventListener('appinstalled', onDone);
    return () => {
      window.removeEventListener('flutster-installable', onCan);
      window.removeEventListener('appinstalled', onDone);
    };
  }, []);
  const install = async () => {
    if (deferredInstall) {
      const ev = deferredInstall;
      deferredInstall = null; // Chrome allows prompt() once per event
      ev.prompt();
      const choice = await ev.userChoice.catch(() => null);
      if (choice?.outcome === 'accepted') setAvail(false);
    } else {
      setIosHelp(true);
    }
  };
  return { avail, install, iosHelp, closeIosHelp: () => setIosHelp(false) };
}

const MOBILE_MQ = '(max-width: 900px)';
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_MQ).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onChange = (e) => setMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export default function App() {
  // Spotify mode (BYO developer app, full API) vs Preview mode (no accounts:
  // pasted links + metadata mirror + iTunes preview clips). Empty = not
  // chosen yet, which shows the mode chooser.
  // #play routes to the scan-and-play screen (hash routing survives GitHub
  // Pages' lack of server rewrites).
  const [route, setRoute] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const [mode, setModeState] = useState(() => localStorage.getItem('flutster_mode') || '');
  const inPreview = mode === 'preview';
  const [savedDecks, setSavedDecks] = useState(loadSavedDecks);
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
  const [yearsModal, setYearsModal] = useState(false);
  // Optional per-deck edition tag printed tiny along each back's right edge.
  const [deckLabels, setDeckLabels] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('flutster_decklabel') || '{}');
    } catch {
      return {};
    }
  });
  const [printedAll, setPrintedAll] = useState(loadPrinted);
  const [plKey, setPlKey] = useState('');
  const [printFilter, setPrintFilter] = useState(false);
  const [nudge, setNudge] = useState(false);
  // Which card set each PDF was last downloaded for — when fronts and backs
  // match, the user plausibly printed, and the mark-as-printed nudge shows.
  const dlRef = useRef({ fronts: '', backs: '', set: [] });
  const verifRun = useRef(0);
  const verifCtrl = useRef(null);
  // Cards with no iTunes 30s preview: silent in preview-playback mode, so
  // worth knowing before printing. Checked in the background per deck.
  const [prevMiss, setPrevMiss] = useState(() => new Set());
  const prevCtrl = useRef(null);
  const playlistRef = useRef(null);
  const theme = useTheme();
  useEffect(() => {
    playlistRef.current = playlist;
  }, [playlist]);

  const isMobile = useIsMobile();
  // Mobile dock: which zone the phone shows ('decks' | 'songs') and whether
  // the print sheet is up. Both are inert on desktop.
  const [mtab, setMtab] = useState('decks');
  const [printOpen, setPrintOpen] = useState(false);
  // "Print anyway" on the sheet's flagged-years banner; re-arms per opening.
  const [gateOk, setGateOk] = useState(false);
  useEffect(() => {
    if (playlist) setMtab('songs');
  }, [playlist]);
  useEffect(() => {
    setGateOk(false);
    if (!isMobile) return;
    // The sheet is fixed-position; freeze the page behind it.
    document.body.style.overflow = printOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [printOpen, isMobile]);

  const [perRow, setPerRow] = useState(3);
  const [cut, setCut] = useState(true);
  const [flip, setFlip] = useState('long');
  const [cardStyle, setCardStyle] = useState(() => {
    const s = localStorage.getItem('flutster_cardstyle');
    // "minimal" (least ink) folded into B&W — both are now the one simple style.
    return s === 'minimal' ? 'bw' : s || 'color';
  });
  const [designs, setDesignsRaw] = useState(loadDesigns);
  const [designOpen, setDesignOpen] = useState(false);
  const setDesigns = (list) => {
    setDesignsRaw(list);
    saveDesigns(list);
  };
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
  const deckLabel = (plKey && deckLabels[plKey]) || '';
  function setDeckLabel(v) {
    if (!plKey) return;
    setDeckLabels((prev) => {
      const next = { ...prev, [plKey]: v };
      try {
        localStorage.setItem('flutster_decklabel', JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  const opts = { cardMm, marginMm, gapMm, cut, flip, style: cardStyle, label: deckLabel.trim(), designs };
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
  // Print tracking: an entry with the current year = printed, an entry with a
  // different year = stale (the physical card is wrong), no entry = new.
  const printedCards = (plKey && printedAll[plKey]?.cards) || {};
  let printedN = 0;
  let staleN = 0;
  for (const t of included) {
    const py = printedCards[t.uri];
    if (py == null) continue;
    printedN++;
    if (py !== t.year) staleN++;
  }
  const newN = included.length - printedN;
  const toPrintN = newN + staleN;
  const printable = printFilter
    ? included.filter((t) => printedCards[t.uri] !== t.year)
    : included;
  const tracks = capOn ? capPerYear(printable, Math.max(1, capN || 1)) : printable;
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
  // Paste songs anywhere on the page — not just the search box. Re-registered
  // every render so the handler never closes over stale mode/token state.
  useEffect(() => {
    const onGlobalPaste = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (!mode) return;
      if (!inPreview && !token) return;
      const ids = parseTrackIds(e.clipboardData?.getData('text') || '');
      if (ids.length === 0) return;
      e.preventDefault();
      (inPreview ? onLoadPasted : onLoadTracks)(ids);
    };
    window.addEventListener('paste', onGlobalPaste);
    return () => window.removeEventListener('paste', onGlobalPaste);
  });

  // The all-clear strip shows briefly, then gets out of the way.
  useEffect(() => {
    if (verif && !verif.running && flagged.length === 0 && !stripHidden) {
      const id = setTimeout(() => setStripHidden(true), 4000);
      return () => clearTimeout(id);
    }
  }, [verif, flagged.length, stripHidden]);
  const finalSet = new Set(tracks.map((t) => t._idx));
  const overCap = printable.length - tracks.length;
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

  function startPreviewCheck(data) {
    prevCtrl.current?.abort();
    const ctrl = new AbortController();
    prevCtrl.current = ctrl;
    setPrevMiss(new Set());
    checkPreviews(data.tracks, {
      signal: ctrl.signal,
      onUpdate: (uri, ok) => {
        if (ctrl.signal.aborted || ok) return;
        setPrevMiss((prev) => {
          const next = new Set(prev);
          next.add(uri);
          return next;
        });
      },
    }).catch(() => {});
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

  function markPrinted(pairs) {
    if (!plKey) return;
    setPrintedAll((prev) => {
      const cards = { ...(prev[plKey]?.cards || {}) };
      for (const [uri, y] of pairs) cards[uri] = y;
      const next = { ...prev, [plKey]: { ts: Date.now(), cards } };
      try {
        localStorage.setItem(PRINTED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
    setNudge(false);
    // Marking means printing is done — back to the full deck view.
    setPrintFilter(false);
  }

  // Queue a printed card for reprint (lost/damaged): drop its ledger entry
  // so it counts as new again and joins the to-print filter.
  function unmarkPrinted(uri) {
    if (!plKey) return;
    setPrintedAll((prev) => {
      const cards = { ...(prev[plKey]?.cards || {}) };
      delete cards[uri];
      const next = { ...prev, [plKey]: { ...prev[plKey], cards } };
      try {
        localStorage.setItem(PRINTED_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  // Import externally corrected years (e.g. the exported JSON run through an
  // LLM). Matches by uri, falls back to artist+title; changed years land as
  // regular pinned edits so they survive reloads like any manual fix.
  function applyYearsJson(arr) {
    const flat = (s) =>
      String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const byUri = new Map(playlist.tracks.map((t) => [t.uri, t]));
    const byKey = new Map(playlist.tracks.map((t) => [flat(t.artist) + '|' + flat(t.title), t]));
    let updated = 0;
    let same = 0;
    let missed = 0;
    for (const e of arr) {
      const t = byUri.get(e.uri) || byKey.get(flat(e.artist) + '|' + flat(e.title));
      const y = parseInt(e.year, 10);
      if (!t || !plausibleYear(y)) {
        missed++;
        continue;
      }
      if (t.year === y) {
        same++;
        continue;
      }
      editYear(t.uri, y);
      updated++;
    }
    return { updated, same, missed };
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
      setPlKey(id || data.name);
      setPrintFilter(false);
      setNudge(false);
      dlRef.current = { fronts: '', backs: '', set: [] };
      if (id) setFp(id, count ?? -1, fingerprint(data.tracks));
      startVerify(data, id, count);
      // Preview availability only matters in Preview mode: Spotify-mode
      // decks play through Spotify itself.
      prevCtrl.current?.abort();
      setPrevMiss(new Set());
    } catch (e) {
      if (e.message === 'AUTH') {
        setToken(null);
        setError('Session expired. Please log in again.');
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }

  function setMode(m) {
    localStorage.setItem('flutster_mode', m);
    setModeState(m);
    setPlaylist(null);
    setSelectedId('');
    setError('');
    setRailQuery('');
    prevCtrl.current?.abort();
    setPrevMiss(new Set());
  }

  async function onLoadPasted(ids) {
    setError('');
    setPlaylist(null);
    setLoading(true);
    setSelectedId('');
    try {
      const data = await fetchPastedTracks(ids);
      if (data.tracks.length === 0) throw new Error('Could not resolve any of those track links.');
      data.name = `Pasted ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${data.tracks.length} songs`;
      const k = deckKey(data.tracks.map((t) => t.id));
      setSavedDecks(saveDeck(k, data.name, data.tracks.map((t) => t.id)));
      if (data.failed > 0) setError(`${data.failed} link${data.failed !== 1 ? 's' : ''} could not be resolved and got skipped.`);
      setPlaylist(data);
      setOrder(data.tracks.map((_, i) => i));
      setExcluded(new Set());
      setSheetPage(0);
      setPlKey('p:' + k);
      setPrintFilter(false);
      setNudge(false);
      dlRef.current = { fronts: '', backs: '', set: [] };
      startVerify(data, null, null);
      startPreviewCheck(data);
    } catch (e) {
      setError(e.message === 'META' ? 'The metadata mirror is unreachable right now. Try again in a minute.' : e.message);
    } finally {
      setLoading(false);
    }
  }

  async function onLoadTracks(ids) {
    setError('');
    setPlaylist(null);
    setLoading(true);
    setSelectedId('');
    try {
      const data = await fetchTracks(ids, token);
      if (data.tracks.length === 0) throw new Error('No playable tracks in that paste.');
      setPlaylist(data);
      setOrder(data.tracks.map((_, i) => i));
      setExcluded(new Set());
      setSheetPage(0);
      // All pasted decks share one print-ledger bucket; entries are keyed by
      // track uri, so overlap across pastes is exactly what we want.
      setPlKey('pasted');
      setPrintFilter(false);
      setNudge(false);
      dlRef.current = { fronts: '', backs: '', set: [] };
      startVerify(data, null, null);
      prevCtrl.current?.abort();
      setPrevMiss(new Set());
    } catch (e) {
      if (e.message === 'AUTH') {
        setToken(null);
        setError('Session expired. Please log in again.');
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
      doc.save(`flutster-${safe}-${kind}-${cardStyle === 'bw' ? 'bw' : 'colour'}.pdf`);
      const sig = tracks.map((t) => t.uri).join(',');
      const dl = dlRef.current;
      dl[kind] = sig;
      dl.set = tracks.map((t) => [t.uri, t.year]);
      if (dl.fronts === sig && dl.backs === sig && plKey) {
        // Never auto-mark — a test sheet must not poison the ledger. Only
        // nudge, and only when the set holds anything unmarked or stale.
        const pc = loadPrinted()[plKey]?.cards || {};
        if (dl.set.some(([u, y]) => pc[u] !== y)) setNudge(true);
      }
    } finally {
      setBusy('');
    }
  }

  const themeBtn = (
    <button className="ghost sm" onClick={theme.toggle}>
      {theme.isDark ? 'Light' : 'Dark'}
    </button>
  );
  const inst = useInstall();
  const installBtn = inst.avail ? (
    <>
      <button className="ghost sm" onClick={inst.install} title="Install as an app on this device">
        Install
      </button>
      {inst.iosHelp && (
        <div className="rvm-back" onClick={inst.closeIosHelp} role="dialog" aria-modal="true" aria-label="Install on iPhone or iPad">
          <div className="yjm" onClick={(e) => e.stopPropagation()}>
            <h3>Install on iPhone or iPad</h3>
            <p>Apple only allows installing from the browser&rsquo;s own menu:</p>
            <ol className="ios-steps">
              <li>Tap the <b>Share</b> button (the square with an arrow).</li>
              <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
              <li>Tap <b>Add</b>. Flutster appears as an app.</li>
            </ol>
            <div className="yjm-row">
              <span className="grow" />
              <button className="primary sm-cta" onClick={inst.closeIosHelp}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </>
  ) : null;
  const modeBtn = mode ? (
    <button
      className="ghost sm"
      title={inPreview ? 'Switch to Spotify mode' : 'Switch to Preview mode (no accounts)'}
      onClick={() => setMode(inPreview ? 'spotify' : 'preview')}
    >
      {inPreview ? 'Mode: Preview' : 'Mode: Spotify'}
    </button>
  ) : null;

  const playBtn = (
    <button className="playlink" onClick={() => { window.location.hash = '#play'; }} title="Scan cards and play, right here in the browser">
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z" /></svg>
      Play
    </button>
  );

  if (route === '#play') {
    return <PlayScreen token={token} onExit={() => { window.location.hash = ''; }} />;
  }

  if (!mode) {
    return (
      <Shell isDark={theme.isDark} action={<>{themeBtn}{playBtn}{installBtn}</>}>
        <ModeChooser onPick={setMode} />
      </Shell>
    );
  }

  if (!inPreview && (!clientId || !token)) {
    return (
      <Shell narrow isDark={theme.isDark} action={<>{themeBtn}{playBtn}{modeBtn}{installBtn}</>}>
        <SpotifyGate
          clientId={clientId}
          authError={authError}
          onSaveId={(id) => { setClientId(id); setCid(id); }}
          onChangeId={() => { setClientId(''); setCid(''); }}
          onBack={() => setMode('')}
          onPreview={() => setMode('preview')}
        />
      </Shell>
    );
  }

  return (
    <Shell
      wide
      isDark={theme.isDark}
      action={
        <>
          {themeBtn}
          {playBtn}
          {modeBtn}
          {installBtn}
          {!inPreview && <button className="ghost sm" onClick={() => { logout(); setToken(null); }}>Log out</button>}
        </>
      }
    >
      <div className={`studio fade-in m-${mtab}${printOpen ? ' m-printopen' : ''}`}>
        {/* LEFT — playlists (Spotify mode) or saved pasted decks (Preview mode) */}
        <aside className="st-rail">
          <div className="st-rh">
            {inPreview ? (
              <>Pasted decks{savedDecks.length > 0 && <span className="badge">{savedDecks.length}</span>}</>
            ) : (
              <>Playlists{myLists.length > 0 && <span className="badge">{myLists.length}</span>}</>
            )}
          </div>
          <div className="st-search">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 5 1.5-1.5-5-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z"/></svg>
            <input
              placeholder={inPreview ? 'Paste songs copied from Spotify…' : 'Search, or paste a link or tracks…'}
              value={railQuery}
              onChange={(e) => setRailQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && isLink && !inPreview) onLoad(railQuery); }}
              onPaste={(e) => {
                const ids = parseTrackIds(e.clipboardData?.getData('text') || '');
                if (ids.length > 0) {
                  e.preventDefault();
                  setRailQuery('');
                  (inPreview ? onLoadPasted : onLoadTracks)(ids);
                }
              }}
            />
          </div>
          <p className="paste-tip">
            <b>Tip:</b> copy songs in Spotify (Ctrl+A, Ctrl+C) and paste them <b>anywhere</b> on
            this page. A deck starts building right away.
          </p>
          {error && <p className="error">{error}</p>}
          {inPreview ? (
            <div className="st-pllist">
              {savedDecks.length === 0 && (
                <p className="hint">
                  Open a playlist in Spotify, select the songs (Ctrl+A), copy (Ctrl+C), and paste them
                  above. Decks you build are remembered here.
                </p>
              )}
              {savedDecks
                .filter((d) => !q || d.name.toLowerCase().includes(q))
                .map((d) => (
                  <button
                    key={d.k}
                    className={'st-plrow' + (playlist && plKey === 'p:' + d.k ? ' active' : '')}
                    onClick={() => onLoadPasted(d.ids)}
                    title={d.name}
                  >
                    <div className="st-plc"><span>♪</span></div>
                    <div className="st-plmeta">
                      <b>{d.name}</b>
                      <span>{d.ids.length} tracks</span>
                    </div>
                  </button>
                ))}
            </div>
          ) : (
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
          )}
        </aside>

        {/* MIDDLE — action row, timeline, deck */}
        <main className="st-mid">
          {loading ? (
            <div className="st-empty">Loading playlist…</div>
          ) : !playlist ? (
            <div className="st-empty">
              <div className="st-empty-ic">🎴</div>
              {inPreview ? (
                <>
                  <p>
                    Open any Spotify playlist, select the songs (Ctrl+A), copy (Ctrl+C), and paste
                    them into the box on the left.
                  </p>
                  <div className="pv-how">
                    <b>How Preview mode works</b>
                    <ol>
                      <li>
                        Your pasted links are turned into song titles and artists through a small
                        public metadata mirror. No account, no login, nothing stored anywhere but
                        this browser.
                      </li>
                      <li>
                        Every release year is verified against MusicBrainz, Discogs, and iTunes,
                        the same pipeline Spotify mode uses.
                      </li>
                      <li>
                        Every song is matched to a 30 second iTunes preview clip. The few without
                        one get a &ldquo;no preview&rdquo; tag so you can decide before printing.
                      </li>
                      <li>
                        The printed cards are identical to Spotify-mode cards, so they also scan
                        in the Flutster app.
                      </li>
                    </ol>
                  </div>
                </>
              ) : (
                <p>
                  Pick a playlist on the left, paste a playlist link, or select songs in Spotify
                  (Ctrl+A, Ctrl+C) and paste them into the search box.
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="st-act">
                <h2>{playlist.name}</h2>
                <span className="st-actmeta">
                  {tracks.length} cards · {pages} page{pages !== 1 ? 's' : ''}
                  {overCap > 0 && <> · {overCap} over cap</>}
                  {prevMiss.size > 0 && (
                    <span
                      className="noprev-count"
                      title="These songs have no 30-second iTunes preview. They play fine through Spotify; in preview-playback mode they would be silent."
                    >
                      {' '}· {prevMiss.size} without preview
                    </span>
                  )}
                </span>
                <span className="grow" />
                <button className="primary alt" onClick={() => download('fronts')} disabled={!!busy}>
                  {busy === 'fronts' ? 'Building…' : 'Fronts PDF'}
                </button>
                <span className="printwrap">
                  <button
                    className="primary spectrum"
                    disabled={!!busy}
                    onClick={() => {
                      if (printPop) return setPrintPop(false);
                      if (flagged.length > 0) return setPrintPop(true);
                      download('backs');
                    }}
                  >
                    {busy === 'backs' ? 'Building…' : 'Backs PDF'}
                    {flagged.length > 0 && <span className="flagbadge">{flagged.length}</span>}
                  </button>
                  {nudge && !printPop && (
                    <div className="printpop">
                      <b>Printed these for real?</b>
                      <p>
                        You downloaded fronts and backs for {dlRef.current.set.length} cards.
                        Mark them printed and they&rsquo;ll drop out of &ldquo;new&rdquo;.
                      </p>
                      <div className="printpop-row">
                        <button className="primary sm-cta" onClick={() => markPrinted(dlRef.current.set)}>
                          Mark {dlRef.current.set.length} printed
                        </button>
                        <button className="ghost sm" onClick={() => setNudge(false)}>
                          Not yet
                        </button>
                      </div>
                    </div>
                  )}
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
                    Old songs take a while. This runs in the background, so keep arranging your deck.
                    Already-checked songs are instant next time.
                  </p>
                </div>
              )}
              {verif && !verif.running && flagged.length > 0 && (
                <div className="vstrip warn">
                  <div className="vrow">
                    <span className="vtitle">
                      Years checked · <b className="vwarn">{flagged.length} need your eyes</b>
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

              {(printFilter || (printedN > 0 && toPrintN > 0)) && (
                <div className="vstrip pstrip">
                  <div className="vrow">
                    <span className="vtitle">
                      {printedN} printed · <b className="pnew">{newN} new</b>
                      {staleN > 0 && <> · <b className="pstale">{staleN} changed since print</b></>}
                    </span>
                    <span className="pbar" aria-hidden="true">
                      <i style={{ width: `${(Math.max(0, printedN - staleN) / Math.max(1, included.length)) * 100}%` }} />
                      <em style={{ width: `${(toPrintN / Math.max(1, included.length)) * 100}%` }} />
                    </span>
                    <button className="primary vreview" onClick={() => setPrintFilter((v) => !v)}>
                      {printFilter ? `Show all ${included.length}` : `Show the ${toPrintN} to print`}
                    </button>
                    <button
                      className="ghost sm"
                      disabled={tracks.length === 0}
                      onClick={() => markPrinted(tracks.map((t) => [t.uri, t.year]))}
                    >
                      Mark {tracks.length} printed
                    </button>
                  </div>
                  {staleN > 0 && (
                    <p className="vhint">
                      Changed = a year was corrected after you printed. Those physical cards carry the wrong year.
                    </p>
                  )}
                </div>
              )}

              <TimelineStrip tracks={tracks} />

              <div className="backs-head">
                <span className="mini-cap">Card backs</span>
                <div className="backs-actions">
                  <button className="st-tbtn" onClick={() => setYearsModal(true)}>Fix years · JSON</button>
                  <button className="st-tbtn" onClick={shuffle}>{SHUFFLE_ICON} Shuffle</button>
                  {excluded.size > 0 && (
                    <button className="st-tbtn" onClick={() => setExcluded(new Set())}>Reset</button>
                  )}
                </div>
              </div>
              <p className="pick-hint">
                Tap a card to include or exclude it.
                {printedN > 0 && ' Tap a card’s printed tag to queue it for a reprint.'}
              </p>
              <div className="backs-preview">
                {ordered.map((t) => {
                  const state = excluded.has(t._idx) ? 'excluded' : finalSet.has(t._idx) ? 'in' : 'over';
                  const py = printedCards[t.uri];
                  const ps = state === 'excluded' || py == null ? '' : py === t.year ? 'printed' : 'stale';
                  const tag =
                    state === 'excluded'
                      ? 'off'
                      : state === 'over'
                      ? printFilter && ps === 'printed'
                        ? 'printed'
                        : 'over cap'
                      : ps === 'stale'
                      ? 'reprint · year changed'
                      : ps === 'printed'
                      ? 'printed'
                      : null;
                  return (
                    <div
                      className={`pcard ${decClass(t.year)} ${state}${ps ? ` ${ps}` : ''}`}
                      key={t._idx}
                      onClick={() => toggleCard(t._idx)}
                      title="Include / exclude"
                    >
                      <YearTag t={t} onEdit={editYear} />
                      <b>{t.artist}</b>
                      <i>{t.title}</i>
                      {prevMiss.has(t.uri) && (
                        <span
                          className="noprev-tag"
                          title="No 30-second iTunes preview found. Plays fine through Spotify; silent in preview-playback mode."
                        >
                          no preview
                        </span>
                      )}
                      {tag && (
                        <span
                          className={'cap-tag' + (ps === 'stale' && state === 'in' ? ' rp' : '') + (ps ? ' ct-btn' : '')}
                          title={ps ? 'Take the printed mark off. The card queues for a reprint.' : undefined}
                          onClick={
                            ps
                              ? (e) => {
                                  e.stopPropagation();
                                  unmarkPrinted(t.uri);
                                }
                              : undefined
                          }
                        >
                          {tag}
                        </span>
                      )}
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

        {/* RIGHT — real sheet preview + layout settings. On mobile this same
            rail rises as the print sheet, gaining a grab handle, the flagged-
            years banner, the download buttons and the mark-printed nudge. */}
        <aside className="st-rail st-right">
          {isMobile && (
            <button className="m-grab" onClick={() => setPrintOpen(false)} aria-label="Close print sheet">
              <span />
            </button>
          )}
          <div className="st-rh">
            Print preview
            {isMobile && playlist && toPrintN > 0 && toPrintN < included.length && (
              <span className="badge">{toPrintN} to print</span>
            )}
          </div>
          {isMobile && printOpen && flagged.length > 0 && !gateOk && (
            <div className="m-gate">
              <b>{flagged.length} year{flagged.length !== 1 ? 's' : ''} still flagged</b>
              <p>These cards would print with unconfirmed years.</p>
              <div className="printpop-row">
                <button className="primary sm-cta" onClick={openReview}>Review first</button>
                <button className="ghost sm" onClick={() => setGateOk(true)}>Print anyway</button>
              </div>
            </div>
          )}
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
            designs={designs}
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
          <div className={'st-setrow' + (cardStyle === 'bw' ? ' dim' : '')}>
            <span>Card design</span>
            <button
              type="button"
              className="st-flip st-design"
              onClick={() => setDesignOpen(true)}
              disabled={cardStyle === 'bw'}
              title={cardStyle === 'bw' ? 'B&W uses the one simple design' : 'Pick one back design, or several to mix across the deck'}
            >
              {designLabel(designs)} <span className="st-caret">▾</span>
            </button>
          </div>
          <div className="st-setrow">
            <span>Deck label</span>
            <input
              className="st-lab"
              placeholder="none"
              maxLength={18}
              value={deckLabel}
              disabled={!playlist}
              onChange={(e) => setDeckLabel(e.target.value)}
              title="Tiny tag printed along both side edges of each card front, for telling mixed decks apart. Same on every card, so fronts stay unmemorable."
            />
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
          {isMobile && (
            <>
              <div className={'m-dl' + (flagged.length > 0 && !gateOk ? ' dim' : '')}>
                <button className="primary alt" onClick={() => download('fronts')} disabled={!!busy || !playlist}>
                  {busy === 'fronts' ? 'Building…' : 'Fronts PDF'}
                </button>
                <button className="primary spectrum" onClick={() => download('backs')} disabled={!!busy || !playlist}>
                  {busy === 'backs' ? 'Building…' : 'Backs PDF'}
                </button>
              </div>
              {nudge && (
                <div className="m-nudge">
                  <b>Printed these for real?</b>
                  <p>
                    You downloaded fronts and backs for {dlRef.current.set.length} cards. Mark them
                    printed and they&rsquo;ll drop out of &ldquo;new&rdquo;.
                  </p>
                  <div className="printpop-row">
                    <button className="primary sm-cta" onClick={() => markPrinted(dlRef.current.set)}>
                      Mark {dlRef.current.set.length} printed
                    </button>
                    <button className="ghost sm" onClick={() => setNudge(false)}>Not yet</button>
                  </div>
                </div>
              )}
              <div className="printnote">
                <span className="printnote-ic">🖨️</span>
                <div>
                  Print the <b>Fronts</b> PDF, put the stack back in the tray, flip on the{' '}
                  <b>{flip === 'long' ? 'long edge (left↔right)' : 'short edge (top↕bottom)'}</b>,
                  then print the <b>Backs</b> PDF. Use <b>100% / actual size</b> and do one test sheet first.
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
      {isMobile && printOpen && <button className="m-backdrop" onClick={() => setPrintOpen(false)} aria-label="Close print sheet" />}
      {isMobile && (
        <nav className="dock">
          <button
            className={'dock-tab' + (mtab === 'decks' && !printOpen ? ' on' : '')}
            onClick={() => { setMtab('decks'); setPrintOpen(false); }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
            {inPreview ? 'Decks' : 'Playlists'}
            <i className="dock-dot" />
          </button>
          <button
            className={'dock-tab' + (mtab === 'songs' && !printOpen ? ' on' : '')}
            onClick={() => { setMtab('songs'); setPrintOpen(false); }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></svg>
            Songs
            {playlist && flagged.length > 0 && <span className="dock-badge">{flagged.length}</span>}
            <i className="dock-dot" />
          </button>
          <button
            className="dock-print"
            disabled={!playlist}
            onClick={() => setPrintOpen((v) => !v)}
          >
            Print{playlist && toPrintN > 0 ? ` · ${toPrintN}` : ''} ▴
          </button>
        </nav>
      )}
      {yearsModal && playlist && (
        <YearsJsonModal
          tracks={playlist.tracks}
          onApply={applyYearsJson}
          onClose={() => setYearsModal(false)}
        />
      )}
      {reviewOpen && playlist && (
        <ReviewModal
          tracks={reviewUris.map((u) => playlist.tracks.find((t) => t.uri === u)).filter(Boolean)}
          checking={!!verif?.running}
          acks={acks}
          onEdit={editYear}
          onKeep={(t) => ackTracks([t])}
          onUnkeep={unackTrack}
          onKeepAll={(list) => ackTracks(list)}
          onJson={() => {
            setReviewOpen(false);
            setYearsModal(true);
          }}
          onClose={() => setReviewOpen(false)}
        />
      )}
      {designOpen && (
        <CardDesignModal
          selected={designs}
          onChange={setDesigns}
          onClose={() => setDesignOpen(false)}
          stripTracks={isMobile ? tracks.slice(0, 6) : []}
        />
      )}
    </Shell>
  );
}

function ModeChooser({ onPick }) {
  return (
    <section className="hero fade-in modes">
      <span className="pill">QR fronts · verified years on the backs · print at home</span>
      <h2 className="hero-title">Turn a playlist into a card game.</h2>
      <p className="lead">
        Both modes make the exact same printable cards. Pick what fits you, switch anytime from
        the top bar.
      </p>
      <div className="mode-cards">
        <div className="mode-card" onClick={() => onPick('spotify')}>
          <div className="mode-head">
            <b>Spotify mode</b>
            <span className="mode-tag">Full songs</span>
          </div>
          <ul className="mode-feats">
            <li>Your own playlists, loaded in one click</li>
            <li>Full songs through Spotify in the Flutster phone app</li>
            <li>The richest song data for year checking</li>
            <li>Uses your own free Spotify developer app + Premium</li>
          </ul>
          <span className="mode-warn">
            <b>Currently locked for new users.</b> This mode needs a free &ldquo;developer
            app&rdquo; made in Spotify&rsquo;s dashboard, and Spotify is not letting anyone create
            new ones right now. If you never made one, you cannot get in yet: pick Preview mode
            instead.
          </span>
          <button className="ghost mode-cta" onClick={(e) => { e.stopPropagation(); onPick('spotify'); }}>
            I already have a developer app
          </button>
        </div>
        <div className="mode-card" onClick={() => onPick('preview')}>
          <div className="mode-head">
            <b>Preview mode</b>
            <span className="mode-tag hot">No accounts</span>
          </div>
          <ul className="mode-feats">
            <li>Zero setup, start building right now</li>
            <li>Paste songs copied from any Spotify playlist</li>
            <li>Years verified against MusicBrainz, Discogs, and iTunes</li>
            <li>Playback via 30 second preview clips</li>
          </ul>
          <span className="mode-note">The printed cards come out identical to Spotify mode.</span>
          <button className="primary mode-cta" onClick={(e) => { e.stopPropagation(); onPick('preview'); }}>
            Start with Preview mode
          </button>
        </div>
      </div>
    </section>
  );
}

// One screen for the whole Spotify-mode doorway: setup when no Client ID is
// stored, an inviting login when one is.
function SpotifyGate({ clientId, authError, onSaveId, onChangeId, onBack, onPreview }) {
  const [v, setV] = useState('');
  const save = () => v.trim() && onSaveId(v.trim());
  const mask = (id) => (id.length <= 8 ? id : `${id.slice(0, 4)}…${id.slice(-4)}`);
  return (
    <section className="fade-in spgate">
      <button className="backlink" onClick={onBack}>‹ All modes</button>
      {!clientId ? (
        <div className="sp-panel">
          <div className="sp-strip" aria-hidden="true" />
          <span className="pill">Spotify mode · one-time setup, about 3 minutes</span>
          <h2>Use your own Spotify app</h2>
          <p className="lead">
            The card maker runs on a free Spotify developer app you create yourself, so nothing is
            shared and nobody else&rsquo;s limits apply.
          </p>
          <ol className="setup-steps">
            <li>Open <a className="link" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com/dashboard</a> and press <b>Create app</b>.</li>
            <li>Add this <b>Redirect URI</b> exactly: <CopyCode text={redirectUri()} /></li>
            <li>Under APIs, tick <b>Web API</b>.</li>
            <li>In <b>Users and Access</b>, add your own Spotify account.</li>
            <li>Copy the app&rsquo;s <b>Client ID</b> and paste it below.</li>
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
          <p className="hint cid-hint">
            Stored only in this browser. No developer app handy?{' '}
            <button className="linkbtn" onClick={onPreview}>Try Preview mode instead</button>. No
            accounts needed.
          </p>
        </div>
      ) : (
        <div className="sp-panel sp-login">
          <div className="sp-strip" aria-hidden="true" />
          <h2>Spotify mode</h2>
          <p className="lead">Log in and your playlists load straight into the deck builder.</p>
          {authError && <p className="error">{authError}</p>}
          <button className="primary big" onClick={login}>
            <span className="sp-dot" /> Log in with Spotify
          </button>
          <div className="sp-meta">
            <span>
              App: <code>{mask(clientId)}</code>
            </span>
            <button className="linkbtn" onClick={onChangeId}>Change ID</button>
            <button className="linkbtn" onClick={onPreview}>Use Preview mode instead</button>
          </div>
          <details className="sp-help">
            <summary>Login not working?</summary>
            <p>
              Your Spotify app must list this exact Redirect URI:{' '}
              <CopyCode text={redirectUri()} />, and your account must be added under Users and
              Access in the{' '}
              <a className="link" href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">
                Spotify dashboard
              </a>.
            </p>
          </details>
        </div>
      )}
    </section>
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
        Cards encode a <code>spotify:track</code> URI. Scan them in Flutster. Personal use.
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
      ? 'Edited by you. Click to change.'
      : corrected
      ? `Spotify said ${t.year0}, corrected via ${srcName}${t.unsure ? ' (uncertain: sources disagree)' : ''}. Click to edit.`
      : t.unv
      ? 'Could not verify this year. Click to edit.'
      : t.unsure
      ? 'Uncertain: sources disagree on this year. Click to edit.'
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
      {t.year || '?'}
      {corrected && <s>{t.year0}</s>}
    </span>
  );
}

// Export the deck as JSON for external year fixing (paste into an LLM, paste
// the corrected array back). Tolerates sloppy pastes: grabs the first [...]
// block so code fences or chat text around the JSON don't break the import.
function YearsJsonModal({ tracks, onApply, onClose }) {
  const [txt, setTxt] = useState('');
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const json = useMemo(
    () =>
      JSON.stringify(
        tracks.map((t) => ({ uri: t.uri, artist: t.artist, title: t.title, year: t.year })),
        null,
        1
      ),
    [tracks]
  );
  const copy = () => {
    navigator.clipboard?.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const apply = () => {
    setResult(null);
    try {
      const m = txt.match(/\[[\s\S]*\]/);
      const arr = JSON.parse(m ? m[0] : txt);
      if (!Array.isArray(arr)) throw new Error('not an array');
      setErr('');
      setResult(onApply(arr));
    } catch {
      setErr('Could not read that as JSON. Paste the full array, including the [ ].');
    }
  };
  return (
    <div className="rvm-back" onClick={onClose} role="dialog" aria-modal="true" aria-label="Fix years with JSON">
      <div className="yjm" onClick={(e) => e.stopPropagation()}>
        <h3>Fix years as JSON</h3>
        <p>
          Copy the deck as JSON and paste it into ChatGPT, Claude, or wherever you like, with a request such as
          &ldquo;correct the release years to the original first release, not remasters or re-issues&rdquo;.
          Then paste the corrected JSON below. Only changed years are applied, saved as your own edits.
        </p>
        <div className="yjm-row">
          <button className="primary sm-cta" onClick={copy}>
            {copied ? '✓ Copied' : `Copy ${tracks.length} tracks as JSON`}
          </button>
        </div>
        <textarea
          placeholder="Paste the corrected JSON here…"
          value={txt}
          onChange={(e) => setTxt(e.target.value)}
          spellCheck={false}
        />
        <div className="yjm-row">
          <button className="primary sm-cta" disabled={!txt.trim()} onClick={apply}>
            Apply years
          </button>
          {result && (
            <span className="yjm-res">
              {result.updated} updated · {result.same} unchanged{result.missed > 0 && <> · {result.missed} not matched</>}
            </span>
          )}
          {err && <span className="yjm-err">{err}</span>}
          <span className="grow" />
          <button className="ghost sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
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
    // Preview-mode decks have no Spotify baseline year, so there is nothing
    // to "keep": the card simply has no year until the user types one.
    return y0 ? (
      <>
        Not found anywhere. Spotify's <b>{y0}</b> stays unless you fix it
      </>
    ) : (
      <>No source found a year. Type one in, or the card prints without it</>
    );
  }
  if (!t.ysrc) {
    return y0 ? (
      <>
        Nothing backs Spotify's <b>{t.year}</b>. Sources point later
      </>
    ) : (
      <>No trusted source confirms this year</>
    );
  }
  const src = SRC_NAMES[t.ysrc] || t.ysrc;
  if (t.ysrc === 'it') {
    return y0 ? (
      <>
        Spotify says <s>{y0}</s> · iTunes guesses <b>{t.year}</b>, low confidence
      </>
    ) : (
      <>
        iTunes guesses <b>{t.year}</b>, low confidence
      </>
    );
  }
  return y0 ? (
    <>
      Spotify says <s>{y0}</s> · only {src} disagrees with <b>{t.year}</b>
    </>
  ) : (
    <>
      Only {src} found a year: <b>{t.year}</b>. No second source confirms it
    </>
  );
}

// Review modal: one row per flagged card — Spotify's claim, our guess with the
// reason it's flagged, the year that will print (editable), and a Google
// lookup. Rows stay put as they're resolved so nothing jumps underfoot.
function ReviewModal({ tracks, checking, acks, onEdit, onKeep, onUnkeep, onKeepAll, onJson, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const resolved = (t) => t.ysrc === 'edit' || acks[t.uri] === t.year || !(t.unv || t.unsure);
  const open = tracks.filter((t) => !resolved(t));
  // Resolved rows sink below the open ones (stable within each group), with a
  // FLIP slide so the reorder reads as movement, not a teleport.
  const ordered = [...tracks].sort((a, b) => (resolved(a) ? 1 : 0) - (resolved(b) ? 1 : 0));
  const bodyRef = useRef(null);
  const rowTops = useRef(new Map());
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const next = new Map();
    for (const el of body.children) {
      if (!el.dataset.uri) continue;
      next.set(el.dataset.uri, el.getBoundingClientRect().top);
    }
    if (!reduce) {
      for (const el of body.children) {
        const prev = rowTops.current.get(el.dataset.uri);
        const now = next.get(el.dataset.uri);
        if (prev != null && now != null && Math.abs(prev - now) > 1) {
          el.animate(
            [{ transform: `translateY(${prev - now}px)` }, { transform: 'translateY(0)' }],
            { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
          );
        }
      }
    }
    rowTops.current = next;
  });
  return (
    <div className="rvm-back" onClick={onClose} role="dialog" aria-modal="true" aria-label="Review years">
      <div className="rvm" onClick={(e) => e.stopPropagation()}>
        <div className="rvm-strip" aria-hidden="true" />
        <div className="rvm-head">
          <h3>Review years</h3>
          <span className="rvm-sub">
            {open.length === 0
              ? checking
                ? 'All resolved so far. Still checking, more may appear.'
                : 'All resolved. This deck is ready to print.'
              : `${open.length} of ${tracks.length} left${checking ? ' · still checking, more may appear' : ''}`}
          </span>
          <p className="rvm-json">
            Many to fix?{' '}
            <button className="linkbtn" onClick={onJson} disabled={checking}>
              Export the years as JSON
            </button>{' '}
            and let an AI correct them in one batch
            {checking ? '. Wait for the check to finish first.' : '.'}
          </p>
        </div>
        <div className="rvm-body" ref={bodyRef}>
          {ordered.map((t) => {
            const done = resolved(t);
            return (
              <div key={t.uri} data-uri={t.uri} className={'rvr' + (done ? ' done' : '')}>
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
                  <span className="rvr-kept">{t.year || '?'}</span>
                ) : (
                  <RowYear t={t} onEdit={onEdit} onKeep={onKeep} done={done} />
                )}
                <button
                  className={'rv-ok' + (done ? ' on' : '')}
                  title={
                    t.ysrc === 'edit'
                      ? 'Resolved by your edit'
                      : done
                      ? 'Marked correct. Click to unmark'
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

const designLabel = (list) =>
  list.length === 1 ? DESIGNS.find((d) => d.id === list[0])?.name || 'Skyline' : `Mix · ${list.length}`;

// Every design tile in the picker previews the same sample card so the 11
// backs compare like-for-like (same trick as the card-lab mockups).
const DESIGN_SAMPLE = { artist: 'ABBA', title: 'Dancing Queen', year: 1976, uri: 'spotify:track:0GjEhVFGZW8afUYGChu3Rr' };

// The back-design picker: the 11 approved backs dealt loosely on a table.
// Tapping a card straightens it and deals it into the deck; one selected =
// the whole deck, several = an even hashed split. The last card can't be
// removed. On phones this goes full screen (rvm media rules) and the footer
// shows a live strip of the first printable cards, since the rail's sheet
// preview is hidden behind the modal there.
function CardDesignModal({ selected, onChange, onClose, stripTracks }) {
  const has = (id) => selected.includes(id);
  const toggle = (id) => {
    if (has(id) && selected.length === 1) return;
    const next = has(id) ? selected.filter((x) => x !== id) : [...selected, id];
    // canonical order keeps the mix assignment independent of click order
    onChange(DESIGNS.filter((d) => next.includes(d.id)).map((d) => d.id));
  };
  const rots = [-2.5, 1.8, -1.2, 2.6, -3, 1.4, 2.2, -1.8, 3, -2.2, 1.6];
  return (
    <div className="rvm-back designback" onClick={onClose} role="dialog" aria-modal="true" aria-label="Card design">
      <div className="rvm design" onClick={(e) => e.stopPropagation()}>
        <div className="rvm-strip" aria-hidden="true" />
        <div className="rvm-head">
          <h3>Card design</h3>
          <span className="rvm-sub">tap the cards you want in the deck</span>
        </div>
        <div className="rvm-body">
          <div className="dtable">
            {DESIGNS.map((d, i) => (
              <button
                key={d.id}
                type="button"
                className={'dtile' + (has(d.id) ? ' on' : '')}
                style={{ '--rot': `${rots[i]}deg` }}
                aria-pressed={has(d.id)}
                onClick={() => toggle(d.id)}
              >
                <span className="dcard">
                  <CellBack t={DESIGN_SAMPLE} cardStyle="color" design={d.id} />
                </span>
                <span className="dchip" aria-hidden="true">✓</span>
                <em>{d.name}</em>
              </button>
            ))}
          </div>
        </div>
        <div className="rvm-foot">
          <span className="dsum">
            <b>{selected.length === 1 ? `${designLabel(selected)} · whole deck` : `${selected.length} designs in the deck`}</b>
            <span>{selected.length === 1 ? 'Tap more cards to mix designs.' : 'Even split across the cards.'}</span>
          </span>
          {stripTracks.length > 0 && (
            <span className="dmini" aria-hidden="true">
              {stripTracks.map((t) => (
                <span key={t.uri} className="dcard">
                  <CellBack t={t} cardStyle="color" design={designFor(t.uri, selected)} />
                </span>
              ))}
            </span>
          )}
          <span className="grow" />
          <button className="primary sm-cta" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// Which text layout a design's mini render uses (mirrors LAYOUT in pdf.js).
const CELL_LAYOUT = {
  borderink: 'ink', led: 'ink', brackets: 'ink', rails: 'ink', eq: 'ink',
  ring: 'ring', ledkit: 'ring', viewfinder: 'ring',
};

// Mini render of the printed backs for the sheet preview and design picker.
// Approximate on purpose (the PDF is the source of truth) but each design is
// recognizably itself. Decoration spans carry .csdec so the dense/tiny sheet
// rules can hide them wholesale.
function CellBack({ t, cardStyle, design = 'skyline' }) {
  const { seed, palette } = cardColors(t.uri);
  // B&W is the one simple, least-ink design: no decorations, bare ink year,
  // and it ignores the design picker entirely.
  const bw = cardStyle === 'bw';
  if (bw) design = 'skyline';
  const col = (i) => palette[i % palette.length];
  const pill = palette[1];
  const strip = (edge, s) => (
    <span className={'cellsky csdec ' + edge}>
      {Array.from({ length: 9 }, (_, i) => (
        <i
          key={i}
          style={{
            height: `${rz(s, i, edge === 't' ? 8 : 14, edge === 't' ? 20 : 38)}%`,
            background: col(s + i),
          }}
        />
      ))}
    </span>
  );
  const vstrip = (side, s) => (
    <span className={'csdec csv ' + side}>
      {Array.from({ length: 7 }, (_, i) => (
        <i key={i} style={{ width: `${rz(s, i, 28, 88)}%`, background: col(s + i) }} />
      ))}
    </span>
  );
  const ledBorder = () => {
    const out = [];
    for (let i = 0; i < 8; i++) {
      const p = `${4 + i * 12.3}%`;
      out.push({ left: p, top: '3.5%', width: '8.4%', height: '2.6%' });
      out.push({ left: p, bottom: '3.5%', width: '8.4%', height: '2.6%' });
    }
    for (let i = 1; i < 7; i++) {
      const p = `${4 + i * 12.3}%`;
      out.push({ top: p, left: '3.5%', width: '2.6%', height: '8.4%' });
      out.push({ top: p, right: '3.5%', width: '2.6%', height: '8.4%' });
    }
    return out.map((s, i) => <i key={i} className="csdec csled" style={{ ...s, background: col(seed + i) }} />);
  };
  const brackets = () =>
    ['tl', 'tr', 'br', 'bl'].map((c, i) => (
      <i key={c} className={'csdec csbk ' + c} style={{ borderColor: col(i) }} />
    ));
  const railsEls = () => {
    const stops = Array.from({ length: 6 }, (_, i) => `${col(i)} ${i * 16.66}% ${(i + 1) * 16.66}%`).join(', ');
    return (
      <>
        <i className="csdec csrail l" style={{ background: `linear-gradient(180deg, ${stops})` }} />
        <i className="csdec csrail r" style={{ background: `linear-gradient(180deg, ${stops})` }} />
      </>
    );
  };
  const eqEls = () =>
    [0, 1].map((ci) => (
      <span key={ci} className={'csdec cseq ' + (ci ? 'br' : 'tl')}>
        {Array.from({ length: 7 }, (_, i) => (
          <i
            key={i}
            style={{
              height: `${((3 + 8 * Math.abs(Math.sin((i + ci * 3 + seed) * 0.9))) / 11) * 100}%`,
              background: col(i * 5 + ci + seed),
            }}
          />
        ))}
      </span>
    ));
  const ringEl = (inset, po) => (
    <i
      className="csdec csring"
      style={{
        inset: `${inset}%`,
        background: `conic-gradient(${Array.from({ length: 6 }, (_, i) => `${col(i + po)} ${i * 60}deg ${(i + 1) * 60}deg`).join(', ')})`,
      }}
    />
  );
  const edgeStrip = (side) => (
    <i
      className={'csdec csedge ' + side}
      style={{ background: 'linear-gradient(90deg, #e3a008 0 16.6%, #e8590c 0 33.3%, #d6336c 0 50%, #0ca678 0 66.6%, #1c7ed6 0 83.3%, #7048e8 0 100%)' }}
    />
  );

  const deco = bw ? null : (
    <>
      {design === 'skyline' && <>{strip('t', seed + 4)}{strip('b', seed)}</>}
      {design === 'edges' && <>{edgeStrip('t')}{edgeStrip('b')}{strip('t', seed + 4)}{strip('b', seed)}</>}
      {(design === 'border' || design === 'borderink') && (
        <>{strip('t', seed + 4)}{strip('b', seed)}{vstrip('l', seed + 2)}{vstrip('r', seed + 7)}</>
      )}
      {(design === 'led' || design === 'ledkit') && ledBorder()}
      {(design === 'brackets' || design === 'viewfinder') && brackets()}
      {design === 'rails' && railsEls()}
      {design === 'eq' && eqEls()}
      {design === 'ring' && ringEl(16.5, seed)}
      {design === 'ledkit' && ringEl(22, seed + 2)}
      {design === 'viewfinder' && ringEl(20, seed + 5)}
    </>
  );

  const layout = bw ? 'pill' : CELL_LAYOUT[design] || 'pill';
  if (layout === 'ring') {
    return (
      <>
        {deco}
        <b className="rga">{t.artist}</b>
        <span className="yr yrpill plain">{t.year || '?'}</span>
        <i className="rgt">{t.title}</i>
      </>
    );
  }
  const ink = layout === 'ink' || bw;
  return (
    <>
      {deco}
      <span className={'yr yrpill' + (ink ? ' plain' : '')} style={{ background: ink ? 'transparent' : pill }}>
        {t.year || '?'}
      </span>
      <b>{t.artist}</b>
      <i>{t.title}</i>
    </>
  );
}

function SheetPreview({ tracks, grid, page, pages, onPage, marginMm, gapMm, cut, hasPlaylist, cardStyle, designs }) {
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
            {t && <CellBack t={t} cardStyle={cardStyle} design={designFor(t.uri, designs)} />}
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

