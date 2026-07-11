import { useEffect, useMemo, useState } from 'react';
import { login, logout, handleRedirect, fetchPlaylist, fetchMyPlaylists, redirectUri, getClientId, setClientId } from './spotify.js';
import { makeFrontsPdf, makeBacksPdf, estimatePerPage } from './pdf.js';

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

  const [cardMm, setCardMm] = useState(60);
  const [marginMm, setMarginMm] = useState(8);
  const [gapMm, setGapMm] = useState(2);
  const [cut, setCut] = useState(true);
  const [flip, setFlip] = useState('long');
  const [capOn, setCapOn] = useState(false);
  const [capN, setCapN] = useState(10);
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

  const opts = { cardMm, marginMm, gapMm, cut, flip };
  const grid = useMemo(() => estimatePerPage(opts), [cardMm, marginMm, gapMm]);

  const orderIdx =
    playlist && order.length === playlist.tracks.length
      ? order
      : playlist
      ? playlist.tracks.map((_, i) => i)
      : [];
  const ordered = orderIdx.map((i) => ({ ...playlist.tracks[i], _idx: i }));
  const included = ordered.filter((t) => !excluded.has(t._idx));
  const tracks = capOn ? capPerYear(included, Math.max(1, capN || 1)) : included;
  const finalSet = new Set(tracks.map((t) => t._idx));
  const overCap = included.length - tracks.length;
  const pages = Math.ceil(tracks.length / grid.perPage);

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
    return <Shell><SetupClientId onSaved={(id) => { setClientId(id); setCid(id); }} /></Shell>;
  }

  if (!token) {
    return (
      <Shell action={<button className="ghost sm" onClick={() => { setClientId(''); setCid(''); }}>Change ID</button>}>
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
            First time? Add this redirect URI to your Spotify dashboard:{' '}
            <code>{redirectUri()}</code>
          </p>
        </section>
      </Shell>
    );
  }

  return (
    <Shell action={<button className="ghost sm" onClick={() => { logout(); setToken(null); }}>Log out</button>}>
      <div className="searchbar fade-in">
        <svg className="search-ic" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 5 1.5-1.5-5-5Zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14Z"/></svg>
        <input
          className="grow"
          placeholder="Paste a Spotify playlist link…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onLoad()}
        />
        <button className="primary" onClick={() => onLoad()} disabled={loading || !url}>
          {loading ? 'Loading…' : 'Load'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {(loadingLists || myLists.length > 0) && (
        <section className="panel fade-in">
          <div className="panel-head">
            <h3>Your playlists</h3>
            <span className="badge">{loadingLists ? 'Loading…' : myLists.length}</span>
          </div>
          {myLists.length === 0 ? (
            <p className="hint">Fetching your playlists…</p>
          ) : (
            <div className="playlist-grid">
              {myLists.map((pl) => (
                <button
                  key={pl.id}
                  className={'pl-card' + (selectedId === pl.id ? ' active' : '')}
                  onClick={() => choose(pl)}
                  title={pl.name}
                >
                  <div className="pl-cover">
                    {pl.image ? <img src={pl.image} alt="" /> : <span>♪</span>}
                  </div>
                  <div className="pl-meta">
                    <b>{pl.name}</b>
                    <span>{pl.count} tracks</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="panel fade-in">
        <div className="panel-head">
          <h3>Card layout</h3>
          <span className="badge">{grid.cols}×{grid.rows} · {grid.perPage}/A4</span>
        </div>
        <div className="options">
          <Field label="Card size"><Num value={cardMm} set={setCardMm} min={30} max={100} unit="mm" /></Field>
          <Field label="Page margin"><Num value={marginMm} set={setMarginMm} min={0} max={30} unit="mm" /></Field>
          <Field label="Gap"><Num value={gapMm} set={setGapMm} min={0} max={15} unit="mm" /></Field>
          <Field label="Flip edge">
            <select value={flip} onChange={(e) => setFlip(e.target.value)}>
              <option value="long">Long edge (left↔right)</option>
              <option value="short">Short edge (top↕bottom)</option>
            </select>
          </Field>
          <label className="toggle">
            <input type="checkbox" checked={cut} onChange={(e) => setCut(e.target.checked)} />
            <span className="track"><span className="thumb" /></span>
            <span>Cut guides</span>
          </label>
          <label className="toggle">
            <input type="checkbox" checked={capOn} onChange={(e) => setCapOn(e.target.checked)} />
            <span className="track"><span className="thumb" /></span>
            <span>Cap per year</span>
          </label>
          {capOn && (
            <Field label="Max / year"><Num value={capN} set={setCapN} min={1} max={50} unit="/yr" /></Field>
          )}
        </div>
      </section>

      {playlist && (
        <section className="panel result fade-in">
          <div className="panel-head">
            <div>
              <h3 className="playlist-name">{playlist.name}</h3>
              <p className="sub">
                {tracks.length} card{tracks.length !== 1 ? 's' : ''} · {pages} page{pages !== 1 ? 's' : ''} per side
                {overCap > 0 && <span className="trim"> · {overCap} over cap</span>}
                {excluded.size > 0 && <span className="trim"> · {excluded.size} excluded</span>}
              </p>
            </div>
          </div>

          <div className="downloads">
            <button className="primary lg" onClick={() => download('fronts')} disabled={!!busy}>
              {busy === 'fronts' ? 'Building…' : '⬇  Fronts · QR'}
            </button>
            <button className="primary lg alt" onClick={() => download('backs')} disabled={!!busy}>
              {busy === 'backs' ? 'Building…' : '⬇  Backs · answers'}
            </button>
          </div>

          <YearChart tracks={tracks} />

          <div className="backs-head">
            <h4 className="mini-cap">Card backs · {tracks.length} in deck</h4>
            <div className="backs-actions">
              {excluded.size > 0 && (
                <button className="ghost sm" onClick={() => setExcluded(new Set())}>Reset picks</button>
              )}
              <button className="ghost sm" onClick={shuffle}>🔀 Shuffle</button>
            </div>
          </div>
          <p className="hint pick-hint">Tap a card to include or exclude it. Shuffle re-rolls which songs survive the per-year cap.</p>
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
              then print the <b>Backs</b> PDF. Use <b>100% / actual size</b> (no “fit to page”)
              and do one test sheet first.
            </div>
          </div>
        </section>
      )}
    </Shell>
  );
}

function Shell({ children, action }) {
  return (
    <div className="wrap">
      <header className="topbar">
        <div className="brand">
          <div className="logo">♪</div>
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

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Num({ value, set, min, max, unit }) {
  return (
    <div className="num">
      <input type="number" min={min} max={max} value={value} onChange={(e) => set(+e.target.value)} />
      <span className="unit">{unit}</span>
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
        <li>Open <code>developer.spotify.com/dashboard</code> and press <b>Create app</b>.</li>
        <li>Add this <b>Redirect URI</b> exactly: <code>{redirectUri()}</code></li>
        <li>Under APIs, tick <b>Web API</b>.</li>
        <li>In <b>Users and Access</b>, add your own Spotify account.</li>
        <li>Copy the app's <b>Client ID</b> and paste it below.</li>
      </ol>
      <div className="row">
        <input className="grow" placeholder="Spotify Client ID" value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()} />
        <button className="primary" disabled={!v.trim()} onClick={save}>Save</button>
      </div>
    </section>
  );
}

function YearChart({ tracks }) {
  const [hover, setHover] = useState(null);
  const years = tracks.map((t) => t.year).filter((y) => y > 0);
  if (years.length < 2) return null;

  const minY = Math.min(...years);
  const maxY = Math.max(...years);
  const span = Math.max(1, maxY - minY);
  const counts = Array.from({ length: span + 1 }, (_, i) => ({ y: minY + i, c: 0 }));
  for (const y of years) counts[y - minY].c++;
  const maxC = Math.max(...counts.map((d) => d.c));
  const peak = counts.find((d) => d.c === maxC);
  const undated = tracks.length - years.length;

  const decades = [];
  for (let d = Math.ceil(minY / 10) * 10; d <= maxY; d += 10) decades.push(d);

  const defaultMeta =
    `${years.length} dated · peak ${peak.y} (${maxC})` + (undated ? ` · ${undated} undated` : '');

  return (
    <div className="chart">
      <div className="chart-top">
        <span className="lede">Songs per year</span>
        <span className="meta">
          {hover ? `${hover.y} · ${hover.c} song${hover.c !== 1 ? 's' : ''}` : defaultMeta}
        </span>
      </div>
      <div className="bars" onMouseLeave={() => setHover(null)}>
        {counts.map((d) => (
          <div
            key={d.y}
            className={'bar' + (d.c === maxC ? ' peak' : '')}
            style={{ height: Math.max(3, Math.round((d.c / maxC) * 110)) }}
            onMouseEnter={() => setHover(d)}
          >
            {d.c === maxC && <span className="peaklab">{d.c}</span>}
          </div>
        ))}
      </div>
      <div className="ticks">
        {decades.map((d) => (
          <span key={d} style={{ left: `${((d - minY) / span) * 100}%` }}>{d}</span>
        ))}
      </div>
    </div>
  );
}
