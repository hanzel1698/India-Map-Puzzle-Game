/* Confetti and the little celebratory flourishes.
 *
 * Everything here is decoration and must be skippable: if the device is weak or
 * the player asked for reduced motion, these become no-ops and the game plays
 * exactly the same.
 */
(function (IMP) {
  'use strict';

  const { reducedMotion } = IMP.util;

  const COLORS = ['#f08a7a', '#6fb7e0', '#8fcf7a', '#f5c451', '#b99ae0', '#5fc9b8'];

  let canvas = null;
  let ctx = null;
  let pieces = [];
  let raf = 0;

  function size() {
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function init() {
    canvas = document.getElementById('confetti');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    size();
    window.addEventListener('resize', IMP.util.debounce(size, 150));
  }

  function confetti(count) {
    if (!ctx || reducedMotion()) return;
    const n = count || 120;
    const w = window.innerWidth;

    for (let i = 0; i < n; i++) {
      pieces.push({
        x: Math.random() * w,
        y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 2.2,
        vy: 2 + Math.random() * 3.2,
        size: 6 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.22,
        color: COLORS[(Math.random() * COLORS.length) | 0],
      });
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick() {
    const h = window.innerHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    pieces = pieces.filter(function (p) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.045;
      p.rot += p.vr;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();

      return p.y < h + 40;
    });

    if (pieces.length) {
      raf = requestAnimationFrame(tick);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      raf = 0;
    }
  }

  function clear() {
    pieces = [];
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  /** Re-trigger a CSS animation on an element that may already carry the class. */
  function replay(node, className, ms) {
    if (!node) return;
    node.classList.remove(className);
    // Force a reflow so removing and re-adding actually restarts the animation.
    void node.offsetWidth;
    node.classList.add(className);
    setTimeout(function () { node.classList.remove(className); }, ms);
  }

  IMP.effects = { init, confetti, clear, replay };
})((window.IMP = window.IMP || {}));
