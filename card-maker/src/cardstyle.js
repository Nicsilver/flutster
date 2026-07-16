// Shared design tokens + seeded randomness for the printed card design
// ("155": Baloo stack, wide year pill, double equalizer skyline).
//
// Colors are hashed from the track URI — NEVER from the year — so a glimpsed
// card corner can't leak the answer, and reprints come out identical. Fronts
// use a fixed palette + fixed seed so every front is pixel-identical (a
// distinctive front could be memorized across game nights).

export const POOL = [
  '#e8590c', '#d6336c', '#0ca678', '#1c7ed6', '#7048e8', '#f5c211',
  '#e64980', '#12b886', '#4263eb', '#f76707', '#37b24d', '#9c36b5',
];
export const SPECTRUM = ['#e3a008', '#e8590c', '#d6336c', '#0ca678', '#1c7ed6', '#7048e8'];
export const INK = '#161412';
export const TITLE_INK = '#2e2a23';

// FNV-1a, then clamped into the LCG's modulus.
export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 233280;
}

export function seededShuffle(pool, seed) {
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deterministic value in [lo, hi) from (seed, index).
export function rz(seed, i, lo, hi) {
  return lo + (((seed * 31 + i * 47) % 97) / 97) * (hi - lo);
}

export function cardColors(uri) {
  const seed = hashStr(uri || '');
  return { seed, palette: seededShuffle(POOL, seed) };
}

// Skyline geometry in mock units (176 = card side); consumers scale to their
// medium. Matches the approved mockup bar-for-bar.
export function skyline(seed, edge) {
  const top = edge === 'top';
  const s = top ? seed + 4 : seed;
  const n = 15;
  const [hLo, hHi] = top ? [4, 12] : [8, 24];
  const bars = [];
  for (let i = 0; i < n; i++) {
    bars.push({
      x: 12 + (i / (n - 1)) * (164 - 12),
      h: rz(s, i, hLo, hHi),
      ci: (s + i) % 12, // palette index (mod palette length at draw time)
    });
  }
  return { bars, w: top ? 6 : 7 };
}

// Fixed front: identical on every card, spectrum palette, constant seed.
export const FRONT_SEED = 7;
