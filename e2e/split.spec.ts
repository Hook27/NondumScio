import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { makeSizedPdf } from './fixtures';
import { downloadVia, messages, openPage } from './helpers';

const nl = messages.nl;

/** Opent een PDF van vijf pagina's die je terugkent aan hun breedte: 300, 400, … 700. */
async function openPdf(page: Page, path: string, theme: 'light' | 'dark' = 'light') {
  await openPage(page, path, { lang: 'nl', theme });
  await page.locator('#pdf-file').setInputFiles({
    name: 'rapport.pdf',
    mimeType: 'application/pdf',
    buffer: await makeSizedPdf([300, 400, 500, 600, 700]),
  });
}

const partsList = (page: Page) => page.getByRole('list', { name: nl.split.parts });

async function widths(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => p.getWidth());
}

test.describe('splitsen', () => {
  test('per twee pagina’s splitsen en alles als ZIP downloaden', async ({ page }) => {
    await openPdf(page, '/#/split');
    await expect(partsList(page).getByRole('listitem')).toHaveCount(5, { timeout: 15_000 });
    await page.getByLabel(nl.split.size).fill('2');
    await expect(partsList(page).getByRole('listitem')).toHaveCount(3);

    const download = await downloadVia(
      page,
      page.getByRole('button', { name: 'Alle 3 delen downloaden (ZIP)' }),
    );
    expect(download.suggestedFilename()).toBe('rapport (gesplitst).zip');
    const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
    expect(Object.keys(files)).toEqual([
      "rapport (pagina's 1-2).pdf",
      "rapport (pagina's 3-4).pdf",
      'rapport (pagina 5).pdf',
    ]);
    expect(await Promise.all(Object.values(files).map(widths))).toEqual([
      [300, 400],
      [500, 600],
      [700],
    ]);
    await expect(page.getByRole('status')).toContainText('rapport (gesplitst).zip');
  });

  test('op bereiken splitsen en één deel downloaden', async ({ page }) => {
    await openPdf(page, '/#/split');
    await expect(partsList(page).getByRole('listitem')).toHaveCount(5, { timeout: 15_000 });
    await page.getByLabel(nl.split.ranges).check();
    const field = page.getByLabel(nl.split.rangesLabel);
    await field.fill('4-, 1 3');
    await expect(partsList(page).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('region', { name: nl.split.unused })).toBeVisible();

    const download = await downloadVia(
      page,
      page.getByRole('button', { name: 'Deel 2 downloaden' }),
      'oneven',
    );
    expect(download.suggestedFilename()).toBe('oneven.pdf');
    expect(await widths(new Uint8Array(readFileSync(await download.path())))).toEqual([300, 500]);

    await field.fill('1-9');
    await expect(page.getByRole('alert')).toHaveText('Pagina 9 bestaat niet: er zijn 5 pagina’s.');
  });

  test('volgt wat je bij Pagina’s hebt gedaan', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Toetsenbordbediening is op een telefoon niet relevant');
    await openPdf(page, '/#/pages');
    await expect(page.getByRole('option')).toHaveCount(5, { timeout: 15_000 });
    await page.getByRole('option').first().click();
    await page.keyboard.press('Delete');
    await expect(page.getByRole('option')).toHaveCount(4);

    await page
      .getByRole('navigation', { name: nl.mainMenu })
      .getByRole('link', { name: nl.tasks.split.title })
      .click();
    await expect(partsList(page).getByRole('listitem')).toHaveCount(4);
    const download = await downloadVia(
      page,
      page.getByRole('button', { name: 'Deel 1 downloaden' }),
    );
    expect(await widths(new Uint8Array(readFileSync(await download.path())))).toEqual([400]);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`is toegankelijk (${theme})`, async ({ page }) => {
      await openPdf(page, '/#/split', theme);
      await page.getByLabel(nl.split.ranges).check();
      await page.getByLabel(nl.split.rangesLabel).fill('1-2, x');
      await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });
      await page.getByLabel(nl.split.rangesLabel).fill('1-2, 4');
      await expect(page.locator('.thumb[data-rendered="true"]').first()).toBeVisible();
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
      ).toEqual([]);
    });
  }
});
