/**
 * Turns the simplified GeoJSON into data/states.js -- the single file the game
 * loads. Zero dependencies.
 *
 * Everything the browser needs is baked in here: SVG path data, where each piece
 * belongs, where its label goes, how big to draw it in the tray. The game never
 * fetches anything at runtime, which is what lets index.html work when it is
 * simply double-clicked (fetch() is blocked on file://).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { project } from './lib/projection.mjs';
import { polylabel } from './lib/polylabel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

// --- tunables -------------------------------------------------------------

const VIEW_W = 1000;          // viewBox width; height is derived from the aspect
const PAD = 26;               // viewBox units of breathing room around the map

// Offshore territories are drawn in enlarged inset boxes rather than at true
// position and scale. This is the convention printed Indian atlases use, and it
// is also the only way to make them draggable -- at true scale Lakshadweep is a
// few pixels across.
const INSET_IDS = ['AN', 'LD'];

// Fixed box, in viewBox units, rather than one derived from each territory's own
// aspect ratio. The Andaman chain runs nearly 7 degrees north to south, so an
// aspect-derived box comes out taller than the map and covers Bengal. Content is
// scaled to fit inside instead.
const INSET_W = 150;
const INSET_H = 215;
const INSET_FIT = 0.84;       // fraction of the box the geometry fills

// Drop rings smaller than this fraction of the state's largest ring. Removes
// offshore specks without a global threshold, which would delete Lakshadweep
// (whose largest ring IS a speck) along with them.
const RING_KEEP_FRAC = 0.04;

// States whose separate parts are scattered too far to be one draggable piece.
// Puducherry's four territories span ~700km across three different states.
// Keeping only the largest part loses real territory -- documented in NOTICE.md.
const COLLAPSE_TO_LARGEST = ['PY', 'DH'];

// A piece smaller than this (viewBox units, bbox diagonal) is drawn oversized in
// the tray and shrinks into place on a correct drop. The SLOT stays true size,
// so the board still tiles exactly.
const MIN_PIECE_DIAG = 52;
const MAX_PIECE_SCALE = 3.5;

// --- helpers --------------------------------------------------------------

const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
};

const absArea = (ring) => Math.abs(ringArea(ring));

/** GeoJSON Polygon|MultiPolygon -> array of polygons, each [outer, ...holes]. */
const toPolygons = (geom) =>
  geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;

const bboxOf = (polys) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
};

