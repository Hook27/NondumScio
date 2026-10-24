import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { makeSizedPdf } from './fixtures';
import { downloadVia, messages, openPage } from './helpers';

const nl = messages.nl;

/** Drie bestanden die je terugkent aan de breedte van hun pagina's. */
async function files() {
  return [
    {
      name: 'offerte.pdf',
      mimeType: 'application/pdf',
      buffer: await makeSizedPdf([300, 310], 'Offerte'),
    },
    {
      name: 'bijlage.pdf',
      mimeType: 'application/pdf',
      buffer: await makeSizedPdf([500], 'Bijlage'),
    },
    {
      name: 'voorwaarden.pdf',
      mimeType: 'application/pdf',
      buffer: await makeSizedPdf([700, 710, 720], 'Voorwaarden'),
    },
  ];
}

const list = (page: Page) => page.getByRole('list', { name: nl.merge.files });
const names = (page: Page) => list(page).locator('.merge-list__name').allTextContents();

/** Het openen van meerdere PDF's (met het opstarten van pdf.js) kan onder belasting even duren. */
const OPEN_TIMEOUT = { timeout: 15_000 };

async function openMerge(page: Page, theme: 'light' | 'dark' = 'light') {
  await openPage(page, '/#/merge', { lang: 'nl', theme });
  await page.locator('#pdf-file').setInputFiles(await files());
  await expect(list(page).getByRole('listitem')).toHaveCount(3, OPEN_TIMEOUT);
}

/** Downloadt via het venster en leest de PDF terug: breedtes en titel. */
async function readDownload(page: Page, button: string, fileName?: string) {
  const download = await downloadVia(page, page.getByRole('button', { name: button }), fileName);
  const doc = await PDFDocument.load(readFileSync(await download.path()));
  return {
    name: download.suggestedFilename(),
    widths: doc.getPages().map((p) => p.getWidth()),
    title: doc.getTitle(),
  };
}

test.describe('samenvoegen', () => {
  test('drie PDF’s samenvoegen in de gekozen volgorde', async ({ page }) => {
    await openMerge(page);
    expect(await names(page)).toEqual(['offerte.pdf', 'bijlage.pdf', 'voorwaarden.pdf']);
    await expect(page.locator('.document__meta')).toContainText('6 pagina’s');

    await page.getByRole('button', { name: 'voorwaarden.pdf omhoog' }).click();
    expect(await names(page)).toEqual(['offerte.pdf', 'voorwaarden.pdf', 'bijlage.pdf']);

    const result = await readDownload(page, nl.merge.download);
    expect(result.name).toBe('offerte (samengevoegd).pdf');
    expect(result.widths).toEqual([300, 310, 700, 710, 720, 500]);
    expect(result.title).toBe('Offerte');
  });

  test('een bestand weghalen en dat ongedaan maken', async ({ page }) => {
    await openMerge(page);
    await page.getByRole('button', { name: 'bijlage.pdf weghalen' }).click();
    expect(await names(page)).toEqual(['offerte.pdf', 'voorwaarden.pdf']);
    await page.getByRole('button', { name: nl.pages.undo }).click();
    expect(await names(page)).toEqual(['offerte.pdf', 'bijlage.pdf', 'voorwaarden.pdf']);

    await page.getByRole('button', { name: 'offerte.pdf weghalen' }).click();
    const result = await readDownload(page, nl.merge.download, 'zonder offerte');
    expect(result.name).toBe('zonder offerte.pdf');
    expect(result.widths).toEqual([500, 700, 710, 720]);
  });

  test('later nog een bestand toevoegen', async ({ page }) => {
    await openPage(page, '/#/merge', { lang: 'nl' });
    const [first, second] = await files();
    await page.locator('#pdf-file').setInputFiles(first!);
    await expect(list(page).getByRole('listitem')).toHaveCount(1, OPEN_TIMEOUT);
    await page.locator('#merge-add').setInputFiles(second!);
    await expect(list(page).getByRole('listitem')).toHaveCount(2, OPEN_TIMEOUT);

    const result = await readDownload(page, nl.merge.download);
    expect(result.widths).toEqual([300, 310, 500]);
  });

  test('een bestand dat geen PDF is wordt gemeld, de rest gaat door', async ({ page }) => {
    await openPage(page, '/#/merge', { lang: 'nl' });
    const [first] = await files();
    await page
      .locator('#pdf-file')
      .setInputFiles([
        first!,
        { name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]) },
      ]);
    await expect(list(page).getByRole('listitem')).toHaveCount(1, OPEN_TIMEOUT);
    await expect(page.getByRole('alert')).toContainText('foto.jpg is geen PDF');
  });

  test('bij Pagina’s pagina’s van verschillende bestanden door elkaar zetten', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Toetsenbordbediening is op een telefoon niet relevant');
    await openPage(page, '/#/pages', { lang: 'nl' });
    const [first, second] = await files();
    await page.locator('#pdf-file').setInputFiles(first!);
    await expect(page.getByRole('option')).toHaveCount(2, OPEN_TIMEOUT);
    await page.locator('#add-pdf').setInputFiles(second!);
    await expect(page.getByRole('option')).toHaveCount(3, OPEN_TIMEOUT);
    await expect(page.getByRole('option').nth(2)).toHaveAttribute(
      'aria-label',
      'Pagina 3, uit bijlage.pdf',
    );

    // De bijlage tussen de twee offertepagina's zetten.
    await page.getByRole('option').nth(2).click();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.getByRole('option').nth(1)).toHaveAttribute(
      'aria-label',
      'Pagina 2, uit bijlage.pdf',
    );

    // Samenvoegen ziet dezelfde stand.
    await page
      .getByRole('navigation', { name: nl.mainMenu })
      .getByRole('link', { name: nl.tasks.merge.title })
      .click();
    expect(await names(page)).toEqual(['offerte.pdf', 'bijlage.pdf']);
    const result = await readDownload(page, nl.merge.download);
    expect(result.widths).toEqual([300, 500, 310]);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`is toegankelijk (${theme})`, async ({ page }) => {
      await openMerge(page, theme);
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
