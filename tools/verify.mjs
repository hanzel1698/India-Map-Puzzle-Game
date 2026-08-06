/**
 * Invariants on the generated data/states.js. Zero dependencies.
 *
 * The tiling check at the bottom is the important one. Simplifying polygon
 * boundaries independently is the classic way to open hairline gaps between
 * neighbours, and gaps are exactly the bug you cannot see in a screenshot but
 * that makes a puzzle feel broken. Everything above it is cheap sanity checking.
 *
 * Run: node verify.mjs
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data', 'states.js');

const MAX_BYTES = 150 * 1024;
const GRID = 500;
const MIN_COVERAGE = 0.997;   // fraction of interior points covered by >= 1 state
const MAX_OVERLAP = 0.005;    // fraction covered by more than one state

const EXPECTED_NAMES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam',
  'Bihar', 'Chandigarh', 'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka',
  'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal',
];

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

// --- load in a sandbox ----------------------------------------------------

const src = readFileSync(DATA, 'utf8');
const sandbox = { window: {} };
createContext(sandbox);
runInContext(src, sandbox);
const M = sandbox.window.INDIA_MAP;

if (!M) {
  console.error('data/states.js did not assign window.INDIA_MAP');
  process.exit(1);
}

const [, , VW, VH] = M.viewBox;

console.log(`\ndata/states.js  ${(statSync(DATA).size / 1024).toFixed(1)} KB  viewBox ${VW}x${VH}\n`);

// --- structure ------------------------------------------------------------

check(M.states.length === 36, 'exactly 36 states/UTs', `got ${M.states.length}`);

const names = M.states.map((s) => s.name).sort();
const missing = EXPECTED_NAMES.filter((n) => !names.includes(n));
check(missing.length === 0, 'all 36 expected names present', missing.join(', '));

const ids = M.states.map((s) => s.id);
check(new Set(ids).size === 36, 'ids unique');

const emojis = M.states.map((s) => s.emoji);
const dupes = emojis.filter((e, i) => emojis.indexOf(e) !== i);
check(
  new Set(emojis).size === 36,
  'emoji unique (a pre-reader matches on these)',
  dupes.join(' ')
);

check(M.states.every((s) => s.sticker && s.say), 'every state has sticker + say text');

const l1 = M.states.filter((s) => s.level === 1).length;
const l2 = M.states.filter((s) => s.level <= 2).length;
check(l1 === 6 && l2 === 12, 'level counts are 6 / 12 / 36', `got ${l1} / ${l2} / 36`);

check(statSync(DATA).size < MAX_BYTES, `under ${MAX_BYTES / 1024} KB`);

// --- geometry -------------------------------------------------------------

const PATH_RE = /^M[\d\s.,\-LMZ]+Z$/;

let badPath = null, outOfBox = null, badCentre = null;

for (const s of M.states) {
  if (!PATH_RE.test(s.d) || /NaN|Infinity|undefined/.test(s.d)) { badPath = s.id; break; }
  const [x0, y0, x1, y1] = s.bbox;
  if (x0 < -1 || y0 < -1 || x1 > VW + 1 || y1 > VH + 1) { outOfBox = s.id; break; }
  const [cx, cy] = s.c;
  if (cx < x0 || cx > x1 || cy < y0 || cy > y1) { badCentre = s.id; break; }
}

check(!badPath, 'all paths well-formed and finite', badPath || '');
check(!outOfBox, 'all bboxes inside the viewBox', outOfBox || '');
check(!badCentre, 'every label anchor sits inside its own bbox', badCentre || '');
check(PATH_RE.test(M.outline), 'silhouette path well-formed');
check(M.insets.length === 2, 'two inset boxes (Andaman, Lakshadweep)');

// --- tiling ---------------------------------------------------------------

/** Parse an absolute M/L/Z path into closed rings. */
function parseRings(d) {
  const rings = [];
  for (const chunk of d.split('M').slice(1)) {
    const ring = chunk.replace(/Z$/, '').split('L').map((p) => {
      const [x, y] = p.trim().split(/[\s,]+/).map(Number);
      return [x, y];
    });
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Even-odd point-in-rings. Holes fall out for free: they flip parity back. */
function inRings(rings, px, py) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) &&
          px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

const outlineRings = parseRings(M.outline);

// The offshore territories are drawn in inset boxes, deliberately outside the
// mainland silhouette, so they are not part of the tiling contract.
const mainland = M.states.filter((s) => !s.inset).map((s) => ({
  id: s.id,
  rings: parseRings(s.d),
  bbox: s.bbox,
}));

let interior = 0, covered = 0, overlapped = 0;
const gapsBy = new Map();

for (let gy = 0; gy < GRID; gy++) {
  const py = ((gy + 0.5) / GRID) * VH;
  for (let gx = 0; gx < GRID; gx++) {
    const px = ((gx + 0.5) / GRID) * VW;
    if (!inRings(outlineRings, px, py)) continue;
    interior++;

    let n = 0, last = null;
    for (const s of mainland) {
      const [x0, y0, x1, y1] = s.bbox;
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;   // cheap reject
      if (inRings(s.rings, px, py)) { n++; last = s.id; }
    }
    if (n >= 1) covered++;
    if (n > 1) overlapped++;
    if (n === 0) {
      // Attribute the gap to the nearest state centre, for a useful message.
      let best = null, bestD = Infinity;
      for (const s of M.states) {
        const d = Math.hypot(s.c[0] - px, s.c[1] - py);
        if (d < bestD) { bestD = d; best = s.id; }
      }
      gapsBy.set(best, (gapsBy.get(best) || 0) + 1);
    }
    void last;
  }
}

const covFrac = covered / interior;
const ovFrac = overlapped / interior;

console.log(`\n  tiling: sampled ${interior} interior points on a ${GRID}x${GRID} grid`);

const worstGaps = [...gapsBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

check(
  covFrac >= MIN_COVERAGE,
  `no gaps between states (>=${(MIN_COVERAGE * 100).toFixed(1)}% covered)`,
  `${(covFrac * 100).toFixed(2)}%` +
    (covFrac < MIN_COVERAGE && worstGaps.length
      ? ` -- worst near ${worstGaps.map(([id, n]) => `${id}:${n}`).join(' ')}`
      : '')
);

check(
  ovFrac <= MAX_OVERLAP,
  `states do not overlap (<=${(MAX_OVERLAP * 100).toFixed(1)}%)`,
  `${(ovFrac * 100).toFixed(2)}%`
);

console.log(
  failures === 0
    ? '\nall checks passed\n'
    : `\n${failures} check(s) failed\n`
);
process.exit(failures === 0 ? 0 : 1);
