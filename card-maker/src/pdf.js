import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

const A4 = { w: 210, h: 297 }; // mm, portrait

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

// Shrink text with an ellipsis until it fits maxW (mm). Call after setFontSize.
function fit(doc, text, maxW) {
  text = text || '';
  if (doc.getTextWidth(text) <= maxW) return text;
  while (text.length > 1 && doc.getTextWidth(text + '…') > maxW) text = text.slice(0, -1);
  return text + '…';
}

function drawCut(doc, x, y, cardMm) {
  doc.setDrawColor(205);
  doc.setLineWidth(0.1);
  doc.rect(x, y, cardMm, cardMm);
}

export function estimatePerPage(opts) {
  const L = layout(opts);
  return { ...L };
}

export async function makeFrontsPdf(tracks, opts) {
  const { cardMm, cut } = opts;
  const L = layout(opts);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  for (let i = 0; i < tracks.length; i++) {
    const slot = i % L.perPage;
    if (i > 0 && slot === 0) doc.addPage();
    const col = slot % L.cols;
    const row = Math.floor(slot / L.cols);
    const { x, y } = cellXY(col, row, L, opts);
    if (cut) drawCut(doc, x, y, cardMm);
    const pad = cardMm * 0.1; // white quiet-zone margin inside the card
    drawQr(doc, tracks[i].uri, x + pad, y + pad, cardMm - 2 * pad);
  }
  return doc;
}

// Mirror the back so cards align after flipping the sheet:
// 'long' flips left/right (mirror columns), 'short' flips top/bottom (mirror rows).
export async function makeBacksPdf(tracks, opts) {
  const { cardMm, cut, flip } = opts;
  const L = layout(opts);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const k = cardMm / 63;
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
    const cx = x + cardMm / 2;
    const maxW = cardMm - 6;

    doc.setTextColor(20);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(40 * k);
    doc.text(String(t.year || '—'), cx, y + cardMm * 0.5, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11 * k);
    doc.text(fit(doc, t.artist, maxW), cx, y + cardMm * 0.72, { align: 'center' });

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10 * k);
    doc.text(fit(doc, t.title, maxW), cx, y + cardMm * 0.85, { align: 'center' });
  }
  return doc;
}
