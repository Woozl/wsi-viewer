import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('./fixtures/synthetic.ome.tif', import.meta.url));

test('opens a pyramidal slide and renders tiles', async ({ page }) => {
  await page.goto('./');

  await expect(page.getByRole('heading', { name: 'Open a whole-slide image' })).toBeVisible();

  await page.getByLabel('Choose a whole-slide image').setInputFiles(FIXTURE);

  // Opening compiles the WASM core and reads the file, so allow real time.
  const sidebar = page.getByRole('complementary', { name: 'Slide details' });
  await expect(sidebar).toBeVisible({ timeout: 60_000 });
  await expect(sidebar).toContainText('synthetic.ome.tif');
  await expect(sidebar).toContainText('1,024 x 768');

  // The fixture is written with three resolution levels.
  await expect(sidebar).toContainText('512 x 384');
  await expect(sidebar).toContainText('256 x 192');

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
