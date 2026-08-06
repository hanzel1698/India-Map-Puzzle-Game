/**
 * Pole of inaccessibility -- the point furthest from a polygon's edges, i.e. the
 * most "inside" point there is.
 *
 * This is not the same as the centroid, and the difference is the whole reason
 * this file exists. For a concave state the arithmetic centroid can land outside
 * the polygon entirely: Gujarat's centroid falls in the Gulf of Khambhat, and
 * using it would put Gujarat's emoji marker in the sea. Every label anchor and
 * every snap target in this game uses the pole instead.
 *
 * Standard quadtree bisection (the algorithm behind Mapbox's polylabel), with a
 * plain array used as the priority queue -- with a few dozen cells the O(n) scan
 * for the best cell is cheaper than maintaining a heap.
 *
 * @param {number[][][]} rings [outer, ...holes], each a closed ring of [x, y]
 * @param {number} precision stop when no cell can beat the best by more than this
 * @returns {[number, number]}
 */
export function polylabel(rings, precision = 0.5) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of rings[0]) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const cellSize = Math.min(width, height);
  if (cellSize === 0) return [minX, minY];

  let h = cellSize / 2;
  const queue = [];
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      queue.push(cell(x + h, y + h, h, rings));
    }
  }

  // Seed with the centroid, then with the bbox centre -- whichever is better.
  let best = centroidCell(rings[0], h);
  const bboxCell = cell(minX + width / 2, minY + height / 2, 0, rings);
  if (bboxCell.d > best.d) best = bboxCell;

  while (queue.length) {
    // Pop the cell with the greatest potential.
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].max > queue[bestIdx].max) bestIdx = i;
    }
    const c = queue.splice(bestIdx, 1)[0];

    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;

    h = c.h / 2;
    queue.push(cell(c.x - h, c.y - h, h, rings));
    queue.push(cell(c.x + h, c.y - h, h, rings));
    queue.push(cell(c.x - h, c.y + h, h, rings));
    queue.push(cell(c.x + h, c.y + h, h, rings));
  }

  return [best.x, best.y];
}

function cell(x, y, h, rings) {
  const d = pointToPolygonDist(x, y, rings);
  // The best a cell could possibly contain is its centre distance plus its
  // half-diagonal -- that bound is what makes the search terminate quickly.
  return { x, y, h, d, max: d + h * Math.SQRT2 };
}

function centroidCell(ring, h) {
  let area = 0, x = 0, y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    const f = a[0] * b[1] - b[0] * a[1];
    x += (a[0] + b[0]) * f;
    y += (a[1] + b[1]) * f;
    area += f * 3;
  }
  if (area === 0) return cell(ring[0][0], ring[0][1], 0, [ring]);
  return cell(x / area, y / area, h, [ring]);
}

/** Signed distance: positive inside the polygon, negative outside. */
function pointToPolygonDist(x, y, rings) {
  let inside = false;
  let minDistSq = Infinity;

  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y) &&
          x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) {
        inside = !inside;
      }
      minDistSq = Math.min(minDistSq, segDistSq(x, y, a, b));
    }
  }

  if (minDistSq === Infinity) return -Infinity;
  return (inside ? 1 : -1) * Math.sqrt(minDistSq);
}

function segDistSq(px, py, a, b) {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}
