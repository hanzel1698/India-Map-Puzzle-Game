/* Level state machine and everything that wires the other modules together.
 *
 * Design rule that shapes all of this: there is no timer, no score, and no way
 * to lose. A wrong drop costs nothing and quietly makes the next attempt easier.
 */
(function (IMP) {
  'use strict';

  const CFG = IMP.config;
  const { shuffle } = IMP.util;
  const M = window.INDIA_MAP;

  const dom = {};

  let level = 1;
  let active = [];       // states in this level
  let queue = [];        // not yet shown in the tray
  let placedPaths = {};
  let placedCount = 0;
  const misses = {};     // state id -> wrong drops, drives the escalating hints

  // --- tray ---------------------------------------------------------------

  /**
   * Refill the tray up to TRAY_MAX.
   *
   * The "always keep one big piece visible" rule is the important part: a tray
   * showing only Goa, Sikkim and Tripura is a tray with no achievable win on it,
   * and that is where a four-year-old gives up.
   */
  function refillTray() {
    const shown = dom.tray.querySelectorAll('.tile').length;
    let need = CFG.TRAY_MAX - shown;
    if (need <= 0 || !queue.length) return;

    const bigOnScreen = Array.prototype.some.call(
      dom.tray.querySelectorAll('.tile'),
      function (t) {
        const s = IMP.render.byId[t.dataset.id];
        return s && s.minScale === 1;
      }
    );

    while (need > 0 && queue.length) {
      let idx = 0;
      if (!bigOnScreen && dom.tray.querySelectorAll('.tile').length === 0) {
        const big = queue.findIndex(function (s) { return s.minScale === 1; });
        if (big > -1) idx = big;
      }
      const state = queue.splice(idx, 1)[0];
      const tile = IMP.render.buildTile(state);
      IMP.drag.bindTile(tile, state);
      dom.tray.appendChild(tile);
      need--;
    }
    updateRovingTabindex();
  }

  // --- placement ----------------------------------------------------------

  function onPlace(state) {
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

    if (IMP.store.earnSticker(state.id)) {
      /* first time this state has ever been placed -- sticker book grows */
    }

    updateProgress();
    refillTray();

    if (placedCount === active.length) setTimeout(win, 420);
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
    queue = shuffle(active.slice());
    placedCount = 0;
    for (const k in misses) delete misses[k];

    placedPaths = IMP.render.buildBoard(dom.board, active);
    dom.tray.innerHTML = '';
    dom.win.hidden = true;
    IMP.effects.clear();

    refillTray();
    updateProgress();

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
    dom.next.addEventListener('click', function () {
      startLevel(Math.min(3, level + 1));
    });

    dom.tray.addEventListener('keydown', onTrayKey);

    window.addEventListener(
      'resize',
      IMP.util.debounce(function () { /* board rescales itself via viewBox */ }, 120)
    );

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
        return { level, placed: placedCount, total: active.length };
      },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})((window.IMP = window.IMP || {}));
