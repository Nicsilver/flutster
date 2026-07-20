import { describe, it, expect } from 'vitest';
import { DESIGNS, designFor } from '../src/cardstyle.js';

// Mix assignment hashes the track URI against the selected-design list, in
// DESIGNS order. If any locked value here drifts, a re-generated deck deals
// different backs than the printed cards on the table.
const AHA = 'spotify:track:2WfaOiMkCvy7F5fcp2zZ8L'; // hashStr = 111901

describe('card-back design picker', () => {
  it('ships the 11 approved designs, skyline first', () => {
    expect(DESIGNS.length).toBe(11);
    expect(DESIGNS[0].id).toBe('skyline');
    expect(new Set(DESIGNS.map((d) => d.id)).size).toBe(11);
    for (const d of DESIGNS) expect(d.name).toBeTruthy();
  });

  it('falls back to skyline without a selection', () => {
    expect(designFor(AHA, null)).toBe('skyline');
    expect(designFor(AHA, [])).toBe('skyline');
  });

  it('a single selection covers the whole deck', () => {
    expect(designFor(AHA, ['led'])).toBe('led');
    expect(designFor('anything', ['viewfinder'])).toBe('viewfinder');
  });

  it('mix assignment is locked (111901 % list length)', () => {
    const all = DESIGNS.map((d) => d.id);
    expect(designFor(AHA, all)).toBe('ledkit'); // 111901 % 11 = 9
    expect(designFor(AHA, ['skyline', 'led', 'ring'])).toBe('led'); // % 3 = 1
    expect(designFor(AHA, ['skyline', 'led'])).toBe('led'); // % 2 = 1
  });

  it('assignment is deterministic across calls', () => {
    const all = DESIGNS.map((d) => d.id);
    expect(designFor(AHA, all)).toBe(designFor(AHA, all));
  });
});
