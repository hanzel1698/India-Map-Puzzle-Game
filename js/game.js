/* Level state machine and everything that wires the other modules together.
 *
 * Design rule that shapes all of this: there is no timer, no score, and no way
 * to lose. A wrong drop costs nothing and quietly makes the next attempt easier.
 */
(function (IMP) {
  'use strict';

  const CFG = IMP.config;
  const M = window.INDIA_MAP;

  const dom = {};

  let level = 1;
  let active = [];       // states in this level
  let placedPaths = {};
  let placedCount = 0;
  const misses = {};     // state id -> wrong drops, drives the escalating hints
  const undoStack = [];
  const redoStack = [];

  // --- tray ---------------------------------------------------------------

  const byName = function (a, b) { return a.name.localeCompare(b.name); };

  function makeTile(state) {
    const tile = IMP.render.buildTile(state);
    IMP.drag.bindTile(tile, state);
    return tile;
  }

  /** Fill the tray with every unplaced piece, in alphabetical order. */
  function fillTray(states) {
    dom.tray.innerHTML = '';
    states.slice().sort(byName).forEach(function (s) {
      dom.tray.appendChild(makeTile(s));
    });
    updateRovingTabindex();
    updateArrows();
  }

  /**
   * Put a tile back where it belongs alphabetically. Undo would otherwise append
   * it to the end, which is the one thing an ordered list must not do.
   */
  function insertTileSorted(state) {
    const tile = makeTile(state);
    const existing = Array.prototype.slice.call(dom.tray.querySelectorAll('.tile'));
    const after = existing.find(function (t) {
      const s = IMP.render.byId[t.dataset.id];
      return s && byName(s, state) > 0;
    });
    dom.tray.insertBefore(tile, after || null);
    updateRovingTabindex();
    updateArrows();
    return tile;
  }

  // --- tray scrolling -----------------------------------------------------

  const isRail = function () {
    return getComputedStyle(dom.tray).flexDirection === 'column';
  };

  function scrollTray(dir) {
    const rail = isRail();
    const amount = (rail ? dom.tray.clientHeight : dom.tray.clientWidth) * 0.8;
    dom.tray.scrollBy(
      rail ? { top: dir * amount, behavior: 'smooth' }
           : { left: dir * amount, behavior: 'smooth' }
    );
  }

  function updateArrows() {
    if (!dom.prev) return;
    const rail = isRail();
    const pos = rail ? dom.tray.scrollTop : dom.tray.scrollLeft;
    const max = rail
      ? dom.tray.scrollHeight - dom.tray.clientHeight
      : dom.tray.scrollWidth - dom.tray.clientWidth;
    dom.prev.disabled = pos <= 1;
    dom.next.disabled = pos >= max - 1;
    // Nothing to scroll at all: hide rather than show two dead buttons.
    const scrollable = max > 1;
    dom.prev.hidden = !scrollable;
    dom.next.hidden = !scrollable;
  }

  // --- placement ----------------------------------------------------------

  function applyPlacement(state, opts) {
    const o = opts || {};
    const path = placedPaths[state.id];
    if (path) {
      path.setAttribute('opacity', '1');
      if (path._group) path._group.setAttribute('opacity', '1');
      IMP.effects.replay(path._group || path, 'pop', 320);
    }

    const slot = dom.board.querySelector('.slot[data-id="' + state.id + '"]');
    if (slot) {
      slot.classList.remove('nudge');
      slot.style.opacity = '0';
    }

    placedCount++;
    IMP.audio.playCorrect();
    IMP.speech.sayState(state, 'PLACED');
    announce(state.name + ' placed. ' + placedCount + ' of ' + active.length + ' done.');

    // Stickers record states ever placed. Deliberately never revoked by undo --
    // the book is a permanent collection, and taking one back for pressing undo
    // would be a punishment in a game built to have none. earnSticker is
    // idempotent, so redo is a no-op here.
    IMP.store.earnSticker(state.id);

    updateProgress();
    updateArrows();

    if (placedCount === active.length && !o.silent) setTimeout(win, 420);
  }

  function revertPlacement(state) {
    const path = placedPaths[state.id];
    if (path) {
      path.setAttribute('opacity', '0');
      if (path._group) path._group.setAttribute('opacity', '0');
    }

    const slot = dom.board.querySelector('.slot[data-id="' + state.id + '"]');
    if (slot) slot.style.opacity = '';

    placedCount--;
    insertTileSorted(state);
    updateProgress();

    // Undoing after finishing should take the celebration away with it.
    dom.win.hidden = true;
    IMP.effects.clear();

    announce(state.name + ' put back. ' + placedCount + ' of ' + active.length + ' done.');
  }

  function onPlace(state) {
    undoStack.push(state);
    redoStack.length = 0;
    applyPlacement(state);
    updateHistoryButtons();
  }

  function undo() {
    const state = undoStack.pop();
    if (!state) return;
    redoStack.push(state);
    revertPlacement(state);
    updateHistoryButtons();
  }

  function redo() {
    const state = redoStack.pop();
    if (!state) return;
    undoStack.push(state);
    const tile = dom.tray.querySelector('.tile[data-id="' + state.id + '"]');
    if (tile) tile.remove();
    // silent: replaying a placement should not re-run the whole win fanfare.
    applyPlacement(state, { silent: true });
    if (placedCount === active.length) setTimeout(win, 420);
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    dom.undo.disabled = undoStack.length === 0;
    dom.redo.disabled = redoStack.length === 0;
  }

  function onMiss(state) {
    misses[state.id] = (misses[state.id] || 0) + 1;
    if (misses[state.id] >= CFG.HINT_AFTER) {
      const slot = dom.board.querySelector('.slot[data-id="' + state.id + '"]');
      if (slot) slot.classList.add('nudge');
    }
  }

  // --- level lifecycle ----------------------------------------------------

  function startLevel(next) {
    level = next;
    IMP.store.setSetting('level', level);

    active = M.states.filter(function (s) { return s.level <= level; });
    placedCount = 0;
    for (const k in misses) delete misses[k];
    undoStack.length = 0;
    redoStack.length = 0;

    placedPaths = IMP.render.buildBoard(dom.board, active);
    dom.win.hidden = true;
    IMP.effects.clear();
    IMP.zoom.setBase(M.viewBox);

    fillTray(active);
    updateProgress();
    updateHistoryButtons();

    Array.prototype.forEach.call(dom.chips, function (chip) {
      chip.setAttribute('aria-selected', String(+chip.dataset.level === level));
    });

    announce('Level ' + level + '. ' + active.length + ' pieces to place.');
  }

  function win() {
    const trophy = 'trophy-' + level;
    IMP.store.earnSticker(trophy);

    dom.win.hidden = false;
    dom.winEmoji.textContent = level === 3 ? '🏆' : '🎉';
    dom.winTitle.textContent = level === 3 ? 'All of India!' : 'You did it!';
    dom.winSub.textContent =
      'You placed ' + active.length + ' pieces. You earned a sticker!';
    dom.next.hidden = level >= 3;

    IMP.audio.playFanfare();
    IMP.speech.sayFrom(level === 3 ? 'WIN_ALL' : 'WIN');
    IMP.effects.confetti(level === 3 ? 200 : 130);
    announce('Level complete. You earned a sticker.');
  }

  function updateProgress() {
    dom.progress.textContent = placedCount + ' / ' + active.length;
  }

  function announce(text) {
    dom.live.textContent = text;
  }

  // --- keyboard -----------------------------------------------------------

  /* Roving tabindex: the tray is one tab stop and arrows move within it, which is
     the expected pattern for a listbox and stops 36 tiles flooding the tab order. */
  function updateRovingTabindex() {
    const tiles = dom.tray.querySelectorAll('.tile');
    tiles.forEach(function (t, i) {
      t.tabIndex = i === 0 ? 0 : -1;
    });
  }

  function onTrayKey(e) {
    const tiles = Array.prototype.slice.call(dom.tray.querySelectorAll('.tile'));
    if (!tiles.length) return;
    const i = tiles.indexOf(document.activeElement);

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusTile(tiles, i < 0 ? 0 : (i + 1) % tiles.length);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusTile(tiles, i <= 0 ? tiles.length - 1 : i - 1);
    } else if ((e.key === 'Enter' || e.key === ' ') && i > -1) {
      /* Places the piece directly. With no score and no losing this is not
         cheating -- it is the assist path, it is how a grown-up helps, and it is
         the only way to play at all without a pointing device. */
      e.preventDefault();
      const state = IMP.render.byId[tiles[i].dataset.id];
      IMP.audio.unlock();
      IMP.speech.unlock();
      tiles[i].remove();
      onPlace(state);
    }
  }

  function focusTile(tiles, idx) {
    tiles.forEach(function (t, n) { t.tabIndex = n === idx ? 0 : -1; });
    tiles[idx].focus();
  }

  // --- sound toggle -------------------------------------------------------

  function setMuted(muted) {
    IMP.audio.setMuted(muted);
    IMP.speech.setMuted(muted);
    IMP.store.setSetting('muted', muted);
    dom.mute.setAttribute('aria-pressed', String(muted));
    dom.mute.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
  }

  // --- boot ---------------------------------------------------------------

  function boot() {
    dom.board = document.getElementById('board');
    dom.tray = document.getElementById('tray');
    dom.progress = document.getElementById('progress');
    dom.live = document.getElementById('live');
    dom.mute = document.getElementById('mute');
    dom.win = document.getElementById('win');
    dom.winEmoji = document.getElementById('win-emoji');
    dom.winTitle = document.getElementById('win-title');
    dom.winSub = document.getElementById('win-sub');
    dom.next = document.getElementById('next');
    dom.again = document.getElementById('again');
    dom.chips = document.querySelectorAll('.chip');
    dom.undo = document.getElementById('undo');
    dom.redo = document.getElementById('redo');
    dom.prev = document.getElementById('tray-prev');
    dom.next = document.getElementById('tray-next');
    dom.zoomIn = document.getElementById('zoom-in');
    dom.zoomOut = document.getElementById('zoom-out');
    dom.zoomReset = document.getElementById('zoom-reset');

    // Weak devices get the flat style: 36 drop-shadowed paths is where a cheap
    // tablet starts dropping frames.
    if (IMP.util.reducedMotion() || (navigator.hardwareConcurrency || 8) <= 4) {
      document.body.classList.add('low-fx');
    }

    IMP.effects.init();
    IMP.drag.attach(dom.board, {
      onPlace,
      onMiss,
      getLevel: function () { return level; },
      misses: function (id) { return misses[id] || 0; },
    });

    const settings = IMP.store.getSettings();
    setMuted(!!settings.muted);

    dom.mute.addEventListener('click', function () {
      setMuted(dom.mute.getAttribute('aria-pressed') !== 'true');
    });

    Array.prototype.forEach.call(dom.chips, function (chip) {
      chip.addEventListener('click', function () {
        startLevel(+chip.dataset.level);
      });
    });

    dom.again.addEventListener('click', function () { startLevel(level); });
    document.getElementById('admire').addEventListener('click', function () {
      dom.win.hidden = true;
      IMP.effects.clear();
    });
    dom.next.addEventListener('click', function () {
      startLevel(Math.min(3, level + 1));
    });

    dom.tray.addEventListener('keydown', onTrayKey);
    dom.tray.addEventListener('scroll', IMP.util.debounce(updateArrows, 80));

    dom.undo.addEventListener('click', undo);
    dom.redo.addEventListener('click', redo);
    dom.prev.addEventListener('click', function () { scrollTray(-1); });
    dom.next.addEventListener('click', function () { scrollTray(1); });

    // Costs nothing and helps the adult sitting alongside.
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    });

    IMP.zoom.attach(dom.board, function (scale) {
      dom.zoomIn.disabled = scale >= IMP.zoom.MAX - 0.01;
      dom.zoomOut.disabled = scale <= IMP.zoom.MIN + 0.01;
      dom.zoomReset.disabled = scale <= IMP.zoom.MIN + 0.01;
    });
    dom.zoomIn.addEventListener('click', IMP.zoom.zoomIn);
    dom.zoomOut.addEventListener('click', IMP.zoom.zoomOut);
    dom.zoomReset.addEventListener('click', IMP.zoom.reset);

    window.addEventListener('resize', IMP.util.debounce(updateArrows, 120));

    startLevel(settings.level && settings.level <= 3 ? settings.level : 1);

    // Test hook. Deliberately minimal: just enough for Playwright to drive a
    // level to completion without simulating 36 drags.
    window.__IMP_TEST__ = {
      place: function (id) {
        const tile = dom.tray.querySelector('.tile[data-id="' + id + '"]');
        if (tile) tile.remove();
        onPlace(IMP.render.byId[id]);
      },
      state: function () {
        return {
          level,
          placed: placedCount,
          total: active.length,
          undo: undoStack.length,
          redo: redoStack.length,
        };
      },
      undo,
      redo,
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})((window.IMP = window.IMP || {}));
