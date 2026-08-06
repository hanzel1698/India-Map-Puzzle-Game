/* All sound is synthesised in the browser. No audio files anywhere in the repo,
 * which keeps the whole game a handful of text files.
 *
 * Every entry point is wrapped: if WebAudio is missing or blocked, the game must
 * carry on silently rather than break.
 */
(function (IMP) {
  'use strict';

  let ctx = null;
  let master = null;
  let muted = false;

  // Kept low on purpose. Tablet speakers are close to a small child's ears.
  const VOLUME = 0.25;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : VOLUME;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  /**
   * Browsers refuse to start an AudioContext outside a user gesture, so this is
   * called from the first pointerdown. iOS additionally suspends the context
   * whenever the tab goes to the background without ever telling us, which is
   * why resume() is also called before every single sound below.
   */
  function unlock() {
    const c = ensure();
    if (c && c.state === 'suspended') c.resume().catch(function () {});
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
  }

  function tone(freq, start, dur, type, peak) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak || 0.6, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  /** Short filtered noise burst -- the physical "snap" of a piece seating. */
  function snap(start) {
    const len = Math.floor(ctx.sampleRate * 0.025);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    src.connect(bp);
    bp.connect(gain);
    gain.connect(master);
    src.start(start);
  }

  function guard(fn) {
    return function () {
      if (muted) return;
      const c = ensure();
      if (!c) return;
      resume();
      try {
        fn(c.currentTime);
      } catch (e) {
        /* never let a sound break the game */
      }
    };
  }

  const playPickup = guard(function (t) {
    tone(900, t, 0.06, 'sine', 0.4);
  });

  // Rising major triad: unambiguously "yes" to a child, and short enough that
  // placing pieces quickly does not turn into a drone.
  const playCorrect = guard(function (t) {
    snap(t);
    [1046.5, 1318.5, 1568.0].forEach(function (f, i) {
      tone(f, t + i * 0.06, 0.18, 'triangle', 0.5);
    });
  });

  /* Deliberately soft, low and slow -- a nudge, not a buzzer. A harsh error
     sound is exactly what makes a small child stop wanting to play. */
  const playWrong = guard(function (t) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = 180;
    lp.type = 'lowpass';
    lp.frequency.value = 800;

    lfo.frequency.value = 6;
    lfoGain.gain.value = 0.12;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(master);

    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.28);
    lfo.stop(t + 0.28);
  });

  const playFanfare = guard(function (t) {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach(function (f, i) {
      tone(f, t + i * 0.13, 0.4, 'triangle', 0.5);
    });
    // Slightly detuned pad underneath, so the last chord rings rather than beeps.
    [261.63, 329.63, 392.0].forEach(function (f) {
      tone(f, t + 0.5, 0.9, 'sine', 0.22);
      tone(f * 1.004, t + 0.5, 0.9, 'sine', 0.18);
    });
  });

  function setMuted(next) {
    muted = !!next;
    if (master && ctx) {
      try {
        master.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.02);
      } catch (e) {
        master.gain.value = muted ? 0 : VOLUME;
      }
    }
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) resume();
  });

  IMP.audio = {
    unlock,
    playPickup,
    playCorrect,
    playWrong,
    playFanfare,
    setMuted,
    isMuted: function () { return muted; },
    // Test hook: lets Playwright assert no AudioContext exists before a gesture.
    _hasContext: function () { return ctx !== null; },
  };
})((window.IMP = window.IMP || {}));
