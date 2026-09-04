import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/synthetic.ome.tif', import.meta.url));
const MULTICHANNEL = fileURLToPath(new URL('./fixtures/multichannel.ome.tif', import.meta.url));

/**
 * Counts pixels dominated by each primary in the rendered canvas.
 *
 * The multichannel fixture puts each channel in its own horizontal band, and
 * the fallback palette gives them green, magenta and blue, so the composite is
 * checked by looking for all three rather than by sampling exact positions.
 */
async function dominantCounts(page: Page): Promise<{
  green: number;
  magenta: number;
  blue: number;
}> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const empty = { green: 0, magenta: 0, blue: 0 };
    if (canvas === null) return empty;
    const probe = document.createElement('canvas');
    probe.width = canvas.width;
    probe.height = canvas.height;
    const context = probe.getContext('2d');
    if (context === null) return empty;
    context.drawImage(canvas, 0, 0);
    const { data } = context.getImageData(0, 0, probe.width, probe.height);

    const counts = { green: 0, magenta: 0, blue: 0 };
    const FLOOR = 60;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      if (g > FLOOR && g > r * 1.6 && g > b * 1.6) counts.green += 1;
      else if (r > FLOOR && b > FLOOR && r > g * 1.6 && b > g * 1.6) counts.magenta += 1;
      else if (b > FLOOR && b > r * 1.6 && b > g * 1.2) counts.blue += 1;
    }
    return counts;
  });
}

test('opens a pyramidal slide and renders tiles', async ({ page }) => {
  await page.goto('./');

  await expect(page.getByRole('heading', { name: 'Open a whole-slide image' })).toBeVisible();

  await page.getByLabel('Choose a whole-slide image').setInputFiles(FIXTURE);

  // Opening compiles the WASM core and reads the file, so allow real time.
  const slide = page.getByRole('region', { name: 'Slide' });
  await expect(slide).toBeVisible({ timeout: 60_000 });
  await expect(slide).toContainText('synthetic.ome.tif');
  await expect(slide).toContainText('1,024 x 768');

  // The fixture is written with three resolution levels.
  const pyramid = page.getByRole('region', { name: 'Pyramid' });
  await expect(pyramid).toContainText('512 x 384');
  await expect(pyramid).toContainText('256 x 192');

  const viewer = page.getByRole('application', { name: /Slide viewer/ });
  await expect(viewer).toBeVisible();

  // The canvas must actually contain the fixture's colours rather than an empty
  // frame, so a pixel is sampled from the rendered WebGL output.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const canvas = document.querySelector('canvas');
          if (canvas === null) return 0;
          const probe = document.createElement('canvas');
          probe.width = canvas.width;
          probe.height = canvas.height;
          const context = probe.getContext('2d');
          if (context === null) return 0;
          context.drawImage(canvas, 0, 0);
          const { data } = context.getImageData(0, 0, probe.width, probe.height);
          let coloured = 0;
          // Count pixels that are neither transparent nor the neutral backdrop.
          for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3] ?? 0;
            const red = data[i] ?? 0;
            const green = data[i + 1] ?? 0;
            const blue = data[i + 2] ?? 0;
            if (alpha > 0 && Math.abs(red - green) + Math.abs(green - blue) > 24) coloured += 1;
          }
          return coloured;
        }),
      { timeout: 60_000, message: 'expected the viewer to paint coloured tiles' },
    )
    .toBeGreaterThan(1000);
});

test('shows an overview map that follows the viewport', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Choose a whole-slide image').setInputFiles(FIXTURE);

  const overview = page.getByRole('img', { name: /Overview of the slide/ });
  await expect(overview).toBeVisible({ timeout: 60_000 });

  // Zoom in first: with the whole slide in view the extent constraint pins the
  // centre, so recentring is a no-op until there is somewhere to pan to.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();

  // Recentre by clicking near the top of the overview, and confirm the map
  // followed by reading the centre back out of the URL.
  const box = await overview.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  // The initial fit already writes a centre, so wait for it to actually move
  // rather than for the parameter merely to exist.
  const readY = (): string | null => new URL(page.url()).searchParams.get('y');
  await expect.poll(readY, { timeout: 15_000 }).not.toBeNull();
  const before = Number(readY());

  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.2);
  await expect.poll(() => Number(readY()), { timeout: 15_000 }).not.toBe(before);

  // The fixture is 768 tall; clicking a fifth of the way down lands well above
  // the middle, and above wherever the view started.
  expect(Number(readY())).toBeLessThan(768 / 2);

  // And it can be collapsed out of the way.
  await page.getByRole('button', { name: 'Hide overview map' }).click();
  await expect(overview).toBeHidden();
  await expect(page.getByRole('button', { name: 'Show overview map' })).toBeVisible();
});

test('rejects a file no reader claims', async ({ page }) => {
  await page.goto('./');

  await page.getByLabel('Choose a whole-slide image').setInputFiles({
    name: 'notes.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('not a slide'),
  });

  await expect(page.getByRole('alert')).toContainText('not a format this viewer can read');
});

