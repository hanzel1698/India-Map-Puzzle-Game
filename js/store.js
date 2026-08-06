/* Persistence.
 *
 * localStorage throws outright in Safari private mode, and is unreliable on
 * file:// in several browsers. None of that should ever break the game, so every
 * access falls back to an in-memory object -- the child still plays, the stickers
 * just do not survive a reload.
 */
(function (IMP) {
  'use strict';

  const KEY_STICKERS = 'imp.v1.stickers';
  const KEY_SETTINGS = 'imp.v1.settings';

  const memory = {};
  let backend = null;

  try {
    const probe = '__imp_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    backend = window.localStorage;
  } catch (e) {
    backend = null;
  }

  function readRaw(key) {
    try {
      return backend ? backend.getItem(key) : memory[key] || null;
    } catch (e) {
      return memory[key] || null;
    }
  }

  function writeRaw(key, value) {
    memory[key] = value;
    try {
      if (backend) backend.setItem(key, value);
    } catch (e) {
      /* quota or private mode -- memory copy is enough */
    }
  }

  function readJSON(key, fallback) {
    const raw = readRaw(key);
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  // --- stickers -----------------------------------------------------------

  const getStickers = () => readJSON(KEY_STICKERS, []);

  /** @returns {boolean} true if this sticker is newly earned */
  function earnSticker(id) {
    const have = getStickers();
    if (have.indexOf(id) !== -1) return false;
    have.push(id);
    writeRaw(KEY_STICKERS, JSON.stringify(have));
    return true;
  }

  const hasSticker = (id) => getStickers().indexOf(id) !== -1;

  // --- settings -----------------------------------------------------------

  const getSettings = () => readJSON(KEY_SETTINGS, { muted: false, level: 1 });

  function setSetting(key, value) {
    const s = getSettings();
    s[key] = value;
    writeRaw(KEY_SETTINGS, JSON.stringify(s));
    return s;
  }

  IMP.store = {
    getStickers,
    earnSticker,
    hasSticker,
    getSettings,
    setSetting,
    persistent: backend !== null,
  };
})((window.IMP = window.IMP || {}));
