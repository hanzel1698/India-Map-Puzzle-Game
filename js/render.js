/* Builds the board SVG and the tray tiles.
 *
 * Layer order in the board matters and is fixed here:
 *   silhouette -> insets -> slots -> placed -> hint
 * SVG has no z-index; painting order IS stacking order, so a group appended
 * later always draws on top.
 *
 * Dragged pieces are deliberately NOT in this SVG at all -- see drag.js.
 */
(function (IMP) {
  'use strict';

  const { svg, el } = IMP.util;
  const CFG = IMP.config;

  const M = window.INDIA_MAP;
  const [, , VW, VH] = M.viewBox;

  const byId = {};
  M.states.forEach((s, i) => {
    byId[s.id] = s;
    s.color = CFG.PALETTE[i % CFG.PALETTE.length];
  });

  /** Padded viewBox string for showing one piece on its own. */
  function pieceViewBox(state) {
    const p = CFG.PIECE_PAD;
    const [x0, y0, x1, y1] = state.bbox;
    return `${x0 - p} ${y0 - p} ${x1 - x0 + p * 2} ${y1 - y0 + p * 2}`;
  }

  /**
   * One piece as standalone SVG markup, used by both the tray tile and the drag
   * ghost so the two can never drift apart visually.
   *
   * paint-order="stroke fill" draws the white border UNDER the fill, so the
   * visible edge is a clean outer halo and the state's actual shape is not
   * eroded by half the stroke width.
   */
  /**
   * Andaman & Nicobar and Lakshadweep are dozens of islands each a fraction of a
   * viewBox unit across -- at tile size they are sub-pixel and the piece looks
   * blank. Drawing them again underneath with a fat round stroke swells each
   * speck into a visible dot. This is the minimum-feature-size convention every
   * printed atlas uses; the geometry itself is untouched.
   */
  function islandDots(state) {
    if (!state.inset) return '';
    return (
      `<path d="${state.d}" fill="none" stroke="${state.color}" stroke-width="7" ` +
      `stroke-linejoin="round" stroke-linecap="round"/>`
    );
  }

  function pieceSVG(state, opts) {
    const o = opts || {};
    const [x0, y0, x1, y1] = state.bbox;
    const w = x1 - x0;
    const h = y1 - y0;
    const emojiSize = Math.max(16, Math.min(w, h) * 0.42);

    return (
      `<svg viewBox="${pieceViewBox(state)}" class="piece-svg" aria-hidden="true" focusable="false">` +
      `<path d="${state.d}" fill="${state.color}" stroke="#fff" stroke-width="${CFG.STROKE}" ` +
      `stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill"/>` +
      islandDots(state) +
      (CFG.USE_EMOJI && !o.noEmoji
        ? `<text x="${state.c[0]}" y="${state.c[1]}" class="piece-emoji" ` +
          `font-size="${emojiSize}" text-anchor="middle" dominant-baseline="central">${state.emoji}</text>`
        : '') +
      `</svg>`
    );
  }

  /** Build the board for a level. Returns a map of id -> placed <path>. */
  function buildBoard(board, activeStates) {
    board.setAttribute('viewBox', M.viewBox.join(' '));
    board.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    board.innerHTML = '';

    const defs = svg('defs', {}, board);
    const shadow = svg('filter', {
      id: 'fx-shadow',
      x: '-20%', y: '-20%', width: '140%', height: '140%',
    }, defs);
    svg('feDropShadow', {
      dx: 0, dy: 3, stdDeviation: 3, 'flood-color': '#000', 'flood-opacity': 0.28,
    }, shadow);

    // 1. The grey body of India. Always the full country, so level 1 still reads
    //    as India with six coloured pieces on it rather than six floating blobs.
    const gSil = svg('g', { id: 'g-silhouette' }, board);
    svg('path', {
      d: M.outline,
      fill: '#ded8cd',
      stroke: '#c9c2b4',
      'stroke-width': 2,
      'stroke-linejoin': 'round',
    }, gSil);

    // 2. Inset frames for the offshore territories.
    const gInsets = svg('g', { id: 'g-insets' }, board);
    M.insets.forEach((box) => {
      const s = byId[box.id];
      if (!activeStates.some((a) => a.id === box.id)) return;
      svg('rect', {
        x: box.x - 6, y: box.y - 6, width: box.w + 12, height: box.h + 12,
        rx: 10, fill: 'none', stroke: '#c9c2b4',
        'stroke-width': 2, 'stroke-dasharray': '10 8',
      }, gInsets);
      svg('text', {
        x: box.x + box.w / 2, y: box.y - 14,
        'text-anchor': 'middle', class: 'inset-label',
        // Short form: the full "Andaman and Nicobar Islands" is wider than the
        // box and runs back over the mainland.
        text: box.id === 'AN' ? 'Andaman & Nicobar' : s.name,
      }, gInsets);
    });

    // 3. Slots: where each piece belongs, shown as a recessed shape plus the
    //    matching emoji. The emoji is the whole trick for a child who cannot
    //    read -- they match picture to picture, not word to word.
    const gSlots = svg('g', { id: 'g-slots' }, board);
    const gPlaced = svg('g', { id: 'g-placed' }, board);
    const gHint = svg('g', { id: 'g-hint' }, board);

    const placed = {};

    activeStates.forEach((s) => {
      const slot = svg('g', { class: 'slot', 'data-id': s.id }, gSlots);
      // Noticeably darker than the surrounding silhouette. At level 1 only six
      // states are cut out of the map, and a four-year-old has to be able to see
      // at a glance which holes are waiting to be filled.
      svg('path', {
        d: s.d,
        fill: '#b3a894',
        // Island groups need the same dot treatment as their pieces, or the slot
        // they have to aim at is invisible too.
        stroke: s.inset ? '#b3a894' : '#9a8f7b',
        'stroke-width': s.inset ? 7 : 2.5,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }, slot);

      // Tiny states get a halo ring the size of the snap radius, so the child
      // has something to aim at that is bigger than three pixels of polygon.
      if (s.minScale > 1) {
        svg('circle', {
          class: 'slot-halo',
          cx: s.c[0], cy: s.c[1],
          r: Math.max(26, Math.hypot(s.bbox[2] - s.bbox[0], s.bbox[3] - s.bbox[1])),
          fill: 'none', stroke: '#a89e8b', 'stroke-width': 2.5,
          'stroke-dasharray': '6 6',
        }, slot);
      }

      if (CFG.USE_EMOJI) {
        const size = Math.max(
          18,
          Math.min(46, Math.min(s.bbox[2] - s.bbox[0], s.bbox[3] - s.bbox[1]) * 0.4)
        );
        svg('text', {
          class: 'slot-emoji',
          x: s.c[0], y: s.c[1],
          'font-size': size,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          text: s.emoji,
        }, slot);
      }

      // The finished piece, invisible until it is placed.
      const group = svg('g', { class: 'placed-group', opacity: 0 }, gPlaced);
      const p = svg('path', {
        class: 'placed',
        'data-id': s.id,
        d: s.d,
        fill: s.color,
        stroke: '#fff',
        'stroke-width': CFG.STROKE,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
        'paint-order': 'stroke fill',
        filter: 'url(#fx-shadow)',
        opacity: 0,
      }, group);

      if (s.inset) {
        svg('path', {
          d: s.d,
          fill: 'none',
          stroke: s.color,
          'stroke-width': 7,
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        }, group);
      }

      placed[s.id] = p;
      p._group = group;
    });

    void gHint;
    return placed;
  }

  /** One tray tile: a real <button>, so keyboard and assistive tech work. */
  function buildTile(state) {
    const btn = el('button', {
      class: 'tile',
      type: 'button',
      role: 'option',
      'data-id': state.id,
      'aria-label': state.name,
      tabindex: '-1',
    });
    btn.innerHTML =
      `<span class="tile-art">${pieceSVG(state)}</span>` +
      `<span class="tile-name">${state.name}</span>`;
    return btn;
  }

  IMP.render = { buildBoard, buildTile, pieceSVG, pieceViewBox, byId, VW, VH, M };
})((window.IMP = window.IMP || {}));
