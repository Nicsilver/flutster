import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { BALOO2_BOLD, BALOO2_SEMIBOLD } from './fonts.js';
import { SPECTRUM, INK, TITLE_INK, cardColors, skyline, FRONT_SEED, rz, designFor } from './cardstyle.js';

const A4 = { w: 210, h: 297 }; // mm, portrait
const MOCK = 176; // the approved mockup's card side; all design values are in mock units
const PT_PER_MM = 1 / 0.352778;

// Grid geometry for the given card size / margins. Front and back use the SAME
// geometry so the two printed sides line up.
function layout({ cardMm, marginMm, gapMm }) {
  const cols = Math.max(1, Math.floor((A4.w - 2 * marginMm + gapMm) / (cardMm + gapMm)));
  const rows = Math.max(1, Math.floor((A4.h - 2 * marginMm + gapMm) / (cardMm + gapMm)));
  const gridW = cols * cardMm + (cols - 1) * gapMm;
  const gridH = rows * cardMm + (rows - 1) * gapMm;
  const offX = (A4.w - gridW) / 2;
  const offY = (A4.h - gridH) / 2;
  return { cols, rows, perPage: cols * rows, offX, offY };
}

function cellXY(col, row, L, { cardMm, gapMm }) {
  return { x: L.offX + col * (cardMm + gapMm), y: L.offY + row * (cardMm + gapMm) };
}

function newDoc() {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  // Baloo 2 travels inside the PDF — no font needs to exist on the printer side.
  doc.addFileToVFS('Baloo2-Bold.ttf', BALOO2_BOLD);
  doc.addFont('Baloo2-Bold.ttf', 'Baloo2', 'bold');
  doc.addFileToVFS('Baloo2-SemiBold.ttf', BALOO2_SEMIBOLD);
  doc.addFont('Baloo2-SemiBold.ttf', 'Baloo2', 'semibold');
  return doc;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Draw the QR as vector rectangles (tiny file, crisp at any print size) rather
// than a big raster image. Horizontal runs of dark modules are merged into one
// rect to keep the rectangle count down.
function drawQr(doc, text, x, y, sizeMm) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const data = qr.modules.data;
  const m = sizeMm / n;
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (data[r * n + c]) {
        let run = 1;
        while (c + run < n && data[r * n + c + run]) run++;
        doc.rect(x + c * m, y + r * m, run * m, m, 'F');
        c += run;
      } else {
        c++;
      }
    }
  }
}

function drawCut(doc, x, y, cardMm) {
  doc.setDrawColor(205);
  doc.setLineWidth(0.1);
  doc.rect(x, y, cardMm, cardMm);
}

// The equalizer skyline along a card edge. Round caps make the bars read as
// the same species as the app's timeline.
function drawSkyline(doc, x, y, k, seed, palette, edge, off = 0) {
  const { bars, w } = skyline(seed, edge);
  doc.setLineCap('round');
  doc.setLineWidth(w * k);
  for (const b of bars) {
    doc.setDrawColor(...rgb(palette[b.ci % palette.length]));
    const bx = x + b.x * k;
    if (edge === 'top') doc.line(bx, y + (6 + off) * k, bx, y + (6 + off + b.h) * k);
    else doc.line(bx, y + (170 - off) * k, bx, y + (170 - off - b.h) * k);
  }
}

// ---- back-design decorations -----------------------------------------------
// All geometry is in mock units (MOCK = 176 = card side), ported from the
// approved card-lab mockups where the card was 100 cqw (×1.76 here). Colors
// come from the card's shuffled palette so every design keeps the
// hashed-from-URI identity of the original Skyline. (B&W skips decorations.)

