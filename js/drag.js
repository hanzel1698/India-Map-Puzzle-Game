/* Dragging, with Pointer Events.
 *
 * Pointer Events rather than mouse+touch pairs: one code path covers mouse,
 * finger and stylus, and pointer capture means the drag keeps working even when
 * the pointer leaves the element it started on -- which, with a four-year-old
 * aiming at Rajasthan, it always does.
 *
 * The dragged piece is an HTML div over the page, not an SVG node. SVG has no
 * z-index, so raising a piece above the board would mean re-appending nodes
 * mid-drag; a fixed-position div is always on top, is GPU-composited (which is
 * what keeps this at 60fps on a tablet), and takes a cheap CSS drop-shadow.
 */
(function (IMP) {
  'use strict';

  const CFG = IMP.config;
  const { toViewBox, boardScale } = IMP.util;

  let board = null;
  let ghost = null;
  let handlers = {};

  // Only one pointer at a time. A small child will absolutely put a second hand
  // on the screen mid-drag, and without this lock the piece teleports.
  let activeId = null;
  let current = null;

  function attach(boardEl, opts) {
    board = boardEl;
    handlers = opts || {};
    document.addEventListener('pointerdown', firstGesture, { once: true, capture: true });
  }

  /* Both WebAudio and iOS speech refuse to start outside a user gesture, so the
     very first pointerdown anywhere is where they get unlocked. */
  function firstGesture() {
    IMP.audio.unlock();
    IMP.speech.unlock();
  }

  function bindTile(tile, state) {
    tile.addEventListener('pointerdown', function (e) {
      if (activeId !== null) return;         // single-pointer lock
      if (e.button != null && e.button > 0) return;
      start(e, tile, state);
    });

    // Long-press on Android/iOS pops a context menu over the piece; the native
    // HTML5 drag on desktop hijacks the gesture entirely. Both must go.
    tile.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    tile.addEventListener('dragstart', function (e) { e.preventDefault(); });
  }

  function start(e, tile, state) {
    e.preventDefault();
    activeId = e.pointerId;

    try {
      tile.setPointerCapture(e.pointerId);
    } catch (err) {
      /* capture is an optimisation, not a requirement */
    }

    const scale = boardScale(board, IMP.render.VW, IMP.render.VH) * state.minScale;
    const pad = CFG.PIECE_PAD;
    const [x0, y0, x1, y1] = state.bbox;
    const w = (x1 - x0 + pad * 2) * scale;
    const h = (y1 - y0 + pad * 2) * scale;

    ghost = document.createElement('div');
    ghost.className = 'ghost';
    ghost.style.width = w + 'px';
    ghost.style.height = h + 'px';
    ghost.innerHTML = IMP.render.pieceSVG(state);
    document.body.appendChild(ghost);

    // Hide with visibility rather than display, so the tray does not reflow and
    // shuffle the remaining tiles out from under the child's other hand.
    tile.classList.add('taken');

    current = {
      state,
      tile,
      w,
      h,
      // Grab the piece by its middle: a child does not aim at the exact spot
      // they touched, they aim the whole shape.
      offsetX: w / 2,
      offsetY: h / 2,
    };

    move(e);

    IMP.audio.playPickup();
    IMP.speech.sayState(state, 'PICKUP');

    tile.addEventListener('pointermove', onMove);
    tile.addEventListener('pointerup', onUp);
    tile.addEventListener('pointercancel', onCancel);
    tile.addEventListener('lostpointercapture', onCancel);
  }

  function move(e) {
    if (!ghost || !current) return;
    ghost.style.transform =
      'translate3d(' +
      (e.clientX - current.offsetX) + 'px,' +
      (e.clientY - current.offsetY) + 'px,0)';
  }

  function onMove(e) {
    if (e.pointerId !== activeId) return;
    e.preventDefault();
    // Coalesced events matter for a stylus; we only ever need the newest point.
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    move(events && events.length ? events[events.length - 1] : e);
  }

  function onUp(e) {
    if (e.pointerId !== activeId) return;
    e.preventDefault();
    finish(e.clientX, e.clientY);
  }

  /* pointercancel fires when the browser decides the gesture was really a scroll
     and takes it away from us. Dropping it on the floor leaves a ghost stuck on
     screen forever, so it has to return the piece just like a miss does. */
  function onCancel(e) {
    if (e.pointerId !== activeId) return;
    finish(null, null);
  }

  function snapRadius(state, level) {
    const frac = CFG.SNAP_FRAC[level] || CFG.SNAP_FRAC[3];
    const diag = Math.hypot(state.bbox[2] - state.bbox[0], state.bbox[3] - state.bbox[1]);
    return Math.max(IMP.render.VW * frac, diag * CFG.SNAP_BBOX_FACTOR, CFG.SNAP_MIN);
  }

  function finish(clientX, clientY) {
    if (!current) return cleanup();

    const state = current.state;
    const tile = current.tile;

    let correct = false;

    if (clientX != null) {
      const p = toViewBox(board, clientX, clientY);
      const level = handlers.getLevel ? handlers.getLevel() : 3;
      const dist = Math.hypot(p.x - state.c[0], p.y - state.c[1]);

      correct = dist <= snapRadius(state, level);

      // After enough tries, anywhere on the board is close enough. Nobody loses
      // this game -- if a child is stuck, the game gives in, not the child.
      if (!correct && handlers.misses && handlers.misses(state.id) >= CFG.FORGIVE_AFTER) {
        const inBoard = p.x >= 0 && p.y >= 0 && p.x <= IMP.render.VW && p.y <= IMP.render.VH;
        if (inBoard) correct = true;
      }
    }

    if (correct) {
      removeGhost();
      tile.remove();
      cleanup();
      if (handlers.onPlace) handlers.onPlace(state);
    } else {
      IMP.audio.playWrong();
      returnToTray(tile);
      if (handlers.onMiss) handlers.onMiss(state);
    }
  }

  /** Wobble, then fly back to the tray tile it came from. */
  function returnToTray(tile) {
    const g = ghost;
    const c = current;
    // Hand the node over to this animation before clearing drag state, so a
    // child who immediately grabs another piece gets a fresh ghost rather than
    // fighting this one for it.
    ghost = null;
    cleanup();
    if (!g || !c) return;

    g.classList.add('wobble');

    setTimeout(function () {
      const rect = tile.getBoundingClientRect();
      if (rect.width) {
        g.style.transition = 'transform 220ms ease-out, opacity 220ms ease-out';
        g.style.transform =
          'translate3d(' +
          (rect.left + rect.width / 2 - c.w / 2) + 'px,' +
          (rect.top + rect.height / 2 - c.h / 2) + 'px,0)';
      }
      g.style.opacity = '0';
      setTimeout(function () {
        g.remove();
        tile.classList.remove('taken');
      }, 230);
    }, IMP.util.reducedMotion() ? 0 : 320);
  }

  function removeGhost() {
    if (ghost) ghost.remove();
    ghost = null;
  }

  function cleanup() {
    if (current) {
      const t = current.tile;
      t.removeEventListener('pointermove', onMove);
      t.removeEventListener('pointerup', onUp);
      t.removeEventListener('pointercancel', onCancel);
      t.removeEventListener('lostpointercapture', onCancel);
      try {
        if (activeId !== null && t.hasPointerCapture && t.hasPointerCapture(activeId)) {
          t.releasePointerCapture(activeId);
        }
      } catch (e) {
        /* ignore */
      }
    }
    // The ghost is deliberately untouched here -- whoever called cleanup owns it,
    // because a miss still needs it around to animate back to the tray.
    current = null;
    activeId = null;
  }

  IMP.drag = { attach, bindTile, snapRadius };
})((window.IMP = window.IMP || {}));
