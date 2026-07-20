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

// The back-design picker: 11 approved backs (card-lab rounds, 2026-07-19).
// Any subset can be active; with several active each card's design hashes
// from its track URI, so a given card keeps its back for as long as the
// selection stays the same. Order matters for that hash — keep selections
// in this canonical order.
export const DESIGNS = [
  { id: 'skyline', name: 'Skyline' },
  { id: 'border', name: 'Skyline Border' },
  { id: 'led', name: 'LED Border' },
  { id: 'brackets', name: 'Corner Brackets' },
  { id: 'rails', name: 'Ticket Rails' },
  { id: 'eq', name: 'EQ Corners' },
  { id: 'ring', name: 'LED Ring' },
  { id: 'edges', name: 'Skyline + Edges' },
  { id: 'borderink', name: 'Skyline Border · ink year' },
  { id: 'ledkit', name: 'LED Kit' },
  { id: 'viewfinder', name: 'Viewfinder' },
];
const DESIGN_IDS = new Set(DESIGNS.map((d) => d.id));

export function designFor(uri, selected) {
  if (!selected || selected.length === 0) return 'skyline';
  if (selected.length === 1) return selected[0];
  return selected[hashStr(uri || '') % selected.length];
}

const DESIGNS_KEY = 'flutster_carddesign';
export function loadDesigns() {
  try {
    const raw = JSON.parse(localStorage.getItem(DESIGNS_KEY) || '[]');
    const list = (Array.isArray(raw) ? raw : []).filter((id) => DESIGN_IDS.has(id));
    return list.length ? list : ['skyline'];
  } catch {
    return ['skyline'];
  }
}
export function saveDesigns(list) {
  try {
    localStorage.setItem(DESIGNS_KEY, JSON.stringify(list));
  } catch {}
}
