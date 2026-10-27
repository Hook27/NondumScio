import { expect, test, type Page } from '@playwright/test';
import { makePdf } from './fixtures';
import { openPage } from './helpers';

/**
 * Miniaturen geven hun beeldpunten vrij als ze ver uit beeld zijn, zodat een lang document na veel
 * scrollen binnen het geheugen van een telefoon blijft; komen ze terug, dan worden ze opnieuw getekend.
 */

const PAGES = 150;
const thumbs = (page: Page) => page.locator('.page-option .thumb');

/** Hoeveel miniaturen nu beeldpunten vasthouden. */
const drawn = (page: Page) =>
  page
    .locator('.page-option .thumb canvas')
    .evaluateAll((canvases) => canvases.filter((c) => (c as HTMLCanvasElement).width > 0).length);

test('miniaturen ver uit beeld geven hun geheugen vrij, en komen terug als je terugscrolt', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openPage(page, '/#/pages', { lang: 'nl' });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'lang.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf(PAGES),
  });
  await expect(thumbs(page)).toHaveCount(PAGES, { timeout: 15_000 });
  await expect(thumbs(page).first()).toHaveAttribute('data-rendered', 'true');

  // Naar het eind: daar wordt getekend, en het begin geeft zijn beeldpunten vrij.
  await thumbs(page).last().scrollIntoViewIfNeeded();
  await expect(thumbs(page).last()).toHaveAttribute('data-rendered', 'true');
  await expect(thumbs(page).first()).toHaveAttribute('data-rendered', 'false');
  const kept = await drawn(page);
  expect(kept).toBeGreaterThan(0);
  expect(kept).toBeLessThan(PAGES / 2);
  // Het vakje houdt zijn maat, ook zonder beeldpunten: er verspringt niets.
  const box = await thumbs(page).first().boundingBox();
  expect(box!.height).toBeGreaterThan(50);

  // Terug naar boven: het begin wordt opnieuw getekend, het eind weer vrijgegeven.
  await thumbs(page).first().scrollIntoViewIfNeeded();
  await expect(thumbs(page).first()).toHaveAttribute('data-rendered', 'true');
  await expect(thumbs(page).last()).toHaveAttribute('data-rendered', 'false');
});
