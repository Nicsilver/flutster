import { describe, it, expect } from 'vitest';
import { estimatePerPage } from '../src/pdf.js';

// The grid geometry is shared by fronts and backs; if it shifts, the two
// printed sides stop lining up for hand-duplex.
describe('estimatePerPage', () => {
  it('default layout: 3 per row at 63.3 mm gives a 3×4 A4 grid', () => {
    const g = estimatePerPage({ cardMm: 63.3, marginMm: 8, gapMm: 2 });
    expect(g).toMatchObject({ cols: 3, rows: 4, perPage: 12 });
  });

  it('classic 60 mm cards also give 3×4', () => {
    expect(estimatePerPage({ cardMm: 60, marginMm: 8, gapMm: 2 })).toMatchObject({
      cols: 3,
      rows: 4,
      perPage: 12,
    });
  });

  it('oversized cards degrade to at least a 1×1 grid', () => {
    expect(estimatePerPage({ cardMm: 100, marginMm: 8, gapMm: 2 })).toMatchObject({ cols: 1, rows: 2 });
    expect(estimatePerPage({ cardMm: 500, marginMm: 8, gapMm: 2 })).toMatchObject({ cols: 1, rows: 1, perPage: 1 });
  });

  it('the grid is centered on the page', () => {
    const g = estimatePerPage({ cardMm: 60, marginMm: 8, gapMm: 2 });
    // 3 cols × 60 + 2 gaps = 184 of 210 mm → 13 mm either side.
    expect(g.offX).toBeCloseTo(13, 5);
  });
});
