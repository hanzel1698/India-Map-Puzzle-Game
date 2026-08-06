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
    await expect(page.locator('.tile')).toHaveCount(6);
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
    await expect(page.locator('.tile')).toHaveCount(6);
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

test('all six tray pieces fit on screen, with nothing clipped', async ({ browser }) => {
  /* Regression. Tiles carry `touch-action: none` so a drag is never stolen as a
     scroll -- which means the tray is one solid surface with nothing swipeable,
     and any tile pushed outside it is simply unreachable on a touchscreen.
     A tray that overflows is therefore a tray with lost pieces, not a tray that
     scrolls. Six must always fit. */
  for (const [width, height, name] of [
    [1280, 800, 'tablet landscape'],
    [800, 1280, 'tablet portrait'],
    [1024, 768, 'small tablet landscape'],
    [412, 915, 'phone portrait'],
    [1440, 900, 'laptop'],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
    const page = await context.newPage();
    await page.goto(FILE_URL);
    await page.click('.chip[data-level="3"]');     // 36 pieces: the tray is full
    await expect(page.locator('.tile')).toHaveCount(6);

    const result = await page.evaluate(() => {
      const tray = document.getElementById('tray');
      const box = tray.getBoundingClientRect();
      const clipped = [...document.querySelectorAll('.tile')]
        .filter((t) => {
          const b = t.getBoundingClientRect();
          return b.right > box.right + 1 || b.bottom > box.bottom + 1 ||
                 b.left < box.left - 1 || b.top < box.top - 1;
        })
        .map((t) => t.dataset.id);
      return {
        clipped,
        overflowX: tray.scrollWidth - tray.clientWidth,
        overflowY: tray.scrollHeight - tray.clientHeight,
      };
    });

    expect(result.clipped, `clipped tiles at ${name}`).toEqual([]);
    expect(result.overflowX, `horizontal overflow at ${name}`).toBeLessThanOrEqual(1);
    expect(result.overflowY, `vertical overflow at ${name}`).toBeLessThanOrEqual(1);

    await context.close();
  }
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
