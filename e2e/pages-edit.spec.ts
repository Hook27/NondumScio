import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { makeSizedPdf } from './fixtures';
import { messages, openPage } from './helpers';

const nl = messages.nl;
const options = (page: Page) => page.getByRole('option');
const toolbarButton = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: nl.pages.toolbar }).getByRole('button', { name });

async function openThreePages(page: Page, path = '/#/pages') {
  await openPage(page, path, { lang: 'nl' });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'drie.pdf',
    mimeType: 'application/pdf',
    buffer: await makeSizedPdf([300, 400, 500]),
  });
  await expect(options(page)).toHaveCount(3);
}

/** Leest een gedownloade PDF terug: breedte en draaiing per pagina. */
async function readDownload(path: string) {
  const doc = await PDFDocument.load(readFileSync(path));
  return {
    widths: doc.getPages().map((p) => p.getWidth()),
    rotations: doc.getPages().map((p) => p.getRotation().angle),
    title: doc.getTitle(),
  };
}

test.describe('pagina’s bewerken', () => {
  test('verwijderen, draaien en downloaden geeft de juiste PDF', async ({ page }) => {
    await openThreePages(page);

    await options(page).nth(1).click();
    await toolbarButton(page, nl.pages.remove).click();
    await expect(options(page)).toHaveCount(2);

    await options(page).nth(0).click();
    await toolbarButton(page, nl.pages.rotateRight).click();
    await expect(options(page).nth(0)).toHaveAttribute('aria-label', 'Pagina 1, 90° gedraaid');

    // De gedraaide miniatuur ligt nu: breder dan hoog.
    const thumb = page.locator('.page-option canvas').first();
    await expect(page.locator('.page-option .thumb').first()).toHaveAttribute(
      'data-rendered',
      'true',
    );
    const box = await thumb.boundingBox();
    expect(box!.width).toBeGreaterThan(box!.height);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      toolbarButton(page, nl.pages.save).click(),
    ]);
    expect(download.suggestedFilename()).toBe('drie (bewerkt).pdf');
    const result = await readDownload(await download.path());
    expect(result.widths).toEqual([300, 500]);
    expect(result.rotations).toEqual([90, 0]);
    expect(result.title).toBe('Pagina-test');
    await expect(page.getByRole('status').filter({ hasText: 'Opgeslagen als' })).toBeVisible();
  });

  test('ongedaan maken en opnieuw, ook met Ctrl+Z en Ctrl+Y', async ({ page }) => {
    await openThreePages(page);
    await options(page).nth(2).click();
    await toolbarButton(page, nl.pages.remove).click();
    await expect(options(page)).toHaveCount(2);

    await page.keyboard.press('Control+z');
    await expect(options(page)).toHaveCount(3);
    await page.keyboard.press('Control+y');
    await expect(options(page)).toHaveCount(2);
    await toolbarButton(page, nl.pages.undo).click();
    await expect(options(page)).toHaveCount(3);
  });

  test('is met het toetsenbord te bedienen', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Toetsenbordbediening is op een telefoon niet relevant');
    await openThreePages(page);
    await options(page).first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(options(page).nth(1)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(options(page)).toHaveCount(2);
  });

  test('de bewerkingen blijven bewaard als je van taak wisselt', async ({ page }) => {
    await openThreePages(page);
    await options(page).nth(0).click();
    await toolbarButton(page, nl.pages.remove).click();

    await page
      .getByRole('navigation', { name: nl.mainMenu })
      .getByRole('link', { name: nl.tasks.merge.title })
      .click();
    await expect(page.locator('.document__meta')).toContainText('2 pagina’s');
    await expect(page.locator('.thumbs .thumb')).toHaveCount(2);
  });

  test('waarschuwt bij weggaan met niet-gedownloade wijzigingen', async ({ page }) => {
    await openThreePages(page);
    await options(page).nth(0).click();
    await toolbarButton(page, nl.pages.remove).click();

    const dialoog = new Promise<string>((resolve) =>
      page.once('dialog', (dialog) => {
        resolve(dialog.type());
        void dialog.dismiss();
      }),
    );
    await page.close({ runBeforeUnload: true });
    expect(await dialoog).toBe('beforeunload');
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`is toegankelijk tijdens het bewerken (${theme})`, async ({ page }) => {
      await openPage(page, '/#/pages', { lang: 'nl', theme });
      await page.locator('input[type="file"]').setInputFiles({
        name: 'drie.pdf',
        mimeType: 'application/pdf',
        buffer: await makeSizedPdf([300, 400, 500]),
      });
      await options(page).nth(1).click();
      await toolbarButton(page, nl.pages.rotateRight).click();
      await expect(page.locator('.page-option .thumb').nth(2)).toHaveAttribute(
        'data-rendered',
        'true',
      );

      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
      ).toEqual([]);
    });
  }
});
