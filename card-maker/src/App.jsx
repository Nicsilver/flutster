import { useEffect, useMemo, useState } from 'react';
import { login, logout, handleRedirect, fetchPlaylist, fetchMyPlaylists, redirectUri, getClientId, setClientId } from './spotify.js';
import { makeFrontsPdf, makeBacksPdf, estimatePerPage } from './pdf.js';

const A4_W = 210; // mm — page width drives the auto card size

const pad2 = (y) => String(y % 100).padStart(2, '0');

// Songs-per-year stats used by the summary card (histogram + stat footer).
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

  const [perRow, setPerRow] = useState(3);
  const [cut, setCut] = useState(true);
  const [flip, setFlip] = useState('long');
  const [capOn, setCapOn] = useState(false);
  const [capN, setCapN] = useState(2);
  const [railQuery, setRailQuery] = useState('');
  const [order, setOrder] = useState([]);
  const [excluded, setExcluded] = useState(new Set());

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

  const marginMm = 8; // auto — fixed page margin
  const gapMm = 2; // auto — fixed gap between cards
  // "Cards per row" is the only size control; the card size (square) is derived to fit A4.
  const cardMm = Math.round(((A4_W - 2 * marginMm - (perRow - 1) * gapMm) / perRow) * 10) / 10;
  const opts = { cardMm, marginMm, gapMm, cut, flip };
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
  const finalSet = new Set(tracks.map((t) => t._idx));
  const overCap = included.length - tracks.length;
  const pages = Math.ceil(tracks.length / grid.perPage);
  const isLink = /^https?:\/\//i.test(railQuery.trim()) || /spotify:playlist/i.test(railQuery);
  const q = railQuery.trim().toLowerCase();
  const shownLists = !q || isLink ? myLists : myLists.filter((pl) => pl.name.toLowerCase().includes(q));

  async function onLoad(link = url) {
    setError('');
    setPlaylist(null);
    setLoading(true);
    try {
      const data = await fetchPlaylist(link, token);
      if (data.tracks.length === 0) throw new Error('No playable tracks found in that playlist.');
      setPlaylist(data);
      setOrder(data.tracks.map((_, i) => i));
      setExcluded(new Set());
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

  if (!clientId) {
    return <Shell narrow><SetupClientId onSaved={(id) => { setClientId(id); setCid(id); }} /></Shell>;
  }

  if (!token) {
    return (
      <Shell narrow action={<button className="ghost sm" onClick={() => { setClientId(''); setCid(''); }}>Change ID</button>}>
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
    <Shell wide action={<button className="ghost sm" onClick={() => { logout(); setToken(null); }}>Log out</button>}>
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
                <div className="st-plmeta"><b>{pl.name}</b><span>{pl.count} tracks</span></div>
              </button>
            ))}
          </div>
        </aside>

        {/* MIDDLE — the deck */}
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
              <div className="st-midhead">
                <h2 className="st-plname">{playlist.name}</h2>
                <div className={'st-cap' + (capOn ? '' : ' off')}>
                  <label className="toggle st-capsw">
                    <input type="checkbox" checked={capOn} onChange={(e) => setCapOn(e.target.checked)} />
                    <span className="track"><span className="thumb" /></span>
                  </label>
                  <span className="st-cap-l">Cap per year</span>
                  <div className="st-stepper">
                    <button type="button" onClick={() => setCapN((n) => Math.max(1, n - 1))} disabled={!capOn} aria-label="Fewer per year">−</button>
                    <b>{capN}</b>
                    <button type="button" onClick={() => setCapN((n) => Math.min(20, n + 1))} disabled={!capOn} aria-label="More per year">+</button>
                  </div>
                </div>
              </div>

              <div className="st-dls">
                <button className="primary lg" onClick={() => download('fronts')} disabled={!!busy}>
                  {busy === 'fronts' ? 'Building…' : '⬇  Fronts · QR'}
                </button>
                <button className="primary lg alt" onClick={() => download('backs')} disabled={!!busy}>
                  {busy === 'backs' ? 'Building…' : '⬇  Backs · answers'}
                </button>
              </div>

              <SummaryCard tracks={tracks} pages={pages} />

              <div className="st-sect">
                <div className="st-backhead">
                  <span className="st-caplabel">Card backs</span>
                  <div className="st-actions">
                    <button className="st-tbtn" onClick={shuffle}>{SHUFFLE_ICON} Shuffle</button>
                    {excluded.size > 0 && (
                      <button className="st-tbtn" onClick={() => setExcluded(new Set())}>Reset</button>
                    )}
                  </div>
                </div>
                <p className="st-pickhint">Tap a card to include or exclude it.</p>
                <div className="backs-preview">
                  {ordered.map((t) => {
                    const state = excluded.has(t._idx) ? 'excluded' : finalSet.has(t._idx) ? 'in' : 'over';
                    return (
                      <div className={`pcard ${state}`} key={t._idx} onClick={() => toggleCard(t._idx)} title="Include / exclude">
                        <span className="yr">{t.year || '—'}</span>
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
              </div>
            </>
          )}
        </main>

        {/* RIGHT — preview + layout */}
        <aside className="st-rail st-right">
          <div className="st-rh">Layout &amp; preview</div>
          <div className="st-a4" style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)` }}>
            {Array.from({ length: grid.cols * grid.rows }).map((_, i) => (
              <div key={i} className="st-cell" />
            ))}
          </div>
          <div className="st-a4cap">A4 · {grid.cols}×{grid.rows} grid · {cardMm} mm cards</div>
          <div className="st-setlist">
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
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children, action, narrow, wide }) {
  return (
    <div className={'wrap' + (narrow ? ' wrap-narrow' : '') + (wide ? ' wrap-wide' : '')}>
      <header className="topbar">
        <div className="brand">
          <img className="logo" src={`${import.meta.env.BASE_URL}favicon.svg`} alt="Flutster" width="50" height="50" />
          <div className="brand-text">
            <h1>Flutster</h1>
            <span className="tag">Card Maker</span>
          </div>
        </div>
        {action}
      </header>
      {children}
      <footer>
        Cards encode a <code>spotify:track</code> URI — scan them in Flutster. Personal use.
      </footer>
    </div>
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

function SummaryCard({ tracks, pages }) {
  const [hover, setHover] = useState(null);
  const ys = yearStats(tracks);
  return (
    <div className="st-statcard">
      <div className="st-sc-head">
        <span className="st-caplabel">Songs per year</span>
        {ys.dated > 1 && (
          <span className={'st-scmeta' + (hover ? ' on' : '')}>
            {hover ? `${hover.y} · ${hover.c} song${hover.c !== 1 ? 's' : ''}` : `${ys.dated} dated`}
          </span>
        )}
      </div>
      {ys.dated > 1 ? (
        <div className="st-bars" onMouseLeave={() => setHover(null)}>
          {ys.counts.map((d) => (
            <div
              key={d.y}
              className={'bar' + (d.c === 0 ? ' zero' : '') + (d.c === ys.maxC ? ' peak' : '')}
              style={{ height: d.c === 0 ? '3px' : `${Math.max(8, Math.round((d.c / ys.maxC) * 100))}%` }}
              onMouseEnter={() => setHover(d)}
              title={`${d.y} · ${d.c} song${d.c !== 1 ? 's' : ''}`}
            />
          ))}
        </div>
      ) : (
        <p className="hint" style={{ margin: '6px 0 0' }}>Not enough dated tracks to chart.</p>
      )}
      <div className="st-scfoot">
        <div className="st-fstat"><b>{tracks.length}</b><span>Cards</span></div>
        <div className="st-fstat"><b>{pages}</b><span>Pages</span></div>
        <div className="st-fstat"><b>{ys.peak ? `’${pad2(ys.minY)}–’${pad2(ys.maxY)}` : '—'}</b><span>Years</span></div>
        <div className="st-fstat"><b>{ys.peak ? ys.peak.y : '—'}</b><span>Peak</span></div>
      </div>
    </div>
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
        <button className="primary lg cid-save" disabled={!v.trim()} onClick={save}>
          Save &amp; continue
        </button>
      </div>
      <p className="hint cid-hint">Stored only in this browser — you can change it anytime from the top-right.</p>
    </section>
  );
}

