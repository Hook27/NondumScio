import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { downloadVia, messages, openPage } from './helpers';
import { makeOutlinePdf, type OutlineItem } from './outline-fixtures';

const nl = messages.nl;
const s = nl.split;

/** Een rapport van tien pagina's ("Pagina n" erop), met geneste bladwijzers en een naar een website. */
const OUTLINE: OutlineItem[] = [
  { title: 'Inleiding', page: 1 },
  {
    title: 'Hoofdstuk 1',
    page: 3,
    children: [
      { title: 'Paragraaf 1.1', page: 3 },
      { title: 'Paragraaf 1.2', page: 5 },
    ],
  },
  { title: 'Website', uri: 'https://example.com/' },
  { title: 'Bijlage / A', page: 8 },
];

async function open(page: Page, theme: 'light' | 'dark' = 'light') {
  await openPage(page, '/#/split', { lang: 'nl', theme });
  await page.locator('#pdf-file').setInputFiles({
    name: 'rapport.pdf',
    mimeType: 'application/pdf',
    buffer: await makeOutlinePdf(OUTLINE, 10),
  });
  await expect(page.getByRole('list', { name: s.parts })).toBeVisible({ timeout: 15_000 });
  await page.getByLabel(s.bookmarks).check();
}

const table = (page: Page) => page.getByRole('table', { name: s.table.label });
const rows = (page: Page) => table(page).getByRole('row');

/** Wat er op elke pagina staat ("Pagina 4") en de titel van het document. */
async function contents(bytes: Uint8Array) {
  const pdf = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const text = await (await pdf.getPage(n)).getTextContent();
    pages.push(text.items.map((item) => ('str' in item ? item.str : '')).join(''));
  }
  const { info } = (await pdf.getMetadata()) as { info: { Title?: string } };
  await pdf.loadingTask.destroy();
  return { title: info.Title, pages };
}

