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

/**
 * Een punt in een bestand in de lijst: het greepje (om op te pakken), of bovenin of onderin
 * het vak (om los te laten). Scrollt niet: zet eerst de lijst in beeld met `showList`, anders
 * kloppen eerder berekende punten niet meer.
 */
async function point(page: Page, index: number, where: 'handle' | 'top' | 'bottom') {
  const item = list(page).getByRole('listitem').nth(index);
  if (where === 'handle') {
    const box = (await item.locator('.drag-handle').boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }
  const box = (await item.boundingBox())!;
  return { x: box.x + 20, y: box.y + (where === 'top' ? 6 : box.height - 6) };
}

/** Zet de hele lijst in beeld, zodat alle punten tijdens het slepen blijven kloppen. */
async function showList(page: Page) {
  await list(page).evaluate((el) => el.scrollIntoView({ block: 'center' }));
}

/** Sleept met de muis een bestand naar boven- of onderin een ander bestand. */
async function dragTo(page: Page, from: number, to: number, where: 'top' | 'bottom') {
  await showList(page);
  const start = await point(page, from, 'handle');
  const end = await point(page, to, where);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

/** Sleept met de vinger aan het greepje (echte aanraakgebeurtenissen via Chromium). */
async function touchDragTo(page: Page, from: number, to: number, where: 'top' | 'bottom') {
  await showList(page);
  const start = await point(page, from, 'handle');
  const end = await point(page, to, where);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
    });
  await touch('touchStart', start.x, start.y);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await touch(
      'touchMove',
      start.x + ((end.x - start.x) * i) / steps,
      start.y + ((end.y - start.y) * i) / steps,
    );
  }
  await touch('touchEnd', end.x, end.y);
  await cdp.detach();
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

  test('een bestand in één keer naar een andere plek slepen', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Op een telefoon sleep je aan het greepje (aparte test)');
    await openMerge(page);
    // Het laatste bestand naar boven, vóór het eerste.
    await dragTo(page, 2, 0, 'top');
    await expect(list(page).locator('.merge-list__name')).toHaveText([
      'voorwaarden.pdf',
      'offerte.pdf',
      'bijlage.pdf',
    ]);
    // Het eerste bestand helemaal naar onderen.
    await dragTo(page, 0, 2, 'bottom');
    await expect(list(page).locator('.merge-list__name')).toHaveText([
      'offerte.pdf',
      'bijlage.pdf',
      'voorwaarden.pdf',
    ]);
    // Elke sleepbeweging is één stap voor ongedaan maken.
    await page.getByRole('button', { name: nl.pages.undo }).click();
    await expect(list(page).locator('.merge-list__name')).toHaveText([
      'voorwaarden.pdf',
      'offerte.pdf',
      'bijlage.pdf',
    ]);

    const result = await readDownload(page, nl.merge.download);
    expect(result.name).toBe('voorwaarden (samengevoegd).pdf');
    expect(result.widths).toEqual([700, 710, 720, 300, 310, 500]);
  });

  test('Escape of ver buiten de lijst loslaten breekt het slepen af', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Op een telefoon sleep je aan het greepje (aparte test)');
    await openMerge(page);
    await showList(page);
    const start = await point(page, 2, 'handle');
    const over = await point(page, 0, 'top');
    const marker = list(page).locator(
      '.merge-list__item--drop-before, .merge-list__item--drop-after',
    );
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(over.x, over.y, { steps: 8 });
    await expect(marker).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(marker).toHaveCount(0);
    await page.mouse.up();

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(over.x, over.y, { steps: 8 });
    // Ver naar rechts, buiten de lijst: het streepje verdwijnt en er gebeurt niets.
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width - 2, over.y, { steps: 8 });
    await expect(marker).toHaveCount(0);
    await page.mouse.up();
    expect(await names(page)).toEqual(['offerte.pdf', 'bijlage.pdf', 'voorwaarden.pdf']);
    await expect(page.getByRole('button', { name: nl.pages.undo })).toBeDisabled();
  });

  test('op een telefoon sleep je een bestand aan het greepje', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Aanraken: alleen op de telefoon');
    await openMerge(page);
    const handle = list(page).locator('.drag-handle').first();
    await expect(handle).toBeVisible();
    expect(await handle.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');

    await touchDragTo(page, 2, 0, 'top');
    await expect(list(page).locator('.merge-list__name')).toHaveText([
      'voorwaarden.pdf',
      'offerte.pdf',
      'bijlage.pdf',
    ]);
  });

  test('per bestand pagina’s kiezen met een bereik', async ({ page }) => {
    await openMerge(page);
    const field = page.getByLabel('Pagina’s kiezen uit voorwaarden.pdf');
    await expect(field).toHaveValue('1-3');
    await field.fill('3, 1');
    await field.press('Enter');
    await expect(field).toHaveValue('1, 3');
    await expect(list(page).getByRole('listitem').nth(2)).toContainText('2 van 3 pagina’s');

    // Een pagina die niet bestaat: een melding, en er verandert niets.
    const other = page.getByLabel('Pagina’s kiezen uit offerte.pdf');
    await other.fill('2-4');
    await other.press('Enter');
    await expect(page.getByRole('alert')).toHaveText(
      'Pagina 4 bestaat niet: dit bestand heeft 2 pagina’s.',
    );
    await other.press('Escape');

    const result = await readDownload(page, nl.merge.download);
    expect(result.widths).toEqual([300, 310, 500, 700, 720]);
  });

  test('per bestand pagina’s kiezen met vinkjes bij de miniaturen', async ({ page }) => {
    await openMerge(page);
    await page.getByRole('button', { name: `${nl.merge.showPages}: offerte.pdf` }).click();
    const group = page.getByRole('group', { name: 'Miniaturen van offerte.pdf' });
    await expect(group.getByRole('checkbox')).toHaveCount(2);
    await group.getByRole('checkbox').nth(1).uncheck();
    await expect(page.getByLabel('Pagina’s kiezen uit offerte.pdf')).toHaveValue('1');
    // De laatste pagina van een bestand blijft staan.
    await expect(group.getByRole('checkbox').first()).toBeDisabled();

    const result = await readDownload(page, nl.merge.download);
    expect(result.widths).toEqual([300, 500, 700, 710, 720]);
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
      // Ook de uitgeklapte miniaturen met vinkjes en een foutmelding bij het bereik.
      await page.getByRole('button', { name: `${nl.merge.showPages}: bijlage.pdf` }).click();
      const field = page.getByLabel('Pagina’s kiezen uit offerte.pdf');
      await field.fill('x');
      await field.press('Enter');
      await expect(page.getByRole('alert')).toBeVisible();
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
