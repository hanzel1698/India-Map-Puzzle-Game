#!/usr/bin/env bash
#
# Districts -> states, simplified for small hands.
#
# The flag order here is load-bearing; see the comments on each step. The one
# invariant that must survive is that neighbouring states share their border
# exactly, so the finished map tiles with no gaps and no overlaps. tools/verify.mjs
# is the detector for that -- if you change anything below, re-run it.
#
set -euo pipefail
cd "$(dirname "$0")"

MS="../node_modules/.bin/mapshaper"
SRC=".cache/india.topo.json"
OUT="derived"

# Percentage of vertices to RETAIN.
#
# The source `states` layer is already generalized -- 5,026 vertices for the whole
# country -- so the chunky look we want is mostly inherited, not something we have
# to simplify our way into. That makes the binding constraint island survival
# rather than shape quality: below about 70% the offshore rings start dropping
# (Andaman falls from 7 rings to 4, West Bengal's islands from 5 to 1), and those
# rings should be pruned deliberately in project.mjs, not lost at random here.
#
# 70% keeps ~3,600 vertices. Measured alternatives: 100% -> 5,055 v / 54 rings,
# 70% -> 3,579 / 44, 45% -> 2,357 / 39, 1.5% -> 303 / 36 (states become triangles).
SIMPLIFY="${SIMPLIFY:-70%}"

[ -f "$SRC" ] || { echo "missing $SRC -- run: node fetch-map.mjs" >&2; exit 1; }
mkdir -p "$OUT"

echo "==> simplifying 36 states (simplify=$SIMPLIFY)"

# The source topology carries TWO objects: `districts` (726) and `states` (36),
# both indexing the same shared arcs. So the states are already dissolved for us,
# by the people who made the data, against the same topology -- there is nothing
# to gain by re-dissolving the districts ourselves. Drop the district layer and
# work on `states` directly.
#
# -clean before simplifying rebuilds topology and snaps coincident vertices, so
# neighbouring states genuinely share arcs. Without it, "topology-preserving"
# simplification has no topology to preserve and hairline gaps open along every
# border. The trailing -clean repairs self-intersections that aggressive
# simplification can introduce.
#
# No global -filter-islands: any min-area big enough to drop offshore specks would
# also delete Lakshadweep and most of the Andamans. Island pruning is per-state,
# in project.mjs.
"$MS" "$SRC" \
  -target districts -drop \
  -target states \
  -filter-fields st_nm \
  -clean gap-fill-area=200km2 \
  -simplify weighted "$SIMPLIFY" keep-shapes \
  -clean \
  -o precision=0.0001 format=geojson "$OUT/states.geojson" \
  force

# The silhouette is dissolved from the ALREADY-SIMPLIFIED states, never from the
# source. Derived any other way, the grey outline and the coloured pieces would
# disagree along every coastline and the map would look broken at the edges.
echo "==> deriving silhouette from the simplified states"

# The offshore territories are excluded here. They are drawn in enlarged inset
# boxes, so leaving them in the silhouette would show the Andamans twice: once as
# a grey speck at its true position, and again as the piece the child is holding.
"$MS" "$OUT/states.geojson" \
  -filter 'st_nm != "Andaman and Nicobar Islands" && st_nm != "Lakshadweep"' \
  -dissolve name=outline \
  -o target=outline precision=0.0001 format=geojson "$OUT/outline.geojson" \
  force

# Lakshadweep, from the dedicated per-state file, because the combined topology
# has it as a 4-vertex sliver (see fetch-map.mjs). Simplified on its own, which
# is safe here and nowhere else: it is an island group with no shared borders,
# so there is no neighbouring geometry to fall out of step with.
echo "==> repairing Lakshadweep from the per-state source"

"$MS" .cache/lakshadweep.geojson \
  -filter-islands min-area=0.4km2 \
  -simplify weighted 40% keep-shapes \
  -o precision=0.0001 format=geojson "$OUT/lakshadweep.geojson" \
  force

# A quick human-eyeball artifact. Not used by the game.
"$MS" "$OUT/states.geojson" \
  -o format=svg width=900 "$OUT/preview.svg" \
  force

echo
ls -la "$OUT"
