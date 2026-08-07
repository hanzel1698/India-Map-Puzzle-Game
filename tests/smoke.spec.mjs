/* End-to-end tests.
 *
 * Run:  npm test
 *
 * Two things here are worth more than the rest: the pixel gap test, which is the
 * only check that would catch the pieces failing to tile, and the touch-drag
 * test, because a four-year-old will never touch a mouse.
 */
import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE_URL = 'file://' + join(REPO, 'index.html');
const SHOTS = join(REPO, 'tests', 'screenshots');

/** Collect console errors and uncaught exceptions for the life of a page. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  return errors;
}

/** Client-pixel position of a state's slot centre on the board. */
async function slotPoint(page, id) {
  return page.evaluate((stateId) => {
    const s = window.IMP.render.byId[stateId];
    const board = document.getElementById('board');
    const pt = board.createSVGPoint();
    pt.x = s.c[0];
    pt.y = s.c[1];
    const p = pt.matrixTransform(board.getScreenCTM());
    return { x: p.x, y: p.y };
  }, id);
}

async function tilePoint(page, id) {
  const box = await page.locator(`.tile[data-id="${id}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Id of some state currently sitting in the tray. */
const firstTrayId = (page) =>
  page.evaluate(() => document.querySelector('.tile').dataset.id);

// ---------------------------------------------------------------------------

test.describe('loads cleanly', () => {
  // file:// is the "double-click index.html" path and is the reason the app uses
  // classic scripts rather than ES modules -- worth asserting, not assuming.
  test('over file://', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(FILE_URL);
    await expect(page.locator('#board')).toBeVisible();
    await expect(page.locator('.tile')).toHaveCount(6);   // level 1 = 6 states
    expect(errors).toEqual([]);
  });

  test('over http:// (the GitHub Pages path)', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/index.html');
    await expect(page.locator('#board')).toBeVisible();
    const outlineLength = await page.evaluate(
      () => window.INDIA_MAP.outline.length
    );
    expect(outlineLength).toBeGreaterThan(1000);
    expect(errors).toEqual([]);
  });

  test('has all 36 states with unique emoji', async ({ page }) => {
    await page.goto(FILE_URL);
    const { count, emoji, ids } = await page.evaluate(() => ({
      count: window.INDIA_MAP.states.length,
      emoji: new Set(window.INDIA_MAP.states.map((s) => s.emoji)).size,
      ids: new Set(window.INDIA_MAP.states.map((s) => s.id)).size,
    }));
    expect(count).toBe(36);
    expect(emoji).toBe(36);
    expect(ids).toBe(36);
  });
});

// ---------------------------------------------------------------------------

test('the pieces tile the map with no visible gaps', async ({ page }) => {
  await page.goto(FILE_URL);

  /* Paint the silhouette red, then every state on top of it in black, and count
     the red that survives. Anything left is a gap a child would see as a crack
     in the map. This catches slivers that a sampled point grid can slip
     between. */
  const result = await page.evaluate(() => {
    const M = window.INDIA_MAP;
    const [, , vw, vh] = M.viewBox;
    const W = 1200;
    const H = Math.round((vh / vw) * W);

    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    const k = W / vw;
    ctx.scale(k, k);

    ctx.fillStyle = '#ff0000';
    ctx.fill(new Path2D(M.outline));

    ctx.fillStyle = '#000000';
    for (const s of M.states) {
      if (s.inset) continue;            // insets sit outside the silhouette
      ctx.fill(new Path2D(s.d));
    }

    const data = ctx.getImageData(0, 0, W, H).data;
    let red = 0;
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      painted++;
      if (data[i] > 180 && data[i + 1] < 80) red++;
    }
    return { red, painted };
  });

  expect(result.painted).toBeGreaterThan(10000);
  expect(result.red / result.painted).toBeLessThan(0.003);
});

test('renders a contact sheet of every piece for human review', async ({ page }) => {
  // Tall enough that all 36 cells are laid out, so the sheet captures every row.
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.goto(FILE_URL);

  await page.evaluate(() => {
    const M = window.INDIA_MAP;
    document.body.innerHTML =
      '<div id="sheet" style="display:grid;grid-template-columns:repeat(6,1fr);' +
      'gap:8px;padding:12px;background:#f6f1e6"></div>';
    const sheet = document.getElementById('sheet');
    M.states.forEach((s, i) => {
      const cell = document.createElement('div');
      cell.style.cssText =
        'background:#fff;border-radius:10px;padding:6px;text-align:center;font:11px system-ui';
      cell.innerHTML =
        window.IMP.render.pieceSVG(
          Object.assign({}, s, {
            color: window.IMP.config.PALETTE[i % window.IMP.config.PALETTE.length],
          })
        ) + '<div>' + s.name + '</div>';
      cell.querySelector('svg').style.height = '110px';
      sheet.appendChild(cell);
    });
  });

  await page.locator('#sheet').screenshot({ path: join(SHOTS, 'pieces.png') });
});

// ---------------------------------------------------------------------------

test.describe('dragging', () => {
  test('a piece dropped on its own slot snaps home', async ({ page }) => {
    await page.goto(FILE_URL);
    const id = await firstTrayId(page);

    const from = await tilePoint(page, id);
    const to = await slotPoint(page, id);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * i) / 10,
        from.y + ((to.y - from.y) * i) / 10
      );
    }
    await page.mouse.up();

    await expect(page.locator(`path.placed[data-id="${id}"]`)).toHaveAttribute(
      'opacity',
      '1'
    );
    const state = await page.evaluate(() => window.__IMP_TEST__.state());
    expect(state.placed).toBe(1);
  });

  test('a piece dropped far away goes back to the tray, not lost', async ({ page }) => {
    await page.goto(FILE_URL);
    const id = await firstTrayId(page);
    const from = await tilePoint(page, id);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(60, 90);       // top-left corner, nowhere near anything
    await page.mouse.up();

    await page.waitForTimeout(900);      // wobble, then fly back

    const state = await page.evaluate(() => window.__IMP_TEST__.state());
    expect(state.placed).toBe(0);
    await expect(page.locator(`.tile[data-id="${id}"]`)).toHaveCount(1);
    // No ghost may survive a miss -- a stuck ghost is the classic pointer bug.
    await expect(page.locator('.ghost')).toHaveCount(0);
  });

  test('works with touch, not just a mouse', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, isMobile: false });
    const page = await context.newPage();
    await page.goto(FILE_URL);

    const id = await firstTrayId(page);
    const from = await tilePoint(page, id);
    const to = await slotPoint(page, id);

    /* page.touchscreen only exposes tap(), which cannot express a drag, so this
       goes through CDP to emit a real touchStart/Move/End sequence. */
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x, y: from.y }],
    });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * i) / 8,
            y: from.y + ((to.y - from.y) * i) / 8,
          },
        ],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    await expect(page.locator(`path.placed[data-id="${id}"]`)).toHaveAttribute(
      'opacity',
      '1'
    );
    await context.close();
  });
});

// ---------------------------------------------------------------------------

test('finishing a level wins a trophy that survives a reload', async ({ page }) => {
  await page.goto(FILE_URL);

  // Drive it through the keyboard path, which is the same code a grown-up uses
  // to help, rather than simulating six drags.
  for (let i = 0; i < 6; i++) {
    await page.locator('.tile').first().focus();
    await page.keyboard.press('Enter');
  }

  await expect(page.locator('#win')).toBeVisible();
  await expect(page.locator('#win-title')).toHaveText('You did it!');
  await page.screenshot({ path: join(SHOTS, 'win.png') });

  const stickers = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('imp.v1.stickers') || '[]')
  );
  expect(stickers).toContain('trophy-1');
  expect(stickers.length).toBeGreaterThanOrEqual(7);   // 6 states + 1 trophy

  await page.reload();
  const after = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('imp.v1.stickers') || '[]')
  );
  expect(after).toContain('trophy-1');

  // The sticker book is an overlay on the same page, not a second document.
  await page.locator('#open-stickers').click();
  await expect(page.locator('#book')).toBeVisible();
  await expect(page.locator('.sticker.earned').first()).toBeVisible();
  const earned = await page.locator('.sticker.earned').count();
  expect(earned).toBeGreaterThanOrEqual(7);
  await expect(page.locator('#book .sticker')).toHaveCount(39);  // 36 states + 3 trophies
  await page.screenshot({ path: join(SHOTS, 'stickers.png') });

  await page.locator('#close-book').click();
  await expect(page.locator('#book')).toBeHidden();
});

// ---------------------------------------------------------------------------

test('still playable with no speech and no audio', async ({ page }) => {
  const errors = watchErrors(page);

  await page.addInitScript(() => {
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
    delete window.AudioContext;
    delete window.webkitAudioContext;
  });

  await page.goto(FILE_URL);
  await expect(page.locator('.tile')).toHaveCount(6);

  const id = await firstTrayId(page);
  const from = await tilePoint(page, id);
  const to = await slotPoint(page, id);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();

  await expect(page.locator(`path.placed[data-id="${id}"]`)).toHaveAttribute(
    'opacity',
    '1'
  );
  expect(errors).toEqual([]);
});

test('creates no AudioContext before the first gesture', async ({ page }) => {
  await page.addInitScript(() => {
    window.__built = 0;
    const Real = window.AudioContext;
    window.AudioContext = function () {
      window.__built++;
      return new Real();
    };
    window.webkitAudioContext = window.AudioContext;
  });

  await page.goto(FILE_URL);
  await page.waitForTimeout(400);

  // Autoplay policy: constructing one before a gesture leaves it suspended and
  // the game silent for the whole session.
  expect(await page.evaluate(() => window.__built)).toBe(0);

  const id = await firstTrayId(page);
  const from = await tilePoint(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.up();

  expect(await page.evaluate(() => window.__built)).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------

test('lays out on laptop, tablet landscape and tablet portrait', async ({ browser }) => {
  for (const [w, h, name] of [
    [1440, 900, 'laptop'],
    [1024, 768, 'tablet-land'],
    [768, 1024, 'tablet-port'],
  ]) {
    const context = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await context.newPage();
    await page.goto(FILE_URL);
    await expect(page.locator('.tile')).toHaveCount(6);

    // The tray must not push the board off screen, and must not scroll the body.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({ path: join(SHOTS, name + '.png') });

    await page.click('.chip[data-level="3"]');
    await expect(page.locator('.tile')).toHaveCount(36);
    if (name === 'laptop') {
      await page.screenshot({ path: join(SHOTS, 'level3.png') });
    }
    await context.close();
  }
});

// ---------------------------------------------------------------------------

test('the single-file build works with no sibling files at all', async ({ page }) => {
  /* This is the Android case, reproduced honestly. Tapping an .html file in an
     Android file manager can copy just that one file into a cache directory, so
     ./js/ and ./data/ are not blocked -- they are absent. Copying the bundle
     alone into an empty temp directory is exactly that situation. */
  const solo = mkdtempSync(join(tmpdir(), 'imp-solo-'));
  const target = join(solo, 'india-map-puzzle.html');
  copyFileSync(join(REPO, 'dist', 'india-map-puzzle.html'), target);

  const errors = watchErrors(page);
  const failedRequests = [];
  page.on('requestfailed', (r) => failedRequests.push(r.url()));
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push(r.status() + ' ' + r.url());
  });

  await page.goto('file://' + target);

  await expect(page.locator('#board')).toBeVisible();
  await expect(page.locator('.tile')).toHaveCount(6);
  expect(await page.evaluate(() => window.INDIA_MAP.states.length)).toBe(36);
  expect(await page.locator('#g-slots .slot').count()).toBe(6);

  // A real drag must still place a piece.
  const id = await firstTrayId(page);
  const from = await tilePoint(page, id);
  const to = await slotPoint(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y);
  await page.mouse.up();
  await expect(page.locator(`path.placed[data-id="${id}"]`)).toHaveAttribute('opacity', '1');

  // And the sticker book, which is why it had to stop being a second page.
  await page.locator('#open-stickers').click();
  await expect(page.locator('#book')).toBeVisible();
  await expect(page.locator('#book .sticker')).toHaveCount(39);

  expect(failedRequests).toEqual([]);
  expect(errors).toEqual([]);

  await page.screenshot({ path: join(SHOTS, 'single-file.png') });
});


// ---------------------------------------------------------------------------

/** Replace speechSynthesis with a recorder before any page script runs. */
async function stubSpeech(page, voices) {
  await page.addInitScript((voiceList) => {
    window.__utts = [];
    window.SpeechSynthesisUtterance = function (text) {
      this.text = text;
      this.rate = 1;
      this.pitch = 1;
      this.volume = 1;
    };
    const stub = {
      getVoices: () => voiceList,
      speak: (u) =>
        window.__utts.push({
          text: u.text,
          rate: u.rate,
          pitch: u.pitch,
          voice: u.voice && u.voice.name,
        }),
      cancel: () => {},
      addEventListener: () => {},
    };
    Object.defineProperty(window, 'speechSynthesis', {
      value: stub, configurable: true, writable: true,
    });
  }, voices);
}

const IN_LOCAL = { name: 'IN Local', lang: 'en-IN', localService: true, default: true };
const IN_NET = { name: 'IN Network', lang: 'en-IN', localService: false, default: false };
const US_NET = { name: 'US Network', lang: 'en-US', localService: false, default: false };

/** Everything actually spoken, ignoring the silent iOS unlock utterance. */
const spoken = (page) =>
  page.evaluate(() => window.__utts.filter((u) => u.text && u.text.trim()));

test.describe('speech', () => {
  test('a state sounds the same picked up as placed', async ({ page }) => {
    await stubSpeech(page, [IN_LOCAL, IN_NET]);
    await page.goto(FILE_URL);

    // Maharashtra is respelled "Ma-ha-rash-tra"; it is always in level 1.
    const id = 'MH';
    const from = await tilePoint(page, id);
    const to = await slotPoint(page, id);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y);
    await page.mouse.up();
    await expect(page.locator(`path.placed[data-id="${id}"]`)).toHaveAttribute('opacity', '1');

    const utts = await spoken(page);
    expect(utts.length).toBeGreaterThanOrEqual(2);

    // Both the pick-up and the placement must use the respelling, never the raw
    // spelling -- otherwise one shape carries two different sounds.
    for (const u of utts) {
      expect(u.text).toContain('Ma-ha-rash-tra');
      expect(u.text).not.toMatch(/\bMaharashtra\b/);
    }
  });

  test('speaks phrases, not bare words', async ({ page }) => {
    await stubSpeech(page, [IN_NET]);
    await page.goto(FILE_URL);

    for (let i = 0; i < 4; i++) {
      await page.locator('.tile').first().focus();
      await page.keyboard.press('Enter');
    }

    const utts = await spoken(page);
    expect(utts.length).toBeGreaterThanOrEqual(4);

    for (const u of utts) {
      // A punctuated phrase is what makes an engine apply a sentence contour
      // instead of flat citation form.
      expect(u.text.trim()).toMatch(/[.!?]$/);
      expect(u.rate).toBeCloseTo(0.9, 2);
      expect(u.pitch).toBeCloseTo(1.05, 2);
    }

    // Placements are praise plus a name, so more than one word.
    expect(utts.some((u) => u.text.trim().split(/\s+/).length > 1)).toBe(true);
  });

  test('does not use the same wording twice in a row', async ({ page }) => {
    await stubSpeech(page, [IN_NET]);
    await page.goto(FILE_URL);

    for (let i = 0; i < 6; i++) {
      await page.locator('.tile').first().focus();
      await page.keyboard.press('Enter');
    }

    const utts = await spoken(page);
    // Strip the state name so only the template shape remains.
    const shapes = utts
      .map((u) => u.text.replace(/[A-Z][A-Za-z-]*(\s[A-Z][A-Za-z-]*)*/g, '#'))
      .filter(Boolean);

    for (let i = 1; i < shapes.length; i++) {
      expect(shapes[i], `template repeated back-to-back at ${i}`).not.toBe(shapes[i - 1]);
    }
  });

  test('prefers a network voice over an on-device one', async ({ page }) => {
    await stubSpeech(page, [IN_LOCAL, IN_NET, US_NET]);
    await page.goto(FILE_URL);
    await page.locator('.tile').first().focus();
    await page.keyboard.press('Enter');

    const utts = await spoken(page);
    expect(utts[0].voice).toBe('IN Network');
  });

  test('still speaks when only an on-device voice exists', async ({ page }) => {
    await stubSpeech(page, [IN_LOCAL]);
    await page.goto(FILE_URL);
    await page.locator('.tile').first().focus();
    await page.keyboard.press('Enter');

    const utts = await spoken(page);
    expect(utts.length).toBeGreaterThan(0);
    expect(utts[0].voice).toBe('IN Local');
  });
});

// ---------------------------------------------------------------------------

test.describe('the tray', () => {
  test('lists every piece, alphabetically', async ({ page }) => {
    await page.goto(FILE_URL);
    await page.click('.chip[data-level="3"]');
    await expect(page.locator('.tile')).toHaveCount(36);

    const names = await page.evaluate(() =>
      [...document.querySelectorAll('.tile')].map(
        (t) => window.IMP.render.byId[t.dataset.id].name
      )
    );
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names[0]).toBe('Andaman and Nicobar Islands');
    expect(names[names.length - 1]).toBe('West Bengal');
  });

  test('scrolls, and the arrows reach both ends', async ({ browser }) => {
    for (const [width, height, axis] of [
      [1280, 800, 'y'],     // landscape rail scrolls vertically
      [800, 1280, 'x'],     // portrait strip scrolls horizontally
    ]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage();
      await page.goto(FILE_URL);
      await page.click('.chip[data-level="3"]');
      await expect(page.locator('.tile')).toHaveCount(36);

      const overflow = await page.evaluate((ax) => {
        const t = document.getElementById('tray');
        return ax === 'y'
          ? t.scrollHeight - t.clientHeight
          : t.scrollWidth - t.clientWidth;
      }, axis);
      expect(overflow, `tray should overflow on ${axis}`).toBeGreaterThan(100);

      // At the start there is nothing before, so only "next" is live.
      await expect(page.locator('#tray-prev')).toBeDisabled();
      await expect(page.locator('#tray-next')).toBeEnabled();

      // Press "next" until it disables: the far end must be reachable.
      for (let i = 0; i < 40; i++) {
        if (await page.locator('#tray-next').isDisabled()) break;
        await page.locator('#tray-next').click();
        await page.waitForTimeout(120);
      }
      await expect(page.locator('#tray-next')).toBeDisabled();
      await expect(page.locator('#tray-prev')).toBeEnabled();

      await context.close();
    }
  });

  test('the scroll arrows do not cover the HUD buttons', async ({ page }) => {
    /* Regression: the landscape arrow used a rotated full-width ::before, and
       because hit-testing follows transforms its clickable area extended far
       past the button and swallowed presses on the HUD above it. */
    await page.goto(FILE_URL);
    await page.click('.chip[data-level="3"]');

    for (const id of ['undo', 'redo', 'mute', 'open-stickers']) {
      const onTop = await page.evaluate((btnId) => {
        const r = document.getElementById(btnId).getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        // The hit may land on a <span> inside the button; that still counts.
        const btn = el && el.closest ? el.closest('button') : null;
        return btn ? btn.id : el && el.tagName;
      }, id);
      expect(onTop, `${id} is covered by ${onTop}`).toBe(id);
    }
  });
});

// ---------------------------------------------------------------------------

test.describe('undo and redo', () => {
  const place = (page, ids) =>
    page.evaluate((list) => list.forEach((id) => window.__IMP_TEST__.place(id)), ids);

  test('undo puts a piece back in its alphabetical place', async ({ page }) => {
    await page.goto(FILE_URL);
    await page.click('.chip[data-level="3"]');
    await place(page, ['Assam', 'Bihar', 'Goa'].map(() => null).filter(Boolean));
    await place(page, ['AS', 'BR', 'GA']);

    expect((await page.evaluate(() => window.__IMP_TEST__.state())).placed).toBe(3);

    await page.click('#undo');
    await page.click('#undo');

    const s = await page.evaluate(() => window.__IMP_TEST__.state());
    expect(s.placed).toBe(1);
    expect(s.redo).toBe(2);

    // Appending the restored tiles would be the obvious bug; assert ordering.
    const names = await page.evaluate(() =>
      [...document.querySelectorAll('.tile')].map(
        (t) => window.IMP.render.byId[t.dataset.id].name
      )
    );
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names).toContain('Bihar');
    expect(names).toContain('Goa');
  });

  test('redo replaces them, and a new placement clears the redo stack', async ({ page }) => {
    await page.goto(FILE_URL);
    await page.click('.chip[data-level="3"]');
    await place(page, ['AS', 'BR']);
    await page.click('#undo');

    await page.click('#redo');
    expect((await page.evaluate(() => window.__IMP_TEST__.state())).placed).toBe(2);

    await page.click('#undo');
    await place(page, ['GA']);
    const s = await page.evaluate(() => window.__IMP_TEST__.state());
    expect(s.redo).toBe(0);
  });

  test('buttons disable when there is nothing to undo or redo', async ({ page }) => {
    await page.goto(FILE_URL);
    await expect(page.locator('#undo')).toBeDisabled();
    await expect(page.locator('#redo')).toBeDisabled();

    await place(page, ['MH']);
    await expect(page.locator('#undo')).toBeEnabled();
    await page.click('#undo');
    await expect(page.locator('#redo')).toBeEnabled();
    await expect(page.locator('#undo')).toBeDisabled();
  });

  test('undoing after a win takes the celebration away, but keeps the sticker', async ({ page }) => {
    await page.goto(FILE_URL);
    for (let i = 0; i < 6; i++) {
      await page.locator('.tile').first().focus();
      await page.keyboard.press('Enter');
    }
    await expect(page.locator('#win')).toBeVisible();

    // The overlay is modal and covers the HUD, so it has to be dismissed first.
    await page.click('#admire');
    await expect(page.locator('#win')).toBeHidden();

    await page.click('#undo');
    await expect(page.locator('#win')).toBeHidden();
    expect((await page.evaluate(() => window.__IMP_TEST__.state())).placed).toBe(5);

    // The sticker book records states ever placed; undo must not confiscate one.
    const stickers = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('imp.v1.stickers') || '[]')
    );
    expect(stickers).toContain('trophy-1');
  });
});

// ---------------------------------------------------------------------------

test.describe('zoom', () => {
  const viewBox = (page) => page.getAttribute('#board', 'viewBox');

  test('buttons zoom in and reset', async ({ page }) => {
    await page.goto(FILE_URL);
    const base = await viewBox(page);

    await page.click('#zoom-in');
    const zoomed = await viewBox(page);
    expect(zoomed).not.toBe(base);
    // A smaller viewBox width means we are looking at less of the map.
    expect(Number(zoomed.split(/\s+/)[2])).toBeLessThan(Number(base.split(/\s+/)[2]));

    await page.click('#zoom-reset');
    expect(await viewBox(page)).toBe(base);
  });

  test('cannot zoom out past the whole map', async ({ page }) => {
    await page.goto(FILE_URL);
    const base = await viewBox(page);
    await expect(page.locator('#zoom-out')).toBeDisabled();
    await page.click('#zoom-in');
    await page.click('#zoom-out');
    expect(await viewBox(page)).toBe(base);
  });

  test('a piece still snaps home while zoomed in', async ({ page }) => {
    /* The one that matters. Hit-testing goes through getScreenCTM so it tracks
       the viewBox, and the drag ghost is sized from the live viewBox -- both
       would silently break if either started using the original dimensions. */
    await page.goto(FILE_URL);
    await page.click('#zoom-in');
    await page.waitForTimeout(150);

    const id = await firstTrayId(page);
    const from = await tilePoint(page, id);
    const to = await slotPoint(page, id);

    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * i) / 8,
        from.y + ((to.y - from.y) * i) / 8
      );
    }
    await page.mouse.up();

    await expect(page.locator(`path.placed[data-id="${id}"]`)).toHaveAttribute('opacity', '1');
  });

  test('pinching with two fingers zooms', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
    const page = await context.newPage();
    await page.goto(FILE_URL);
    const base = await page.getAttribute('#board', 'viewBox');

    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 400, y: 350 }, { x: 500, y: 350 }],
    });
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 400 - i * 20, y: 350 }, { x: 500 + i * 20, y: 350 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    expect(await page.getAttribute('#board', 'viewBox')).not.toBe(base);
    await context.close();
  });
});

// ---------------------------------------------------------------------------

test.describe('panning performance', () => {
  /** Instrument the board: count viewBox writes and geometry reads. */
  const instrument = (page) =>
    page.addInitScript(() => {
      window.__perf = { writes: 0, rects: 0, gesture: false };
      const origSet = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function (name, value) {
        if (this.id === 'board' && name === 'viewBox') window.__perf.writes++;
        return origSet.call(this, name, value);
      };
      const origRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function () {
        if (this.id === 'board' && window.__perf.gesture) window.__perf.rects++;
        return origRect.call(this);
      };
    });

  test('coalesces viewBox writes to about one per frame', async ({ page }) => {
    await instrument(page);
    await page.goto(FILE_URL);
    await page.click('#zoom-in');           // must be zoomed in for panning to do anything
    await page.waitForTimeout(100);

    const result = await page.evaluate(async () => {
      const board = document.getElementById('board');
      const r = board.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const opts = { pointerId: 1, pointerType: 'touch', bubbles: true, isPrimary: true };

      board.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: cx, clientY: cy }));

      // Start counting only after pointerdown: measuring the board once, there,
      // is the whole point -- what must not happen is a read during the moves.
      window.__perf.writes = 0;
      window.__perf.rects = 0;
      window.__perf.gesture = true;

      const MOVES = 40;
      for (let i = 1; i <= MOVES; i++) {
        board.dispatchEvent(new PointerEvent('pointermove', {
          ...opts, clientX: cx - i, clientY: cy - i,
        }));
      }
      // Let any scheduled frame run.
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));

      const during = { writes: window.__perf.writes, rects: window.__perf.rects };
      board.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: cx - MOVES, clientY: cy - MOVES }));
      window.__perf.gesture = false;
      return { ...during, moves: MOVES };
    });

    // 40 synchronous moves span at most a frame or two. Before this fix every
    // move wrote the viewBox and forced a synchronous layout.
    expect(result.writes).toBeLessThanOrEqual(4);
    expect(result.writes).toBeGreaterThan(0);

    // And no geometry read while the finger moves -- reading the board rect with
    // a viewBox write pending is what forced a synchronous layout every move.
    expect(result.rects).toBe(0);
  });

  test('marks the body while panning, and clears it even if the gesture is cancelled', async ({ page }) => {
    await page.goto(FILE_URL);
    await page.click('#zoom-in');

    const states = await page.evaluate(async () => {
      const board = document.getElementById('board');
      const r = board.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const opts = { pointerId: 7, pointerType: 'touch', bubbles: true, isPrimary: true };

      board.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: cx, clientY: cy }));
      const during = document.body.classList.contains('panning');
      // pointercancel, not pointerup: a gesture the browser steals must not
      // strand the map without its shadows.
      board.dispatchEvent(new PointerEvent('pointercancel', { ...opts, clientX: cx, clientY: cy }));
      const after = document.body.classList.contains('panning');
      return { during, after };
    });

    expect(states.during).toBe(true);
    expect(states.after).toBe(false);
  });

  test('panning moves the map but cannot push it out of view', async ({ page }) => {
    await page.goto(FILE_URL);
    await page.click('#zoom-in');
    await page.waitForTimeout(100);
    const before = await page.getAttribute('#board', 'viewBox');

    const after = await page.evaluate(async () => {
      const board = document.getElementById('board');
      const r = board.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const opts = { pointerId: 3, pointerType: 'touch', bubbles: true, isPrimary: true };

      board.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: cx, clientY: cy }));
      // Shove far past the edge of the map in both axes.
      for (let i = 1; i <= 20; i++) {
        board.dispatchEvent(new PointerEvent('pointermove', {
          ...opts, clientX: cx + i * 200, clientY: cy + i * 200,
        }));
        await new Promise((res) => requestAnimationFrame(res));
      }
      board.dispatchEvent(new PointerEvent('pointerup', { ...opts, clientX: cx, clientY: cy }));
      await new Promise((res) => requestAnimationFrame(res));
      return board.getAttribute('viewBox');
    });

    expect(after).not.toBe(before);

    const [x, y, w, h] = after.split(/\s+/).map(Number);
    const [, , baseW, baseH] = await page.evaluate(() => window.INDIA_MAP.viewBox);
    expect(x).toBeGreaterThanOrEqual(-0.5);
    expect(y).toBeGreaterThanOrEqual(-0.5);
    expect(x + w).toBeLessThanOrEqual(baseW + 0.5);
    expect(y + h).toBeLessThanOrEqual(baseH + 0.5);
  });
});
