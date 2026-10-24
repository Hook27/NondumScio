import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { makeSizedPdf } from './fixtures';
import { downloadVia, messages, openPage } from './helpers';

const nl = messages.nl;
const options = (page: Page) => page.getByRole('option');
const toolbarButton = (page: Page, name: string) =>
  page.getByRole('toolbar', { name: nl.pages.toolbar }).getByRole('button', { name });

/** Welke pagina van het origineel (1, 2, …) op elke plek staat. */
const order = (page: Page) =>
  options(page).evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-source'))));

async function openPages(page: Page, widths = [300, 400, 500, 600]) {
  await openPage(page, '/#/pages', { lang: 'nl' });
  await page.locator('input[type="file"]').setInputFiles({
    name: 'vier.pdf',
    mimeType: 'application/pdf',
    buffer: await makeSizedPdf(widths),
  });
  await expect(options(page)).toHaveCount(widths.length);
  // Wacht tot alle miniaturen getekend zijn: daarvoor veranderen ze nog van formaat,
  // en zou een sleepbeweging op de verkeerde plek eindigen.
  await expect(page.locator('.page-option .thumb[data-rendered="true"]')).toHaveCount(
    widths.length,
  );
}

/** Klikt een downloadknop en leest de gedownloade PDF terug: naam en breedte per pagina. */
async function download(page: Page, name: string) {
  const file = await downloadVia(page, toolbarButton(page, name));
  const doc = await PDFDocument.load(readFileSync(await file.path()));
  return { name: file.suggestedFilename(), widths: doc.getPages().map((p) => p.getWidth()) };
}

/**
 * Een punt bovenin een miniatuur dat zeker in beeld is. Miniaturen zijn hoog en staan
 * soms deels onder het scherm; daarom eerst in beeld scrollen en bovenin pakken.
 */
async function grabPoint(page: Page, index: number, side: 'left' | 'middle' | 'right') {
  await options(page).nth(index).scrollIntoViewIfNeeded();
  const box = (await options(page).nth(index).boundingBox())!;
  const x = { left: 0.2, middle: 0.5, right: 0.8 }[side];
  return { x: box.x + box.width * x, y: box.y + Math.min(box.height / 3, 100) };
}

