/**
 * Downloads the source map data. Zero dependencies.
 *
 * The URL is pinned to a commit, not a branch, so regenerating the map a year
 * from now produces byte-identical input. cdn.jsdelivr.net is deliberately not
 * used -- it is blocked by the proxy in some environments; raw.githubusercontent
 * is not.
 *
 * TopoJSON rather than the GeoJSON sibling, and the reason matters: TopoJSON
 * stores each shared district border once, as an arc. Simplification therefore
 * moves both sides of every border identically. Simplifying independent GeoJSON
 * polygons is what opens hairline gaps between neighbouring states.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '.cache', 'india.topo.json');

const BASE = 'https://raw.githubusercontent.com/udit-001/india-maps-data/2884453';

const SOURCE = `${BASE}/topojson/india.json`;

/* The combined topology carries Lakshadweep as a 4-vertex sliver spanning
 * 0.04 x 0.01 degrees -- about 4km, for an archipelago that really runs over
 * 3.4 degrees of latitude. It is simply broken in that file. The per-state file
 * has the real thing: 35 islands, correct extent. Lakshadweep shares no border
 * with anything, so splicing it in cannot disturb the topology everything else
 * depends on. */
const LAKSHADWEEP = `${BASE}/geojson/states/lakshadweep.geojson`;

// Recorded from the pinned commit. A mismatch means the pin moved, which should
// be impossible -- warn loudly rather than fail, so a hash bump is a conscious act.
const EXPECTED_SHA256 =
  '5bf4f880f507afa8a3f3578d2e9d938abc1eb16ac7aa54d2e89975e8acaaf457';
const EXPECTED_BYTES = 886611;

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) return reject(new Error('too many redirects'));
    import('node:https').then(({ default: https }) => {
      https
        .get(url, { headers: { 'user-agent': 'india-map-puzzle-build' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return resolve(get(new URL(res.headers.location, url).href, redirects - 1));
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          }
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        })
        .on('error', reject);
    }, reject);
  });
}

const LD_OUT = join(HERE, '.cache', 'lakshadweep.geojson');
const force = process.argv.includes('--force');

const main = async () => {
  mkdirSync(dirname(OUT), { recursive: true });
  await fetchTopology();
  await fetchLakshadweep();
};

const fetchTopology = async () => {
  if (existsSync(OUT) && !force) {
    console.log(`cached  ${OUT}  ${readFileSync(OUT).length} bytes (pass --force to refetch)`);
    return;
  }

  console.log(`fetching ${SOURCE}`);
  const buf = await get(SOURCE);
  const sha = createHash('sha256').update(buf).digest('hex');

  console.log(`  bytes  ${buf.length}`);
  console.log(`  sha256 ${sha}`);

  if (buf.length !== EXPECTED_BYTES) {
    console.warn(
      `  WARNING size ${buf.length} != expected ${EXPECTED_BYTES}. The pin may have moved.`
    );
  }
  if (EXPECTED_SHA256 !== sha) {
    console.warn(`  NOTE   sha256 differs from the value recorded in this script.`);
    console.warn(`         If the byte count matched, just update EXPECTED_SHA256 to:`);
    console.warn(`         ${sha}`);
  }

  // Sanity-check the shape before anything downstream trusts it.
  const topo = JSON.parse(buf.toString('utf8'));
  if (topo.type !== 'Topology' || !topo.objects?.districts) {
    throw new Error('unexpected structure: expected a Topology with objects.districts');
  }
  const n = topo.objects.districts.geometries.length;
  const states = new Set(topo.objects.districts.geometries.map((g) => g.properties.st_nm));
  console.log(`  ${n} districts across ${states.size} states/UTs`);
  if (states.size !== 36) {
    throw new Error(`expected 36 states/UTs, found ${states.size}`);
  }

  writeFileSync(OUT, buf);
  console.log(`wrote ${OUT}`);
};

const fetchLakshadweep = async () => {
  if (existsSync(LD_OUT) && !force) {
    console.log(`cached  ${LD_OUT}`);
    return;
  }

  console.log(`fetching ${LAKSHADWEEP}`);
  const ld = await get(LAKSHADWEEP);
  const islands = JSON.parse(ld.toString('utf8')).features.reduce((n, f) => {
    const polys = f.geometry.type === 'Polygon'
      ? [f.geometry.coordinates]
      : f.geometry.coordinates;
    return n + polys.reduce((m, p) => m + p.length, 0);
  }, 0);

  console.log(`  ${ld.length} bytes, ${islands} islands`);
  if (islands < 10) {
    throw new Error('per-state Lakshadweep looks degraded too; check the source');
  }

  writeFileSync(LD_OUT, ld);
  console.log(`wrote ${LD_OUT}`);
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
