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

  await page.goto('file://' + join(REPO, 'stickers.html'));
  await expect(page.locator('.sticker.earned').first()).toBeVisible();
  const earned = await page.locator('.sticker.earned').count();
  expect(earned).toBeGreaterThanOrEqual(7);
  await page.screenshot({ path: join(SHOTS, 'stickers.png'), fullPage: true });
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
