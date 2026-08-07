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

  /* Panning used to read board.getBoundingClientRect() on every pointermove,
     with a viewBox write from the previous move still pending. A geometry read
     against a pending style write forces the browser to flush layout
     synchronously -- every single move, over the whole map. That was the stutter.
     The rect cannot change mid-gesture, so it is measured once and cached. */
  let rect = null;
  let frame = 0;        // pending rAF handle; 0 = none scheduled
  let lastScale = -1;   // so panning does not re-notify with an unchanged scale

  const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

  function scale() {
    return base && view ? base.w / view.w : 1;
  }

  function measure() {
    if (board) rect = board.getBoundingClientRect();
    return rect;
  }

  /** Clamp the window into the map and write it out. Never call from a move. */
  function flush() {
    frame = 0;
    view.w = clamp(view.w, base.w / MAX, base.w);
    view.h = clamp(view.h, base.h / MAX, base.h);
    view.x = clamp(view.x, base.x, base.x + base.w - view.w);
    view.y = clamp(view.y, base.y, base.y + base.h - view.h);
    board.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);

    const s = scale();
    if (onChange && s !== lastScale) {
      lastScale = s;
      onChange(s);
    }
  }

  /**
   * Coalesce to one write per frame. A 120Hz digitizer against a 60Hz panel
   * would otherwise repaint the whole SVG twice for every frame the user sees.
   */
  function commit() {
    if (!frame) frame = requestAnimationFrame(flush);
  }

  /** Write immediately -- for buttons and level changes, where there is no gesture. */
  function commitNow() {
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    flush();
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

  function zoomIn() { const c = centre(); zoomAt(STEP, c[0], c[1]); commitNow(); }
  function zoomOut() { const c = centre(); zoomAt(1 / STEP, c[0], c[1]); commitNow(); }

  function reset() {
    if (!base) return;
    view = { x: base.x, y: base.y, w: base.w, h: base.h };
    commitNow();
  }

  /** Called by game.js whenever a level (re)starts. */
  function setBase(vb) {
    base = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    lastScale = -1;      // force the buttons to be re-evaluated
    reset();
    measure();
  }

  // --- gestures -----------------------------------------------------------

  function toView(e) {
    return IMP.util.toViewBox(board, e.clientX, e.clientY);
  }

  function onPointerDown(e) {
    if (!base) return;
    // Measure once, here, so no geometry is read while the finger is moving.
    measure();
    document.body.classList.add('panning');
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

    // Only the newest position matters; the rest are redundant work.
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    const p = events && events.length ? events[events.length - 1] : e;

    const prev = points.get(e.pointerId);
    points.set(e.pointerId, { x: p.clientX, y: p.clientY });

    if (points.size >= 2 && pinchStart) {
      const [a, b] = [...points.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart.dist > 0) {
        const target = clamp(pinchStart.scale * (dist / pinchStart.dist), MIN, MAX);
        zoomAt(target / scale(), pinchStart.mid.x, pinchStart.mid.y);
        commit();
      }
      return;
    }

    // Single pointer: pan. Convert the pixel delta into viewBox units using the
    // rect cached at pointerdown -- reading it here is what caused the stutter.
    if (scale() <= 1) return;             // nothing to pan when fully zoomed out
    const width = (rect || measure()).width;
    const k = width / view.w;
    view.x -= (p.clientX - prev.x) / k;
    view.y -= (p.clientY - prev.y) / k;
    commit();
  }

  function onPointerUp(e) {
    points.delete(e.pointerId);
    if (points.size < 2) pinchStart = null;
    if (points.size === 0) {
      document.body.classList.remove('panning');
      commitNow();      // land on the final position, not a dropped frame
    }
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

    // The cached rect is only stale when the layout itself changes.
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    measure();
  }

  IMP.zoom = { attach, setBase, zoomIn, zoomOut, reset, scale, MIN, MAX };
})((window.IMP = window.IMP || {}));