// Skyline Border (202/231): short skylines flush with all four cut edges,
// bars growing inward. The half-linewidth inset keeps round caps on the card.
function drawBorderSkylines(doc, x, y, k, seed, palette) {
  const w = 4.75;
  const inset = w / 2;
  doc.setLineCap('round');
  doc.setLineWidth(w * k);
  for (const top of [true, false]) {
    const s = top ? seed + 4 : seed;
    for (let i = 0; i < 11; i++) {
      const bx = x + (29.9 + (i / 10) * 110.9) * k;
      const h = rz(s, i, 6.2, 15.8);
      doc.setDrawColor(...rgb(palette[(s + i) % palette.length]));
      if (top) doc.line(bx, y + inset * k, bx, y + (inset + h) * k);
      else doc.line(bx, y + (MOCK - inset) * k, bx, y + (MOCK - inset - h) * k);
    }
  }
  for (const left of [true, false]) {
    const s = left ? seed + 2 : seed + 7;
    for (let i = 0; i < 9; i++) {
      const by = y + (29.9 + (i / 8) * 110.9) * k;
      const h = rz(s, i, 6.2, 15.8);
      doc.setDrawColor(...rgb(palette[(s + i) % palette.length]));
      if (left) doc.line(x + inset * k, by, x + (inset + h) * k, by);
      else doc.line(x + (MOCK - inset) * k, by, x + (MOCK - inset - h) * k, by);
    }
  }
}

// LED Border (203): rounded dashes marching around all four edges.
function drawLedBorder(doc, x, y, k, seed, palette) {
  let ci = seed;
  const dash = (dx, dy, w, h) => {
    doc.setFillColor(...rgb(palette[ci++ % palette.length]));
    const r = Math.min(w, h) / 2;
    doc.roundedRect(x + dx * k, y + dy * k, w * k, h * k, r * k, r * k, 'F');
  };
  for (let i = 0; i < 12; i++) {
    const px = 7.9 + i * 13.7;
    dash(px, 6.2, 9.5, 3);
    dash(px, MOCK - 9.2, 9.5, 3);
  }
  for (let i = 1; i < 11; i++) {
    const py = 7.9 + i * 13.7;
    dash(6.2, py, 3, 9.5);
    dash(MOCK - 9.2, py, 3, 9.5);
  }
}

// Corner Brackets (204): four thick L-brackets, one hashed hue each.
function drawBrackets(doc, x, y, k, palette) {
  const S = 29.9, T = 4.6, IN = 7.9;
  const R = MOCK - IN;
  const arm = (ax, ay, w, h) => doc.rect(x + ax * k, y + ay * k, w * k, h * k, 'F');
  doc.setFillColor(...rgb(palette[0 % palette.length]));
  arm(IN, IN, S, T); arm(IN, IN, T, S);
  doc.setFillColor(...rgb(palette[1 % palette.length]));
  arm(R - S, IN, S, T); arm(R - T, IN, T, S);
  doc.setFillColor(...rgb(palette[2 % palette.length]));
  arm(R - S, R - T, S, T); arm(R - T, R - S, T, S);
  doc.setFillColor(...rgb(palette[3 % palette.length]));
  arm(IN, R - T, S, T); arm(IN, R - S, T, S);
}

// Ticket Rails (207): full-height six-block color rails on both side edges,
// same hashed order both sides.
function drawRails(doc, x, y, k, palette) {
  const W = 5.6, bh = MOCK / 6;
  for (let i = 0; i < 6; i++) {
    doc.setFillColor(...rgb(palette[i % palette.length]));
    // +0.06mm overlap so adjacent blocks can't show a white hairline
    doc.rect(x, y + i * bh * k, W * k, bh * k + 0.06, 'F');
    doc.rect(x + (MOCK - W) * k, y + i * bh * k, W * k, bh * k + 0.06, 'F');
  }
}

// EQ Corners (213): 7-bar equalizer clusters top-left and bottom-right.
function drawEqCorners(doc, x, y, k, seed, palette) {
  const w = 4.2, pitch = 6.8, IN = 8.8 + 2.1;
  doc.setLineCap('round');
  doc.setLineWidth(w * k);
  for (const tl of [true, false]) {
    const ci = tl ? 0 : 1;
    for (let i = 0; i < 7; i++) {
      const h = (3 + 8 * Math.abs(Math.sin((i + ci * 3 + seed) * 0.9))) * 1.76;
      doc.setDrawColor(...rgb(palette[(i * 5 + ci + seed) % palette.length]));
      if (tl) {
        const bx = x + (IN + i * pitch) * k;
        doc.line(bx, y + IN * k, bx, y + (IN + h) * k);
      } else {
        const bx = x + (MOCK - IN - (6 - i) * pitch) * k;
        doc.line(bx, y + (MOCK - IN) * k, bx, y + (MOCK - IN - h) * k);
      }
    }
  }
}

