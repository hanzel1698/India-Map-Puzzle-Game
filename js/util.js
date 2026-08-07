/* Small shared helpers. No dependencies, no cleverness. */
(function (IMP) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const node = document.createElement(tag);
    for (const k in attrs) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function svg(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) {
      if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  /** Fisher-Yates, in place. */
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

  /**
   * Client pixels -> board viewBox units.
   *
   * All hit-testing happens in viewBox units, never pixels, so snapping behaves
   * identically on a phone and on a 4K monitor.
   */
  function toViewBox(board, clientX, clientY) {
    const ctm = board.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = board.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    const r = p.matrixTransform(ctm.inverse());
    return { x: r.x, y: r.y };
  }

  /**
   * Scale factor from viewBox units to CSS pixels, for the board as it is right
   * now.
   *
   * Reads the LIVE viewBox rather than taking the original dimensions as
   * arguments, because zooming works by rewriting the viewBox. Using the
   * original constants would size the drag ghost against an unzoomed board, so a
   * piece picked up while zoomed in would be visibly the wrong size for the slot
   * it is aimed at.
   */
  function boardScale(board) {
    const r = board.getBoundingClientRect();
    const vb = board.viewBox && board.viewBox.baseVal;
    const w = vb && vb.width ? vb.width : r.width;
    const h = vb && vb.height ? vb.height : r.height;
    // preserveAspectRatio="xMidYMid meet" letterboxes, so the effective scale is
    // whichever axis is the tighter fit.
    return Math.min(r.width / w, r.height / h);
  }

  function debounce(fn, ms) {
    let t = 0;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  }

  const reducedMotion = () =>
    !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  IMP.util = {
    el, svg, shuffle, clamp, toViewBox, boardScale, debounce, reducedMotion, SVG_NS,
  };
})((window.IMP = window.IMP || {}));