const round1 = (n) => {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

/**
 * Absolute M/L/Z only. No curves: the smoothing already happened geometrically
 * in mapshaper, and fitting Beziers over it would only add bytes and risk
 * self-intersections. The rounded-corner look is a render concern -- a thick
 * stroke with stroke-linejoin:round gives it for free and costs nothing here.
 */
const toPath = (polys) => {
  let d = '';
  for (const poly of polys) {
    for (const ring of poly) {
      // A closed GeoJSON ring repeats its first point; Z already does that.
      const pts = ring.length > 1 &&
        ring[0][0] === ring[ring.length - 1][0] &&
        ring[0][1] === ring[ring.length - 1][1]
        ? ring.slice(0, -1)
        : ring;
      if (pts.length < 3) continue;
      d += 'M' + pts.map(([x, y]) => `${round1(x)} ${round1(y)}`).join('L') + 'Z';
    }
  }
  return d;
};

// --- load -----------------------------------------------------------------

const states = JSON.parse(
  readFileSync(join(HERE, 'derived', 'states.geojson'), 'utf8')
);

// Swap in the repaired Lakshadweep. See fetch-map.mjs for why the version in the
// combined topology is unusable.
{
  const ld = JSON.parse(
    readFileSync(join(HERE, 'derived', 'lakshadweep.geojson'), 'utf8')
  );
  const parts = (ld.features || []).flatMap((f) => toPolygons(f.geometry));
  const idx = states.features.findIndex((f) => f.properties.st_nm === 'Lakshadweep');
  if (idx < 0) throw new Error('Lakshadweep missing from states.geojson');
  if (!parts.length) throw new Error('repaired Lakshadweep is empty');
  states.features[idx] = {
    type: 'Feature',
    properties: { st_nm: 'Lakshadweep' },
    geometry: { type: 'MultiPolygon', coordinates: parts },
  };
}
const outline = JSON.parse(
  readFileSync(join(HERE, 'derived', 'outline.geojson'), 'utf8')
);
const meta = JSON.parse(readFileSync(join(HERE, 'meta', 'states.json'), 'utf8'));
delete meta._readme;

// --- 1. project every state, prune rings, collapse exclaves ---------------

const items = [];

for (const feature of states.features) {
  const name = feature.properties.st_nm;
  const m = meta[name];
  if (!m) throw new Error(`no metadata entry for "${name}" -- add it to tools/meta/states.json`);

  // Project first, prune second: ring areas should be compared in the same
  // space we will actually draw them in.
  let polys = toPolygons(feature.geometry).map((poly) =>
    poly.map((ring) => ring.map(([lon, lat]) => project(lon, lat)))
  );

  polys.sort((a, b) => absArea(b[0]) - absArea(a[0]));

  if (COLLAPSE_TO_LARGEST.includes(m.id)) {
    polys = [polys[0]];
  } else {
    const biggest = absArea(polys[0][0]);
    polys = polys.filter((p, i) => i === 0 || absArea(p[0]) >= biggest * RING_KEEP_FRAC);
  }

  items.push({ name, meta: m, polys });
}

if (items.length !== 36) throw new Error(`expected 36 states, got ${items.length}`);

// --- 2. fit the mainland to the viewBox -----------------------------------

// The fit deliberately ignores the offshore territories. Including the Andamans
// would push the mainland into the top-left corner of the viewBox and shrink
// every piece a child actually has to drag.
const mainland = items.filter((it) => !INSET_IDS.includes(it.meta.id));
const [mx0, my0, mx1, my1] = bboxOf(mainland.flatMap((it) => it.polys));

const k = (VIEW_W - PAD * 2) / (mx1 - mx0);
const VIEW_H = Math.round((my1 - my0) * k + PAD * 2);

// y is flipped here: projected y increases north, SVG y increases downward.
const toSvg = ([x, y]) => [PAD + (x - mx0) * k, VIEW_H - PAD - (y - my0) * k];

for (const it of mainland) {
  it.polys = it.polys.map((poly) => poly.map((ring) => ring.map(toSvg)));
}

// --- 3. place the offshore territories in inset boxes ---------------------

const insets = [];

INSET_IDS.forEach((id) => {
  const it = items.find((s) => s.meta.id === id);
  if (!it) throw new Error(`inset target ${id} not found`);

  const [x0, y0, x1, y1] = bboxOf(it.polys);

  // Bottom corners, which is where the sea is: Lakshadweep off the west coast,
  // Andaman off the east. Both land clear of the mainland silhouette.
  const bx = id === 'LD' ? PAD : VIEW_W - PAD - INSET_W;
  const by = Math.max(PAD, VIEW_H - PAD - INSET_H);

  const ik = Math.min(INSET_W / (x1 - x0), INSET_H / (y1 - y0)) * INSET_FIT;
  const cx = bx + INSET_W / 2;
  const cy = by + INSET_H / 2;

  it.polys = it.polys.map((poly) =>
    poly.map((ring) =>
      ring.map(([x, y]) => [
        cx + (x - (x0 + x1) / 2) * ik,
        cy - (y - (y0 + y1) / 2) * ik,
      ])
    )
  );

  insets.push({
    id,
    x: +bx.toFixed(1),
    y: +by.toFixed(1),
    w: INSET_W,
    h: INSET_H,
    scale: +ik.toFixed(3),
  });
});

// --- 4. emit per-state records --------------------------------------------

const out = [];

for (const it of items) {
  const { id, emoji, level, say, sticker } = it.meta;
  const [x0, y0, x1, y1] = bboxOf(it.polys);
  const diag = Math.hypot(x1 - x0, y1 - y0);

  // Anchor on the largest ring, so the marker sits in the body of the state
  // rather than being pulled off by an island.
  const largest = it.polys.reduce(
    (a, b) => (absArea(b[0]) > absArea(a[0]) ? b : a),
    it.polys[0]
  );
  const [cx, cy] = polylabel(largest, 0.4);

  const area = it.polys.reduce((sum, poly) => sum + absArea(poly[0]), 0);

  out.push({
    id,
    name: it.name,
    say: say || it.name,
    emoji,
    sticker,
    level,
    inset: INSET_IDS.includes(id) || undefined,
    d: toPath(it.polys),
    c: [+cx.toFixed(1), +cy.toFixed(1)],
    bbox: [x0, y0, x1, y1].map((n) => +n.toFixed(1)),
    area: Math.round(area),
    minScale: +Math.min(
      MAX_PIECE_SCALE,
      Math.max(1, MIN_PIECE_DIAG / diag)
    ).toFixed(2),
  });
}

// --- 5. silhouette --------------------------------------------------------

// Project the dissolved outline through the same mainland fit, then drop any
// ring that lands outside the viewBox. Those are the offshore territories,
// which are drawn as insets instead -- keeping them would smear the silhouette
// across the whole board.
// The dissolved layer carries no attributes, so mapshaper writes it as a bare
// GeometryCollection rather than a FeatureCollection. Accept either.
const outlineGeoms = outline.features
  ? outline.features.map((f) => f.geometry)
  : outline.geometries;

const outlinePolys = [];
for (const geom of outlineGeoms) {
  for (const poly of toPolygons(geom)) {
    const projected = poly.map((ring) =>
      ring.map(([lon, lat]) => toSvg(project(lon, lat)))
    );
    const [ox0, oy0, ox1, oy1] = bboxOf([projected]);
    const outside =
      ox1 < -PAD || ox0 > VIEW_W + PAD || oy1 < -PAD || oy0 > VIEW_H + PAD;
    if (!outside) outlinePolys.push(projected);
  }
}

// --- 6. assertions --------------------------------------------------------

const emojis = out.map((s) => s.emoji);
const dupeEmoji = emojis.find((e, i) => emojis.indexOf(e) !== i);
if (dupeEmoji) {
  // Not cosmetic. The emoji is how a pre-reader matches piece to slot; two
  // states sharing one makes the puzzle genuinely ambiguous.
  throw new Error(`emoji ${dupeEmoji} is used by more than one state`);
}

const ids = out.map((s) => s.id);
const dupeId = ids.find((v, i) => ids.indexOf(v) !== i);
if (dupeId) throw new Error(`duplicate id ${dupeId}`);

for (const s of out) {
  if (!/^M[\d\s.,\-LMZ]+Z$/.test(s.d)) throw new Error(`${s.id}: malformed path`);
  if (/NaN|Infinity|undefined/.test(s.d)) throw new Error(`${s.id}: non-finite path data`);
}

// --- 7. write -------------------------------------------------------------

out.sort((a, b) => a.level - b.level || b.area - a.area);

const lines = out.map((s) => {
  const parts = [
    `id:${JSON.stringify(s.id)}`,
    `name:${JSON.stringify(s.name)}`,
    `say:${JSON.stringify(s.say)}`,
    `emoji:${JSON.stringify(s.emoji)}`,
    `sticker:${JSON.stringify(s.sticker)}`,
    `level:${s.level}`,
    s.inset ? 'inset:1' : null,
    `c:[${s.c}]`,
    `bbox:[${s.bbox}]`,
    `area:${s.area}`,
    `minScale:${s.minScale}`,
    `d:${JSON.stringify(s.d)}`,
  ].filter(Boolean);
  return '  {' + parts.join(',') + '}';
});

const js = `/* GENERATED FILE -- do not edit by hand.
 *
 * Regenerate with:  cd tools && npm install && npm run all
 *
 * Source data and its licensing caveats: see NOTICE.md.
 * Boundaries are heavily simplified for a children's game and are not
 * authoritative. Exclaves are collapsed; offshore territories are drawn as
 * insets. Do not use this for anything that matters.
 */
window.INDIA_MAP = {
 version: 1,
 viewBox: [0, 0, ${VIEW_W}, ${VIEW_H}],
 outline: ${JSON.stringify(toPath(outlinePolys.map((p) => p)))},
 insets: ${JSON.stringify(insets)},
 states: [
${lines.join(',\n')}
 ]
};
`;

const target = join(REPO, 'data', 'states.js');
writeFileSync(target, js);

// --- report ---------------------------------------------------------------

const bytes = Buffer.byteLength(js);
const verts = out.reduce((n, s) => n + (s.d.match(/[ML]/g) || []).length, 0);

console.log(`viewBox   0 0 ${VIEW_W} ${VIEW_H}`);
console.log(`states    ${out.length}  (L1 ${out.filter((s) => s.level === 1).length}, L2 ${out.filter((s) => s.level <= 2).length}, L3 ${out.length})`);
console.log(`vertices  ${verts}`);
console.log(`insets    ${insets.map((i) => i.id).join(', ')}`);
console.log(`oversized ${out.filter((s) => s.minScale > 1).map((s) => `${s.id}x${s.minScale}`).join(' ') || 'none'}`);
console.log(`wrote     ${target}  ${(bytes / 1024).toFixed(1)} KB`);
