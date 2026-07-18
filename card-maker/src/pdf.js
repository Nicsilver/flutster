import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { BALOO2_BOLD, BALOO2_SEMIBOLD } from './fonts.js';
import { SPECTRUM, INK, TITLE_INK, cardColors, skyline, FRONT_SEED } from './cardstyle.js';

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
function drawSkyline(doc, x, y, k, seed, palette, edge) {
  const { bars, w } = skyline(seed, edge);
  doc.setLineCap('round');
  doc.setLineWidth(w * k);
  for (const b of bars) {
    doc.setDrawColor(...rgb(palette[b.ci % palette.length]));
    const bx = x + b.x * k;
    if (edge === 'top') doc.line(bx, y + 6 * k, bx, y + (6 + b.h) * k);
    else doc.line(bx, y + 170 * k, bx, y + (170 - b.h) * k);
  }
}

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
// Deck label: tiny vertical edition tag along the right edge, so mixed
// printed decks can be sorted apart. Identical on every card of a deck, so
// the identical-fronts rule holds. The left/right edges are the only bands
// the skylines and the QR never reach.
function drawLabel(doc, label, x, y, cardMm, k) {
  doc.setFont('Baloo2', 'semibold');
  doc.setFontSize(7 * k * PT_PER_MM);
  doc.setTextColor(...rgb('#8d8577'));
  doc.text(label.toUpperCase(), x + cardMm - 6 * k, y + cardMm / 2, {
    align: 'center',
    angle: 90,
    charSpace: 0.3 * k,
  });
}

export async function makeFrontsPdf(tracks, opts) {
  const { cardMm, cut, style = 'color', label = '' } = opts;
  const L = layout(opts);
  const doc = newDoc();
  const k = cardMm / MOCK;
  const palette = style === 'bw' ? [INK] : SPECTRUM;
  for (let i = 0; i < tracks.length; i++) {
    const slot = i % L.perPage;
    if (i > 0 && slot === 0) doc.addPage();
    const col = slot % L.cols;
    const row = Math.floor(slot / L.cols);
    const { x, y } = cellXY(col, row, L, opts);
    if (cut) drawCut(doc, x, y, cardMm);
    if (style !== 'minimal') {
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
  const { cardMm, cut, flip, style = 'color', label = '' } = opts;
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
    const minimal = style === 'minimal';
    const palette = style === 'bw' ? [INK] : full;
    const pillColor = style === 'bw' ? INK : full[1];
    if (!minimal) {
      drawSkyline(doc, x, y, k, seed, palette, 'top');
      drawSkyline(doc, x, y, k, seed, palette, 'bottom');
    }

    const cx = x + cardMm / 2;

    // Measure the stack (artist / wide year pill / title), then center it.
    doc.setFont('Baloo2', 'bold');
    const artist = wrapFit(doc, t.artist, 18, k, maxW, 2);
    doc.setFont('Baloo2', 'semibold');
    const title = wrapFit(doc, t.title, 12.5, k, maxW, 2);

    const aLH = artist.pt * 0.352778 * 1.08;
    const tLH = title.pt * 0.352778 * 1.12;
    const pillH = 32 * k;
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

    // The wide banner pill with white numerals. Minimal style skips the fill
    // and prints bare ink digits — the pill is the biggest ink sink on a card.
    const yearStr = String(t.year || '—');
    doc.setFontSize((minimal ? 27 : 24) * k * PT_PER_MM);
    if (minimal) {
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
