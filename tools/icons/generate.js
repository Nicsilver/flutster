// Flutster icon/asset generator — single source of truth.
// Concept: "The Original" circular waveform, unified to the card-maker (Berry Punch) palette.
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

// ---- Brand palette (mirrors card-maker/src/styles.css) ----
const G1 = '#ff3d81';   // pink
const G2 = '#b026ff';   // violet
const G3 = '#5b2bff';   // indigo
const BG = '#0e0a18';    // near-black plum (web --bg)
const INK = '#fdeee6';   // warm off-white (web --ink)

const CX = 256, CY = 256, R = 118;

// music-curve amplitude, exactly as concept 19 "The Original"
function amp(k, N) {
  let v = 0.5 + 0.35 * Math.sin(k * 1.27) + 0.15 * Math.cos(k * 0.62);
  return Math.min(1, Math.max(0.12, v));
}

// Build the waveform + center ring group. scale grows art from centre.
function waveGroup({ gradId, ringColor, barColor, scale = 1 }) {
  const N = 40, inner = 88, maxLen = 60, width = 14;
  let bars = '';
  for (let k = 0; k < N; k++) {
    const a = -Math.PI / 2 + (k / N) * Math.PI * 2;
    const len = maxLen * amp(k, N);
    const r1 = inner, r2 = inner + len;
    const x1 = (CX + r1 * Math.cos(a)).toFixed(2), y1 = (CY + r1 * Math.sin(a)).toFixed(2);
    const x2 = (CX + r2 * Math.cos(a)).toFixed(2), y2 = (CY + r2 * Math.sin(a)).toFixed(2);
    bars += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${barColor || `url(#${gradId})`}" stroke-width="${width}" stroke-linecap="round"/>`;
  }
  const ring = `<circle cx="${CX}" cy="${CY}" r="54" fill="none" stroke="${ringColor}" stroke-width="14"/>`;
  const inner2 = bars + ring;
  if (scale === 1) return inner2;
  return `<g transform="translate(${CX} ${CY}) scale(${scale}) translate(${-CX} ${-CY})">${inner2}</g>`;
}

const grad = (id) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
     <stop offset="0" stop-color="${G1}"/><stop offset="0.55" stop-color="${G2}"/><stop offset="1" stop-color="${G3}"/>
   </linearGradient>`;

// --- Full icon (squircle bg + waveform): legacy launcher, favicon, Play Store, apple-touch ---
function fullIconSVG({ rounded = true } = {}) {
  const bg = rounded
    ? `<rect width="512" height="512" rx="${R}" fill="${BG}"/>`
    : `<rect width="512" height="512" fill="${BG}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs>${grad('gFull')}</defs>${bg}
    ${waveGroup({ gradId: 'gFull', ringColor: INK })}
  </svg>`;
}

// --- Adaptive foreground (transparent, art enlarged into safe zone) ---
function foregroundSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs>${grad('gFg')}</defs>
    ${waveGroup({ gradId: 'gFg', ringColor: INK, scale: 1.18 })}
  </svg>`;
}

// --- Adaptive monochrome (themed icons, Android 13+): all white on transparent ---
function monochromeSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    ${waveGroup({ gradId: 'x', ringColor: '#ffffff', barColor: '#ffffff', scale: 1.18 })}
  </svg>`;
}

// --- Maskable web icon: art inside PWA safe zone (~80%), full-bleed plum bg ---
function maskableSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs>${grad('gMask')}</defs>
    <rect width="512" height="512" fill="${BG}"/>
    ${waveGroup({ gradId: 'gMask', ringColor: INK, scale: 0.82 })}
  </svg>`;
}

