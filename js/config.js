/* Tunables in one place. Everything a grown-up might want to adjust after
 * watching an actual four-year-old play is here rather than buried in logic. */
(function (IMP) {
  'use strict';

  IMP.config = {
    // Level 1 shows the 6 biggest, most distinctive states; each level adds more.
    LEVELS: [
      { level: 1, name: 'Six Big Ones', hint: '6 pieces' },
      { level: 2, name: 'Twelve States', hint: '12 pieces' },
      { level: 3, name: 'All of India', hint: '36 pieces' },
    ],

    // How many pieces sit in the tray at once, refilled from a shuffled queue.
    // Preschool visual search falls apart past roughly half a dozen choices, and
    // capping it also keeps each tile physically large enough to grab.
    TRAY_MAX: 6,

    // Snap distance as a fraction of the viewBox width, per level. Deliberately
    // enormous -- a four-year-old aiming at a state is doing well to land in the
    // right quarter of the country.
    SNAP_FRAC: { 1: 0.18, 2: 0.13, 3: 0.09 },
    SNAP_MIN: 40,           // absolute floor, viewBox units
    SNAP_BBOX_FACTOR: 0.6,  // big states get a proportionally bigger target

    // Nobody loses, so the game gets more helpful instead. After HINT_AFTER
    // misses on one piece its slot starts pulsing; after FORGIVE_AFTER, dropping
    // it anywhere on the board sends it home.
    HINT_AFTER: 3,
    FORGIVE_AFTER: 5,

    PIECE_PAD: 10,   // viewBox units of margin around a piece in the tray/ghost
    STROKE: 7,       // white jigsaw border width, viewBox units

    // Emoji come from the system font. If a device has no colour-emoji font they
    // render as tofu boxes -- flip this off and pieces fall back to name only.
    USE_EMOJI: true,

    // Cheerful, high-contrast against white borders. Deliberately not meaningful:
    // the emoji carries the matching cue, so colour-vision differences never
    // affect play.
    PALETTE: [
      '#f08a7a', '#6fb7e0', '#8fcf7a', '#f5c451', '#b99ae0',
      '#5fc9b8', '#f295b4', '#a8c96a', '#ef9f5c', '#7fa8e8',
    ],
  };
})((window.IMP = window.IMP || {}));
