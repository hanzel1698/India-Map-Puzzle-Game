/* The sticker book, as an in-page overlay.
 *
 * A sticker for every state ever placed, plus a trophy per level. Empty slots
 * are drawn greyed out rather than hidden, because for a small child the point
 * of a collection is seeing the gaps you could still fill.
 *
 * Rendered on open rather than at load: the contents change every time a piece
 * is placed, so building it once at startup would go stale immediately.
 */
(function (IMP) {
  'use strict';

  const TROPHIES = [
    { id: 'trophy-1', emoji: '🥉', name: 'Six Big Ones', cap: 'Level 1 done' },
    { id: 'trophy-2', emoji: '🥈', name: 'Twelve States', cap: 'Level 2 done' },
    { id: 'trophy-3', emoji: '🏆', name: 'All of India', cap: 'Level 3 done' },
  ];

  function card(item, earned) {
    const d = document.createElement('div');
    d.className = 'sticker ' + (earned ? 'earned' : 'locked');
    d.dataset.id = item.id;

    const e = document.createElement('span');
    e.className = 'sticker-emoji';
    e.textContent = earned ? item.emoji : '❔';

    const n = document.createElement('span');
    n.className = 'sticker-name';
    n.textContent = earned ? item.name : '???';

    const c = document.createElement('span');
    c.className = 'sticker-cap';
    c.textContent = earned ? item.cap : 'Not yet';

    d.appendChild(e);
    d.appendChild(n);
    d.appendChild(c);
    return d;
  }

  function render() {
    const M = window.INDIA_MAP;
    const owned = IMP.store.getStickers();
    const has = function (id) { return owned.indexOf(id) !== -1; };

    const trophyGrid = document.getElementById('trophies');
    trophyGrid.innerHTML = '';
    TROPHIES.forEach(function (t) {
      trophyGrid.appendChild(card(t, has(t.id)));
    });

    const stateGrid = document.getElementById('states');
    stateGrid.innerHTML = '';
    let earned = 0;

    M.states
      .slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .forEach(function (s) {
        const got = has(s.id);
        if (got) earned++;
        stateGrid.appendChild(
          card({ id: s.id, emoji: s.emoji, name: s.name, cap: s.sticker }, got)
        );
      });

    document.getElementById('state-sub').textContent =
      earned + ' of ' + M.states.length + ' collected.' +
      (IMP.store.persistent ? '' : ' (This device cannot save stickers.)');

    document.getElementById('trophy-sub').textContent =
      TROPHIES.filter(function (t) { return has(t.id); }).length + ' of 3 trophies won.';
  }

  function open() {
    render();
    document.getElementById('book').hidden = false;
    const btn = document.getElementById('open-stickers');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    const close = document.getElementById('close-book');
    if (close) close.focus();
  }

  function close() {
    document.getElementById('book').hidden = true;
    const btn = document.getElementById('open-stickers');
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.focus();
    }
  }

  function boot() {
    const openBtn = document.getElementById('open-stickers');
    const winBtn = document.getElementById('win-stickers');
    const closeBtn = document.getElementById('close-book');
    if (!openBtn) return;   // not the game page

    openBtn.addEventListener('click', open);
    if (winBtn) winBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !document.getElementById('book').hidden) close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  IMP.stickers = { open, close, render };
})((window.IMP = window.IMP || {}));