// Dash ring (215/232/233): n round-cap dashes radiating between r and r+len.
function drawRing(doc, x, y, k, seed, palette, { n, r, len, w }) {
  doc.setLineCap('round');
  doc.setLineWidth(w * k);
  const cx = x + (MOCK / 2) * k;
  const cy = y + (MOCK / 2) * k;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    doc.setDrawColor(...rgb(palette[(i + seed) % palette.length]));
    doc.line(
      cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k,
      cx + Math.cos(a) * (r + len) * k, cy + Math.sin(a) * (r + len) * k
    );
  }
}

// Skyline + Edges (218): the site's hard-stop spectrum strip on the top and
// bottom cut edges. FIXED colors — this is the brand element, never hashed.
function drawEdgeStrips(doc, x, y, k, bw) {
  const h = 3.9, segW = MOCK / 6;
  for (let i = 0; i < 6; i++) {
    doc.setFillColor(...rgb(bw ? INK : SPECTRUM[i]));
    doc.rect(x + i * segW * k, y, segW * k + 0.06, h * k, 'F');
    doc.rect(x + i * segW * k, y + (MOCK - h) * k, segW * k + 0.06, h * k, 'F');
  }
}

// ring-family text geometry: top/bottom text insets + center year size
const RING_GEOM = {
  ring: { n: 26, r: 51, len: 7.9, w: 3.9, top: 9, year: 23 },
  ledkit: { n: 22, r: 42.2, len: 7, w: 3.7, top: 21, year: 21 },
  viewfinder: { n: 24, r: 45.8, len: 7.4, w: 3.9, top: 14, year: 22 },
};

// Which text layout a design uses: the classic centered stack with the color
// pill, the same stack with a big ink year, or the ring's top/center/bottom.
const LAYOUT = {
  skyline: 'pill', border: 'pill', edges: 'pill',
  borderink: 'ink', led: 'ink', brackets: 'ink', rails: 'ink', eq: 'ink',
  ring: 'ring', ledkit: 'ring', viewfinder: 'ring',
};

// Wrap to at most maxLines, shrinking the font until it fits. Returns the
// lines plus the point size that was settled on.
function wrapFit(doc, text, basePx, k, maxWmm, maxLines) {
  text = text || '';
  let scale = 1;
  for (;;) {
    const pt = basePx * k * PT_PER_MM * scale;
    doc.setFontSize(pt);
    const lines = doc.splitTextToSize(text, maxWmm);
    if (lines.length <= maxLines || scale <= 0.55) {
      if (lines.length > maxLines) {
        lines.length = maxLines;
        lines[maxLines - 1] = lines[maxLines - 1].replace(/.{2}$/, '') + '…';
      }
      return { lines, pt };
    }
    scale *= 0.9;
  }
}

export function estimatePerPage(opts) {
  const L = layout(opts);
  return { ...L };
}

// Fronts are pixel-identical on every card (fixed spectrum skyline + QR): the
// front is face-up while people guess, so it must not be memorizable.
// Deck label: tiny vertical edition tag on BOTH side edges, centered in the
// gap between the card edge and the QR, so mixed printed decks can be sorted
// apart whichever way a card lies. Identical on every card of a deck, so the
// identical-fronts rule holds.
function drawLabel(doc, label, x, y, cardMm, k) {
  const text = label.toUpperCase();
  const charSpace = 0.3 * k;
  doc.setFont('Baloo2', 'semibold');
  doc.setFontSize(7 * k * PT_PER_MM);
  doc.setTextColor(...rgb('#8d8577'));
  // jsPDF's align:center mis-places rotated text, so center by hand: with
  // angle 90 the run starts at its anchor and extends upward, so drop the
  // anchor half the measured run below the card's midline. getTextWidth
  // ignores charSpace; add it per gap.
  const len = doc.getTextWidth(text) + Math.max(0, text.length - 1) * charSpace;
  const mid = y + cardMm / 2;
  // Mirrored like facing book spines: left reads bottom-to-top (run extends
  // up from the anchor, glyphs hang toward -x), right top-to-bottom (run
  // extends down, glyphs hang toward +x). QR starts 42 mock units in; the
  // gap's midpoint is 21, and the baseline sits 3.5 (half the cap height)
  // past it so the glyph column centers on the midpoint.
  doc.text(text, x + 24.5 * k, mid + len / 2, { angle: 90, charSpace });
  doc.text(text, x + (MOCK - 24.5) * k, mid - len / 2, { angle: -90, charSpace });
}

