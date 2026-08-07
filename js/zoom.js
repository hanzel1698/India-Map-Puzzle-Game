/* Pan and zoom the map, by rewriting the board's viewBox.
 *
 * There is no gesture contention with dragging: pieces are picked up from the
 * tray and dropped onto the board, never dragged off it, so a one-finger drag on
 * the board itself is unused and can pan. Two fingers pinch.
 *
 * Hit-testing needs no changes at all. IMP.util.toViewBox goes through
 * getScreenCTM(), which reflects whatever the viewBox currently is, and the snap
 * radii are expressed in viewBox units -- so they are zoom-independent by
 * construction.
 */
(function (IMP) {
  'use strict';

  const MIN = 1;      // 1 = the whole map; never zoom out past it
  const MAX = 4;
  const STEP = 1.5;   // per button press

  let board = null;
  let base = null;    // the level's original viewBox, i.e. scale 1
  let view = null;    // current viewBox
  let onChange = null;

  // Active pointers on the board, by id, for pinch tracking.
  const points = new Map();
  let pinchStart = null;

  const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

  function scale() {
    return base && view ? base.w / view.w : 1;
  }

  /** Keep the visible window inside the map, so it cannot be lost off-screen. */
  function commit() {
    view.w = clamp(view.w, base.w / MAX, base.w);
    view.h = clamp(view.h, base.h / MAX, base.h);
    view.x = clamp(view.x, base.x, base.x + base.w - view.w);
    view.y = clamp(view.y, base.y, base.y + base.h - view.h);
    board.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    if (onChange) onChange(scale());
  }

  /** Zoom by a factor, holding the given viewBox point still on screen. */
  function zoomAt(factor, fx, fy) {
    if (!base) return;
    const next = clamp(scale() * factor, MIN, MAX);
    const w = base.w / next;
    const h = base.h / next;
    // Keep (fx, fy) at the same fractional position within the window.
    const rx = view.w ? (fx - view.x) / view.w : 0.5;
    const ry = view.h ? (fy - view.y) / view.h : 0.5;
    view.x = fx - rx * w;
    view.y = fy - ry * h;
    view.w = w;
    view.h = h;
    commit();
  }

  const centre = () => [view.x + view.w / 2, view.y + view.h / 2];

  function zoomIn() { const c = centre(); zoomAt(STEP, c[0], c[1]); }
  function zoomOut() { const c = centre(); zoomAt(1 / STEP, c[0], c[1]); }

  function reset() {
    if (!base) return;
    view = { x: base.x, y: base.y, w: base.w, h: base.h };
    commit();
  }

  /** Called by game.js whenever a level (re)starts. */
  function setBase(vb) {
    base = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    reset();
  }

  // --- gestures -----------------------------------------------------------

  function toView(e) {
    return IMP.util.toViewBox(board, e.clientX, e.clientY);
  }

  function onPointerDown(e) {
    if (!base) return;
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (points.size === 2) {
      const [a, b] = [...points.values()];
      pinchStart = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: scale(),
        mid: IMP.util.toViewBox(board, (a.x + b.x) / 2, (a.y + b.y) / 2),
      };
    }
    try { board.setPointerCapture(e.pointerId); } catch (err) { /* optional */ }
  }

  function onPointerMove(e) {
    if (!base || !points.has(e.pointerId)) return;

    const prev = points.get(e.pointerId);
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (points.size >= 2 && pinchStart) {
      const [a, b] = [...points.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart.dist > 0) {
        const target = clamp(pinchStart.scale * (dist / pinchStart.dist), MIN, MAX);
        zoomAt(target / scale(), pinchStart.mid.x, pinchStart.mid.y);
      }
      return;
    }

    // Single pointer: pan. Convert the pixel delta into viewBox units.
    if (scale() <= 1) return;             // nothing to pan when fully zoomed out
    const k = board.getBoundingClientRect().width / view.w;
    view.x -= (e.clientX - prev.x) / k;
    view.y -= (e.clientY - prev.y) / k;
    commit();
  }

  function onPointerUp(e) {
    points.delete(e.pointerId);
    if (points.size < 2) pinchStart = null;
    try { board.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  function onWheel(e) {
    if (!base) return;
    e.preventDefault();
    const p = toView(e);
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
  }

  function attach(boardEl, changeCb) {
    board = boardEl;
    onChange = changeCb || null;

    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('pointermove', onPointerMove);
    board.addEventListener('pointerup', onPointerUp);
    board.addEventListener('pointercancel', onPointerUp);
    board.addEventListener('lostpointercapture', onPointerUp);
    board.addEventListener('wheel', onWheel, { passive: false });
  }

  IMP.zoom = { attach, setBase, zoomIn, zoomOut, reset, scale, MIN, MAX };
})((window.IMP = window.IMP || {}));
