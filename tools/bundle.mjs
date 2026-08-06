/**
 * Inlines the whole game into one self-contained .html file.
 *
 * This exists because of Android. Tapping an .html file in an Android file
 * manager hands it to a preview WebView that disables JavaScript and often
 * copies only the tapped file into a cache directory -- so ./js/ and ./data/
 * are not merely blocked, they genuinely are not there. The page renders its
 * static markup and nothing runs.
 *
 * A single file with no siblings to resolve sidesteps all of it. That is only
 * possible because the game has zero runtime dependencies and no images: the
 * entire payload is one stylesheet, ten scripts and the map data.
 *
 * Zero dependencies. Run: npm run bundle
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const OUT = join(REPO, 'dist', 'india-map-puzzle.html');

const MAX_BYTES = 250 * 1024;

/**
 * A literal `</script>` anywhere inside inlined JS would close the tag early and
 * dump the rest of the file into the page as text. Splitting it is the standard
 * escape and is invisible to the parser.
 */
const escapeForInline = (js) => js.replace(/<\/script/gi, '<\\/script');

const read = (rel) => readFileSync(join(REPO, rel), 'utf8');

let html = read('index.html');

// --- stylesheet -----------------------------------------------------------

const linkRe = /[ \t]*<link rel="stylesheet" href="\.\/([^"]+)">\n?/;
const linkMatch = html.match(linkRe);
if (!linkMatch) throw new Error('could not find the stylesheet <link> in index.html');

const css = read(linkMatch[1]);
html = html.replace(linkRe, `<style>\n${css}\n</style>\n`);

// --- scripts --------------------------------------------------------------

// Order is load-bearing: config -> util -> store -> data -> ... -> game.
// `defer` guaranteed document order for external scripts; inline scripts run
// where they sit, which preserves exactly the same sequence.
const scriptRe = /[ \t]*<script defer src="\.\/([^"]+)"><\/script>\n?/g;

const inlined = [];
html = html.replace(scriptRe, (_, rel) => {
  const js = read(rel);
  inlined.push({ rel, bytes: Buffer.byteLength(js) });
  return `<script>\n/* ${rel} */\n${escapeForInline(js)}\n</script>\n`;
});

if (!inlined.length) throw new Error('no <script defer src> tags found in index.html');

// --- sanity ---------------------------------------------------------------

// Nothing may still point at a sibling file, or the whole exercise is pointless.
const leftovers = [...html.matchAll(/(?:src|href)="\.\/[^"]+"/g)].map((m) => m[0]);
if (leftovers.length) {
  throw new Error('unbundled relative reference(s) remain: ' + leftovers.join(', '));
}

if (!html.includes('window.INDIA_MAP')) {
  throw new Error('map data missing from the bundle');
}

html = html.replace(
  '<title>India Map Puzzle</title>',
  '<title>India Map Puzzle</title>\n<!-- Self-contained build. Everything is inline;\n' +
    '     this file needs no other files and no network. -->'
);

// --- write ----------------------------------------------------------------

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);

const bytes = Buffer.byteLength(html);
console.log('inlined:');
console.log(`  ${linkMatch[1].padEnd(24)} ${(Buffer.byteLength(css) / 1024).toFixed(1)} KB`);
for (const s of inlined) {
  console.log(`  ${s.rel.padEnd(24)} ${(s.bytes / 1024).toFixed(1)} KB`);
}
console.log(`\nwrote ${resolve(OUT)}  ${(bytes / 1024).toFixed(1)} KB`);

if (bytes > MAX_BYTES) {
  console.error(`FAIL: exceeds ${MAX_BYTES / 1024} KB budget`);
  process.exit(1);
}