test('offers light, dark and system themes', async ({ page }) => {
  await page.goto('./');

  await page.getByRole('button', { name: 'Change colour theme' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toBeVisible();

  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
});

test('docks panels to any edge and remembers the arrangement', async ({ page }) => {
  await page.goto('./');

  const folders = page.getByRole('region', { name: 'Folders' });
  await expect(folders).toBeVisible();
  await expect(folders.getByRole('button', { name: 'Add folder' })).toBeVisible();

  // Panels move through the header menu, which is also the keyboard path.
  await page.getByRole('button', { name: 'Move Folders panel' }).click();
  await page.getByRole('menuitemradio', { name: 'Bottom' }).click();

  // The dock a panel lives in is reflected by which resize handle exists.
  await expect(page.getByRole('separator', { name: 'Resize the bottom panel' })).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize the left panel' })).toBeHidden();

  // The arrangement is a local preference, so it survives a reload.
  await page.reload();
  await expect(page.getByRole('separator', { name: 'Resize the bottom panel' })).toBeVisible();

  // Resizing works from the keyboard as well as by dragging.
  const handle = page.getByRole('separator', { name: 'Resize the bottom panel' });
  const before = Number(await handle.getAttribute('aria-valuenow'));
  await handle.focus();
  await page.keyboard.press('ArrowUp');
  await expect
    .poll(async () => Number(await handle.getAttribute('aria-valuenow')))
    .not.toBe(before);
});

test('collapses a panel to its header', async ({ page }) => {
  await page.goto('./');

  const folders = page.getByRole('region', { name: 'Folders' });
  await expect(folders.getByRole('button', { name: 'Add folder' })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse Folders' }).click();
  await expect(folders.getByRole('button', { name: 'Add folder' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Expand Folders' })).toBeVisible();
});

test('drags a panel to another dock, showing where it will land', async ({ page }) => {
  await page.goto('./');

  const folders = page.getByRole('region', { name: 'Folders' });
  await expect(folders).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize the left panel' })).toBeVisible();

  const header = folders.getByRole('heading', { name: 'Folders' });
  const grip = await header.boundingBox();
  expect(grip).not.toBeNull();
  if (grip === null) return;

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (viewport === null) return;

  // Press, then move in steps: the drag only engages past a small threshold, so
  // a single jump would look like a click.
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewport.width / 2, viewport.height - 200, { steps: 8 });
  await page.mouse.move(viewport.width / 2, viewport.height - 40, { steps: 8 });

  // Feedback appears while the pointer is still down.
  await expect(page.getByText('Folders', { exact: true }).last()).toBeVisible();

  await page.mouse.up();

  // The panel now lives in the bottom dock, and the left dock is gone with it.
  await expect(page.getByRole('separator', { name: 'Resize the bottom panel' })).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize the left panel' })).toBeHidden();
  await expect(folders.getByRole('button', { name: 'Add folder' })).toBeVisible();
});

test('zooms with the wheel without needing a click first', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Choose a whole-slide image').setInputFiles(FIXTURE);

  const viewer = page.getByRole('application', { name: /Slide viewer/ });
  await expect(viewer).toBeVisible({ timeout: 60_000 });

  const readResolution = (): string | null => new URL(page.url()).searchParams.get('r');
  await expect.poll(readResolution, { timeout: 15_000 }).not.toBeNull();
  const before = Number(readResolution());

  // Deliberately no click. OpenLayers builds its default interactions with
  // onFocusOnly, which requires focus whenever the target carries a tabindex —
  // and the viewer has one so the arrow keys can pan it. Without overriding
  // that, the first gesture on a freshly opened slide is swallowed.
  const box = await viewer.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);

  await expect.poll(() => Number(readResolution()), { timeout: 15_000 }).toBeLessThan(before);
});

test('composites a multichannel slide and lets channels be turned off', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Choose a whole-slide image').setInputFiles(MULTICHANNEL);

  const channels = page.getByRole('region', { name: 'Channels' });
  await expect(channels).toBeVisible({ timeout: 60_000 });

  // Three separate planes, so three independently controllable channels.
  await expect(channels.getByRole('button', { name: /^Hide Channel/ })).toHaveCount(3);

  // Each channel takes a different colour, so all three primaries appear.
  await expect
    .poll(async () => (await dominantCounts(page)).green, { timeout: 30_000 })
    .toBeGreaterThan(200);
  const composite = await dominantCounts(page);
  expect(composite.magenta).toBeGreaterThan(200);
  expect(composite.blue).toBeGreaterThan(200);

  // Hiding one channel removes its contribution without touching the others.
  await channels.getByRole('button', { name: 'Hide Channel 1' }).click();
  await expect
    .poll(async () => (await dominantCounts(page)).green, { timeout: 15_000 })
    .toBeLessThan(composite.green / 4);

  const remaining = await dominantCounts(page);
  expect(remaining.magenta).toBeGreaterThan(200);
});

test('offers a single adjustment for brightfield slides', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Choose a whole-slide image').setInputFiles(FIXTURE);

  const channels = page.getByRole('region', { name: 'Channels' });
  await expect(channels).toBeVisible({ timeout: 60_000 });

  // A brightfield image has no separate planes to colour, so it gets one window.
  await expect(channels).toContainText('brightfield');
  await expect(channels.getByRole('button', { name: /^Hide Channel/ })).toHaveCount(0);
});