/** Sleept met de muis een miniatuur naar de linker- of rechterkant van een andere. */
async function dragTo(page: Page, from: number, to: number, side: 'left' | 'right') {
  // Alle miniaturen staan in deze tests op één rij: één keer in beeld scrollen is genoeg.
  const start = await grabPoint(page, from, 'middle');
  const end = await grabPoint(page, to, side);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

test.describe('pagina’s verplaatsen en uitpakken', () => {
  test('met de knoppen naar voren en naar achteren, en dat komt in de download', async ({
    page,
  }) => {
    await openPages(page);
    await options(page).nth(3).click();
    await toolbarButton(page, nl.pages.moveEarlier).click();
    await toolbarButton(page, nl.pages.moveEarlier).click();
    expect(await order(page)).toEqual([1, 4, 2, 3]);

    await toolbarButton(page, nl.pages.moveLater).click();
    expect(await order(page)).toEqual([1, 2, 4, 3]);

    const result = await download(page, nl.pages.save);
    expect(result.name).toBe('vier (bewerkt).pdf');
    expect(result.widths).toEqual([300, 400, 600, 500]);
  });

  test('met Alt + pijltjes, en de focus blijft bij de pagina', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Toetsenbordbediening is op een telefoon niet relevant');
    await openPages(page);
    await options(page).nth(0).click();
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Alt+ArrowRight');
    expect(await order(page)).toEqual([2, 3, 1, 4]);
    await expect(options(page).nth(2)).toBeFocused();
    await page.keyboard.press('Alt+ArrowLeft');
    expect(await order(page)).toEqual([2, 1, 3, 4]);
  });

  test('door te slepen met de muis', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Op een telefoon sleep je aan het greepje (met de vinger)');
    await openPages(page);
    await dragTo(page, 0, 3, 'right');
    expect(await order(page)).toEqual([2, 3, 4, 1]);
    await dragTo(page, 3, 1, 'left');
    expect(await order(page)).toEqual([2, 1, 3, 4]);

    // Slepen is één stap voor ongedaan maken.
    await page.keyboard.press('Control+z');
    expect(await order(page)).toEqual([2, 3, 4, 1]);
  });

  test('meerdere gekozen pagina’s in één keer slepen', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Op een telefoon sleep je aan het greepje (met de vinger)');
    await openPages(page, [300, 400, 500, 600, 700]);
    await options(page).nth(1).click();
    await options(page)
      .nth(3)
      .click({ modifiers: ['Control'] });
    await dragTo(page, 3, 0, 'left');
    expect(await order(page)).toEqual([2, 4, 1, 3, 5]);

    const result = await download(page, nl.pages.save);
    expect(result.widths).toEqual([400, 600, 300, 500, 700]);
  });

  test('loslaten ver buiten de miniaturen of Escape breekt het slepen af', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Op een telefoon sleep je aan het greepje (met de vinger)');
    await openPages(page);
    const start = await grabPoint(page, 0, 'middle');
    const over = await grabPoint(page, 2, 'right');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(over.x, over.y, { steps: 8 });
    await expect(page.locator('.page-option--drop-before, .page-option--drop-after')).toHaveCount(
      1,
    );
    // Ver naar boven, buiten de miniaturen: het streepje verdwijnt en er gebeurt niets.
    await page.mouse.move(over.x, 2, { steps: 8 });
    await expect(page.locator('.page-option--drop-before, .page-option--drop-after')).toHaveCount(
      0,
    );
    await page.mouse.up();
    expect(await order(page)).toEqual([1, 2, 3, 4]);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(over.x, over.y, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await order(page)).toEqual([1, 2, 3, 4]);
  });

  test('een klik zonder te slepen kiest gewoon de pagina', async ({ page }) => {
    await openPages(page);
    await options(page).nth(2).click();
    await expect(options(page).nth(2)).toHaveAttribute('aria-selected', 'true');
    expect(await order(page)).toEqual([1, 2, 3, 4]);
  });

  test('uitpakken downloadt alleen de gekozen pagina’s en laat het document zoals het is', async ({
    page,
  }) => {
    await openPages(page);
    await options(page).nth(0).click();
    await options(page)
      .nth(2)
      .click({ modifiers: ['Control'] });
    await options(page)
      .nth(3)
      .click({ modifiers: ['Control'] });

    const result = await download(page, nl.pages.extract);
    expect(result.name).toBe("vier (pagina's 1, 3-4).pdf");
    expect(result.widths).toEqual([300, 500, 600]);
    await expect(options(page)).toHaveCount(4);
    await expect(page.locator('.page-editor__status')).not.toContainText(nl.pages.unsaved);
  });

  test('met de vinkjes meer pagina’s kiezen en uitpakken, ook op een telefoon', async ({
    page,
    isMobile,
  }) => {
    await openPages(page);
    for (const index of [1, 3]) {
      const box = options(page).nth(index).locator('.select-box');
      // Op een telefoon tikken, met de muis klikken.
      if (isMobile) await box.tap();
      else await box.click();
    }
    await expect(page.locator('.page-editor__status')).toContainText('2 van 4 gekozen');

    const result = await download(page, nl.pages.extract);
    expect(result.name).toBe("vier (pagina's 2, 4).pdf");
    expect(result.widths).toEqual([400, 600]);
  });

  test('op een telefoon is er per pagina een greepje om te slepen', async ({ page }) => {
    await openPages(page, [300, 400]);
    const handle = page.locator('.drag-handle').first();
    await expect(handle).toBeVisible();
    // Alleen het greepje vangt de vinger op; de rest van de pagina scrollt gewoon.
    expect(await handle.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
    expect(
      await options(page)
        .first()
        .evaluate((el) => getComputedStyle(el).touchAction),
    ).not.toBe('none');
  });
});