export async function makeFrontsPdf(tracks, opts) {
  const { cardMm, cut, style = 'color', label = '' } = opts;
  const L = layout(opts);
  const doc = newDoc();
  const k = cardMm / MOCK;
  const palette = SPECTRUM;
  for (let i = 0; i < tracks.length; i++) {
    const slot = i % L.perPage;
    if (i > 0 && slot === 0) doc.addPage();
    const col = slot % L.cols;
    const row = Math.floor(slot / L.cols);
    const { x, y } = cellXY(col, row, L, opts);
    if (cut) drawCut(doc, x, y, cardMm);
    // B&W is the simple, least-ink style — no front skylines.
    if (style !== 'bw') {
      drawSkyline(doc, x, y, k, FRONT_SEED, palette, 'top');
      drawSkyline(doc, x, y, k, FRONT_SEED, palette, 'bottom');
    }
    const qs = cardMm * 0.52;
    drawQr(doc, tracks[i].uri, x + (cardMm - qs) / 2, y + (cardMm - qs) / 2, qs);
    if (label) drawLabel(doc, label, x, y, cardMm, k);
  }
  return doc;
}

// Mirror the back so cards align after flipping the sheet:
// 'long' flips left/right (mirror columns), 'short' flips top/bottom (mirror rows).
export async function makeBacksPdf(tracks, opts) {
  const { cardMm, cut, flip, style = 'color', designs = null } = opts;
  const L = layout(opts);
  const doc = newDoc();
  const k = cardMm / MOCK;
  const maxW = cardMm - 32 * k;

  for (let i = 0; i < tracks.length; i++) {
    const slot = i % L.perPage;
    if (i > 0 && slot === 0) doc.addPage();
    let col = slot % L.cols;
    let row = Math.floor(slot / L.cols);
    if (flip === 'short') row = L.rows - 1 - row;
    else col = L.cols - 1 - col;
    const { x, y } = cellXY(col, row, L, opts);
    if (cut) drawCut(doc, x, y, cardMm);

    const t = tracks[i];
    const { seed, palette: full } = cardColors(t.uri);
    // B&W is the one simple, least-ink style: no decorations, bare ink digits,
    // and it ignores the design picker entirely.
    const bw = style === 'bw';
    const palette = full;
    const pillColor = full[1];
    const design = bw ? 'skyline' : designFor(t.uri, designs);
    if (!bw) {
      switch (design) {
        case 'border':
        case 'borderink':
          drawBorderSkylines(doc, x, y, k, seed, palette);
          break;
        case 'led':
          drawLedBorder(doc, x, y, k, seed, palette);
          break;
        case 'brackets':
          drawBrackets(doc, x, y, k, palette);
          break;
        case 'rails':
          drawRails(doc, x, y, k, palette);
          break;
        case 'eq':
          drawEqCorners(doc, x, y, k, seed, palette);
          break;
        case 'ring':
          drawRing(doc, x, y, k, seed, palette, RING_GEOM.ring);
          break;
        case 'ledkit':
          drawLedBorder(doc, x, y, k, seed, palette);
          drawRing(doc, x, y, k, seed + 2, palette, RING_GEOM.ledkit);
          break;
        case 'viewfinder':
          drawBrackets(doc, x, y, k, palette);
          drawRing(doc, x, y, k, seed + 5, palette, RING_GEOM.viewfinder);
          break;
        case 'edges':
          drawEdgeStrips(doc, x, y, k, false);
          drawSkyline(doc, x, y, k, seed, palette, 'top', 4);
          drawSkyline(doc, x, y, k, seed, palette, 'bottom', 4);
          break;
        default:
          drawSkyline(doc, x, y, k, seed, palette, 'top');
          drawSkyline(doc, x, y, k, seed, palette, 'bottom');
      }
    }

    const cx = x + cardMm / 2;
    const mode = bw ? 'pill' : LAYOUT[design] || 'pill';

    if (mode === 'ring') {
      // Ring family: artist along the top, big ink year dead center inside
      // the ring, title along the bottom. Single lines, shrink-to-fit.
      const g = RING_GEOM[design];
      const yearStr = String(t.year || '?');
      doc.setTextColor(...rgb(INK));
      doc.setFont('Baloo2', 'bold');
      const artist = wrapFit(doc, t.artist, 11.5, k, maxW, 1);
      doc.setFontSize(artist.pt);
      doc.text(artist.lines[0] || '', cx, y + g.top * k + artist.pt * 0.352778 * 0.75, { align: 'center' });
      doc.setFontSize(g.year * k * PT_PER_MM);
      doc.text(yearStr, cx, y + (MOCK / 2) * k + g.year * k * 0.36, { align: 'center' });
      doc.setTextColor(...rgb(TITLE_INK));
      doc.setFont('Baloo2', 'semibold');
      const title = wrapFit(doc, t.title, 9, k, maxW, 1);
      doc.setFontSize(title.pt);
      doc.text(title.lines[0] || '', cx, y + (MOCK - g.top) * k - title.pt * 0.352778 * 0.1, { align: 'center' });
      continue;
    }

    // Measure the stack (artist / year / title), then center it.
    const inkYear = mode === 'ink';
    doc.setFont('Baloo2', 'bold');
    const artist = wrapFit(doc, t.artist, 18, k, maxW, 2);
    doc.setFont('Baloo2', 'semibold');
    const title = wrapFit(doc, t.title, 12.5, k, maxW, 2);

    const aLH = artist.pt * 0.352778 * 1.08;
    const tLH = title.pt * 0.352778 * 1.12;
    const pillH = (inkYear ? 34 : 32) * k;
    const gapA = 6 * k;
    const gapT = 5 * k;
    const totalH = artist.lines.length * aLH + gapA + pillH + gapT + title.lines.length * tLH;
    let cursor = y + cardMm / 2 - totalH / 2;

    doc.setTextColor(...rgb(INK));
    doc.setFont('Baloo2', 'bold');
    doc.setFontSize(artist.pt);
    for (const line of artist.lines) {
      doc.text(line, cx, cursor + aLH * 0.8, { align: 'center' });
      cursor += aLH;
    }
    cursor += gapA;

    // The wide banner pill with white numerals. Minimal style and the
    // ink-year designs skip the fill and print bare ink digits — the pill is
    // the biggest ink sink on a card.
    const yearStr = String(t.year || '?');
    doc.setFontSize((bw ? 27 : inkYear ? 30 : 24) * k * PT_PER_MM);
    if (bw || inkYear) {
      doc.setTextColor(...rgb(INK));
    } else {
      const pillW = doc.getTextWidth(yearStr) + 60 * k;
      doc.setFillColor(...rgb(pillColor));
      doc.roundedRect(cx - pillW / 2, cursor, pillW, pillH, pillH / 2, pillH / 2, 'F');
      doc.setTextColor(255, 253, 248);
    }
    // Baloo's tall ascent: nudge the baseline so digits sit optically centered.
    doc.text(yearStr, cx, cursor + pillH * 0.73, { align: 'center' });
    cursor += pillH + gapT;

    doc.setTextColor(...rgb(TITLE_INK));
    doc.setFont('Baloo2', 'semibold');
    doc.setFontSize(title.pt);
    for (const line of title.lines) {
      doc.text(line, cx, cursor + tLH * 0.8, { align: 'center' });
      cursor += tLH;
    }

  }
  return doc;
}