// --- Social/OG banner ---
function bannerSVG(w, h) {
  const iconSize = Math.round(h * 0.46);
  const ix = Math.round(w * 0.075);
  const iy = Math.round(h * 0.5 - iconSize / 2);
  const tx = ix + iconSize + Math.round(w * 0.05);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
    <defs>
      ${grad('gWave')}
      <linearGradient id="gWord" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${G1}"/><stop offset="0.5" stop-color="${G2}"/><stop offset="1" stop-color="#c98cff"/>
      </linearGradient>
      <radialGradient id="gGlow1" cx="0.12" cy="0.0" r="0.7">
        <stop offset="0" stop-color="${G1}" stop-opacity="0.28"/><stop offset="1" stop-color="${G1}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="gGlow2" cx="1" cy="0.1" r="0.7">
        <stop offset="0" stop-color="${G3}" stop-opacity="0.30"/><stop offset="1" stop-color="${G3}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="${BG}"/>
    <rect width="${w}" height="${h}" fill="url(#gGlow1)"/>
    <rect width="${w}" height="${h}" fill="url(#gGlow2)"/>
    <g transform="translate(${ix} ${iy}) scale(${(iconSize / 512).toFixed(4)})">
      <rect width="512" height="512" rx="${R}" fill="#17111f"/>
      ${waveGroup({ gradId: 'gWave', ringColor: INK })}
    </g>
    <text x="${tx}" y="${Math.round(h * 0.48)}" font-family="Arial, 'Segoe UI', sans-serif" font-weight="800" font-size="${Math.round(h * 0.15)}" fill="url(#gWord)" letter-spacing="-2">Flutster</text>
    <text x="${tx + 3}" y="${Math.round(h * 0.48) + Math.round(h * 0.1)}" font-family="Arial, 'Segoe UI', sans-serif" font-weight="600" font-size="${Math.round(h * 0.05)}" fill="${INK}" opacity="0.82">Scan a card. Play the song. Guess the year.</text>
  </svg>`;
}

// ---------- render helpers ----------
function renderPng(svg, width) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
    background: 'rgba(0,0,0,0)',
  });
  return r.render().asPng();
}
function write(p, buf) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buf);
  console.log('  ✓', p.replace(/\\/g, '/'), `(${(buf.length / 1024).toFixed(1)} kB)`);
}

// ---------- paths ----------
const REPO = path.resolve(__dirname, '..', '..'); // tools/icons -> repo root
const A = (p) => path.join(REPO, 'app', p);
const CM = (p) => path.join(REPO, 'card-maker', p);

(async () => {
  console.log('Flutter source icons:');
  write(A('assets/icon/icon.png'), renderPng(fullIconSVG(), 1024));
  write(A('assets/icon/foreground.png'), renderPng(foregroundSVG(), 1024));
  write(A('assets/icon/monochrome.png'), renderPng(monochromeSVG(), 1024));

  console.log('Play Store + repo banner:');
  write(A('store/play_store_512.png'), renderPng(fullIconSVG(), 512));
  write(A('store/feature-graphic-1024x500.png'), renderPng(bannerSVG(1024, 500), 1024));
  write(path.join(REPO, 'screenshots/social-banner.png'), renderPng(bannerSVG(1280, 640), 1280));

  console.log('Card-maker web assets (public/):');
  // SVG favicon (crisp, modern browsers)
  fs.mkdirSync(CM('public'), { recursive: true });
  fs.writeFileSync(CM('public/favicon.svg'), fullIconSVG().trim());
  console.log('  ✓ card-maker/public/favicon.svg');
  write(CM('public/favicon-16x16.png'), renderPng(fullIconSVG(), 16));
  write(CM('public/favicon-32x32.png'), renderPng(fullIconSVG(), 32));
  write(CM('public/apple-touch-icon.png'), renderPng(fullIconSVG(), 180));
  write(CM('public/icon-192.png'), renderPng(fullIconSVG(), 192));
  write(CM('public/icon-512.png'), renderPng(fullIconSVG(), 512));
  write(CM('public/maskable-512.png'), renderPng(maskableSVG(), 512));
  write(CM('public/og-image.png'), renderPng(bannerSVG(1200, 630), 1200));

  // favicon.ico (16/32/48)
  const pngToIco = (await import('png-to-ico')).default;
  const icoParts = [16, 32, 48].map((s) => renderPng(fullIconSVG(), s));
  const ico = await pngToIco(icoParts);
  write(CM('public/favicon.ico'), ico);

  console.log('\nDone.');
})();
