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

  /* Prefer an Indian English voice, then Hindi, then any English, then whatever
     exists. A US voice saying "Chhattisgarh" is rough, but silence is worse. */
  function pickVoice() {
    if (!supported) return;
    let voices = [];
    try {
      voices = synth.getVoices() || [];
    } catch (e) {
      return;
    }
    if (!voices.length) return;

    voice =
      voices.find(function (v) { return v.lang === 'en-IN'; }) ||
      voices.find(function (v) { return v.lang === 'hi-IN'; }) ||
      voices.find(function (v) { return /^en[-_]/.test(v.lang); }) ||
      voices[0] ||
      null;
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
      u.rate = 0.85;   // slow enough for a four-year-old to catch the syllables
      u.pitch = 1.1;
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

  IMP.speech = { say, unlock, setMuted, supported };
})((window.IMP = window.IMP || {}));