test.describe('splitsen op bladwijzers', () => {
  test.skip(({ isMobile }) => isMobile, 'Op bladwijzers is er alleen op de computer');

  test('delen uitvinken, een naam aanpassen en als ZIP downloaden', async ({ page }) => {
    await open(page);
    // Een kop en vijf delen: voorwerk, inleiding, paragraaf 1.1 (ook: hoofdstuk 1), 1.2, bijlage.
    await expect(rows(page)).toHaveCount(6, { timeout: 15_000 });
    await expect(rows(page).nth(3)).toContainText('Paragraaf 1.1ook: Hoofdstuk 1');
    await expect(page.getByText(/^10 pagina’s · 6 bladwijzers · 2 niveaus → /)).toHaveText(
      '10 pagina’s · 6 bladwijzers · 2 niveaus → 5 van 5 delen geselecteerd (10 pagina’s)',
    );
    await expect(
      page.getByText('1 bladwijzer zonder geldige pagina overgeslagen: Website'),
    ).toBeVisible();

    await page.getByRole('checkbox', { name: /^Deel 1 meenemen/ }).uncheck();
    await page.getByLabel('Bestandsnaam deel 5').fill('Bijlage: laatste?');
    const download = await downloadVia(
      page,
      page.getByRole('button', { name: '4 van 5 delen downloaden (ZIP)' }),
    );
    expect(download.suggestedFilename()).toBe('rapport (gesplitst).zip');
    const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
    expect(Object.keys(files)).toEqual([
      '02 - Inleiding.pdf',
      '03 - Paragraaf 1.1.pdf',
      '04 - Paragraaf 1.2.pdf',
      'Bijlage laatste.pdf',
    ]);
    expect(await Promise.all(Object.values(files).map(contents))).toEqual([
      { title: 'Inleiding', pages: ['Pagina 2', 'Pagina 3'] },
      { title: 'Paragraaf 1.1', pages: ['Pagina 4', 'Pagina 5'] },
      { title: 'Paragraaf 1.2', pages: ['Pagina 6', 'Pagina 7', 'Pagina 8'] },
      { title: 'Bijlage / A', pages: ['Pagina 9', 'Pagina 10'] },
    ]);
  });

  test('een submap per hoofdbladwijzer in de ZIP', async ({ page }) => {
    await open(page);
    await expect(rows(page)).toHaveCount(6, { timeout: 15_000 });
    await page.getByLabel(s.zipLayout).selectOption({ label: s.zipFolders });
    const download = await downloadVia(
      page,
      page.getByRole('button', { name: 'Alle 5 delen downloaden (ZIP)' }),
    );
    const files = unzipSync(new Uint8Array(readFileSync(await download.path())));
    expect(Object.keys(files)).toEqual([
      '01 - Voorwerk.pdf',
      '02 - Inleiding.pdf',
      'Hoofdstuk 1/03 - Paragraaf 1.1.pdf',
      'Hoofdstuk 1/04 - Paragraaf 1.2.pdf',
      '05 - Bijlage - A.pdf',
    ]);
    expect((await contents(files['Hoofdstuk 1/04 - Paragraaf 1.2.pdf']!)).pages).toEqual([
      'Pagina 6',
      'Pagina 7',
      'Pagina 8',
    ]);
  });

  test('op niveau 1 met grenspagina, en een deel los downloaden', async ({ page }) => {
    await open(page);
    await expect(rows(page)).toHaveCount(6, { timeout: 15_000 });
    await page.getByLabel(s.level).selectOption({ label: s.levelOne });
    await page.getByLabel(s.overlap).check();
    await expect(rows(page)).toHaveCount(5);
    await expect(rows(page).nth(3)).toContainText('Hoofdstuk 14–96');

    // Meteen, zonder venster "Opslaan als", onder de naam uit de tabel.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Deel 3 downloaden' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('03 - Hoofdstuk 1.pdf');
    expect(await contents(new Uint8Array(readFileSync(await download.path())))).toEqual({
      title: 'Hoofdstuk 1',
      pages: ['Pagina 4', 'Pagina 5', 'Pagina 6', 'Pagina 7', 'Pagina 8', 'Pagina 9'],
    });
    await expect(page.getByRole('status')).toContainText('03 - Hoofdstuk 1.pdf');
  });

  test('een deel bekijken, bladeren en sluiten', async ({ page }) => {
    await open(page);
    const view = page.getByRole('button', { name: 'Bekijk deel 4' });
    await view.click();
    const dialog = page.getByRole('dialog', { name: '04 - Paragraaf 1.2.pdf' });
    await expect(dialog.getByText('Pagina 1 van 3 (blz. 6)')).toBeVisible();
    const canvas = dialog.locator('canvas');
    await expect
      .poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.width), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByText('Pagina 2 van 3 (blz. 7)')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(view).toBeFocused();
  });

  test('rechts ook de pagina’s per deel', async ({ page }) => {
    await open(page);
    await expect(rows(page)).toHaveCount(6, { timeout: 15_000 });
    await page.getByRole('checkbox', { name: /^Deel 2 meenemen/ }).uncheck();
    await page.getByRole('button', { name: s.views.pages }).click();
    const thumbs = page.getByRole('list', { name: nl.merge.result }).getByRole('listitem');
    await expect(thumbs).toHaveCount(10);
    await expect(thumbs.nth(1)).toContainText(s.unselected);
    await expect(page.locator('.thumbs__off')).toHaveCount(2);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`is toegankelijk (${theme})`, async ({ page }) => {
      await open(page, theme);
      await expect(rows(page)).toHaveCount(6, { timeout: 15_000 });
      await page.getByLabel('Bestandsnaam deel 3').fill('02 - Inleiding.pdf');
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
      ).toEqual([]);
    });
  }
});

test('op een telefoon is er geen splitsen op bladwijzers', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Alleen op een smal scherm');
  await openPage(page, '/#/split', { lang: 'nl' });
  await page.locator('#pdf-file').setInputFiles({
    name: 'rapport.pdf',
    mimeType: 'application/pdf',
    buffer: await makeOutlinePdf(OUTLINE, 10),
  });
  await expect(page.getByRole('list', { name: s.parts })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel(s.every)).toBeVisible();
  await expect(page.getByLabel(s.bookmarks)).toHaveCount(0);
});
