import { describe, it, expect } from 'vitest';
import { hashStr, cardColors, skyline, rz, POOL } from '../src/cardstyle.js';

// The card design hashes everything from the track URI. If any of these
// locked values drift, every reprinted card comes out looking different from
// the physical deck already on the table — treat a failure here as breaking.
const AHA = 'spotify:track:2WfaOiMkCvy7F5fcp2zZ8L';

describe('cardstyle', () => {
  it('hashStr is stable across releases', () => {
    expect(hashStr(AHA)).toBe(111901);
    expect(hashStr('')).toBe(hashStr(''));
  });

  it('cardColors is deterministic and a permutation of POOL', () => {
    const a = cardColors(AHA);
    const b = cardColors(AHA);
    expect(a.seed).toBe(111901);
    expect(a.palette).toEqual(b.palette);
    expect([...a.palette].sort()).toEqual([...POOL].sort());
  });

  it('cardColors palette head is locked (printed-deck identity)', () => {
    expect(cardColors(AHA).palette.slice(0, 3)).toEqual(['#4263eb', '#12b886', '#d6336c']);
  });

  it('different URIs get different palettes', () => {
    const a = cardColors(AHA).palette.join();
    const b = cardColors('spotify:track:7J1uxwnxfQLu4APicE5Rnj').palette.join();
    expect(a).not.toBe(b);
  });

  it('skyline geometry is locked: 15 bars spanning the card, heights in band', () => {
    const seed = cardColors(AHA).seed;
    for (const edge of ['top', 'bottom']) {
      const sk = skyline(seed, edge);
      expect(sk.bars).toHaveLength(15);
      expect(sk.bars[0].x).toBe(12);
      expect(sk.bars[14].x).toBe(164);
      const [lo, hi] = edge === 'top' ? [4, 12] : [8, 24];
      for (const bar of sk.bars) {
        expect(bar.h).toBeGreaterThanOrEqual(lo);
        expect(bar.h).toBeLessThan(hi);
      }
    }
    expect(skyline(seed, 'top').bars[0].h).toBeCloseTo(7.62886, 4);
    expect(skyline(seed, 'bottom').bars[0].h).toBeCloseTo(10.80412, 4);
    expect(skyline(seed, 'top').w).toBe(6);
    expect(skyline(seed, 'bottom').w).toBe(7);
  });

  it('rz stays within [lo, hi)', () => {
    for (let i = 0; i < 50; i++) {
      const v = rz(12345, i, 4, 12);
      expect(v).toBeGreaterThanOrEqual(4);
      expect(v).toBeLessThan(12);
    }
  });
});
