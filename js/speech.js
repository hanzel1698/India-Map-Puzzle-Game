/* Spoken state names.
 *
 * The player cannot read, so hearing "Rajasthan" as they pick the piece up is
 * how the name gets attached to the shape at all. But speech synthesis is the
 * flakiest API in the browser, so nothing here is ever load-bearing: the state
 * name is always also drawn as text on the tile, and every path degrades to a
 * silent no-op.
 */
(function (IMP) {
  'use strict';

  const synth = window.speechSynthesis;
  const supported = !!(synth && window.SpeechSynthesisUtterance);

  let voice = null;
  let muted = false;
  let picked = false;

  /**
   * Score every voice and take the best, rather than taking the first match.
   *
   * Language first: an Indian English voice, then Hindi, then any English, then
   * whatever exists. A US voice saying "Chhattisgarh" is rough, but silence is
   * worse.
   *
   * Then, within the same language, prefer a NON-local voice. Android's
   * network-backed voices are markedly more natural than the on-device ones, and
   * choosing them is the biggest quality gain available without shipping audio
   * files. Local voices stay eligible, so the game still speaks offline.
   */
  function scoreVoice(v) {
    const lang = (v.lang || '').replace('_', '-');
    let score;
    if (lang === 'en-IN') score = 400;
    else if (lang === 'hi-IN') score = 300;
    else if (/^en-/.test(lang)) score = 200;
    else score = 100;
    if (v.localService === false) score += 50;
    if (v.default) score += 1;      // tiebreak only
    return score;
  }

  function pickVoice() {
    if (!supported) return;
    let voices = [];
    try {
      voices = synth.getVoices() || [];
    } catch (e) {
      return;
    }
    if (!voices.length) return;

    voice = voices.reduce(function (best, v) {
      return !best || scoreVoice(v) > scoreVoice(best) ? v : best;
    }, null);
    picked = true;
  }

  if (supported) {
    pickVoice();
    // Voices load asynchronously. Some browsers fire voiceschanged, some fire it
    // only once, and some never fire it at all when the voices were already
    // there -- so subscribe AND set a timeout, and take whichever arrives.
    try {
      synth.addEventListener('voiceschanged', pickVoice);
    } catch (e) {
      synth.onvoiceschanged = pickVoice;
    }
    setTimeout(function () { if (!picked) pickVoice(); }, 1000);
  }

  function say(text) {
    if (!supported || muted || !text) return;
    try {
      // Cancel first. A child tapping pieces quickly would otherwise queue a
      // dozen utterances and leave the game talking to itself for a minute.
      synth.cancel();
      const u = new window.SpeechSynthesisUtterance(String(text));
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      const cfg = (IMP.config && IMP.config.SPEECH) || {};
      u.rate = cfg.RATE || 0.9;
      u.pitch = cfg.PITCH || 1.05;
      // Note: Chrome cuts utterances off after ~15s. Everything here is under
      // two seconds, so this is not a problem -- do not add a keepalive timer.
      synth.speak(u);
    } catch (e) {
      /* speech is never load-bearing */
    }
  }

  /** iOS will not speak later unless something was spoken inside a gesture. */
  function unlock() {
    if (!supported) return;
    try {
      const u = new window.SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
    } catch (e) {
      /* ignore */
    }
  }

  function setMuted(next) {
    muted = !!next;
    if (muted && supported) {
      try { synth.cancel(); } catch (e) { /* ignore */ }
    }
  }

  /* Remember the last template used for each kind, so the same wording never
     lands twice in a row. Repetition is half of what makes it sound mechanical. */
  const lastIndex = {};

  function choose(kind, bank) {
    if (!bank || !bank.length) return null;
    if (bank.length === 1) return bank[0];
    let i;
    do {
      i = Math.floor(Math.random() * bank.length);
    } while (i === lastIndex[kind]);
    lastIndex[kind] = i;
    return bank[i];
  }

  /**
   * Speak a state's name inside a short phrase.
   *
   * Always composed from `state.say` -- the phonetic respelling from
   * tools/meta/states.json -- so a state is pronounced identically whether it is
   * being picked up or placed. 29 of the 36 carry a respelling, so using the raw
   * name in one place and the respelling in the other was audible on most of the
   * map.
   *
   * @param {object} state
   * @param {'PICKUP'|'PLACED'} kind
   */
  function sayState(state, kind) {
    if (!state) return;
    const cfg = (IMP.config && IMP.config.SPEECH) || {};
    const template = choose(kind, cfg[kind]) || '{name}.';
    say(template.replace('{name}', state.say || state.name));
  }

  /** Speak one line from a named phrase bank in config. */
  function sayFrom(kind) {
    const cfg = (IMP.config && IMP.config.SPEECH) || {};
    const line = choose(kind, cfg[kind]);
    if (line) say(line);
  }

  IMP.speech = { say, sayState, sayFrom, unlock, setMuted, supported };
})((window.IMP = window.IMP || {}));
