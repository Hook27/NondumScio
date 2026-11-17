import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { messages, openPdf, warningColor } from './helpers';

const nl = messages.nl;

async function report() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 1; p <= 3; p++) {
    doc.addPage([595, 842]).drawText(`Pagina ${p}`, { x: 60, y: 760, size: 24, font });
  }
  return {
    name: 'rapport.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  };
}

/**
 * Laat het opslaan hangen: het onderdeel met pdf-lib (dat pas bij het opslaan geladen wordt) komt
 * pas binnen als de test `release()` aanroept. Geeft ook terug of het opslaan daar echt op wachtte.
 */
async function holdSaving(page: Page) {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  let waited = false;
  await page.route('**/assets/es-*.js', async (route) => {
    waited = true;
    await gate;
    await route.continue();
  });
  return { release: () => release(), waited: () => waited };
}

/** Naar een andere taak, zoals via het menu (het document blijft open). */
const go = (page: Page, hash: string) => page.evaluate((to) => (location.hash = to), hash);

test('Pagina’s: weggaan tijdens het opslaan geeft geen download meer', async ({ page }) => {
  await openPdf(page, '/#/pages', await report(), { lang: 'nl' });
  const saving = await holdSaving(page);
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  await page.getByRole('button', { name: nl.pages.save, exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: nl.saveDialog.download, exact: true })
    .click();
  await expect(page.getByText(nl.pages.saving).first()).toBeVisible();
  await expect.poll(saving.waited).toBe(true);

  // Naar een andere taak terwijl het opslaan nog loopt; daarna mag het verder.
  await go(page, '#/merge');
  await expect(page.getByRole('button', { name: nl.merge.download })).toBeVisible();
  saving.release();
  await page.waitForTimeout(2000);
  expect(downloads).toEqual([]);

  // Terug, en opnieuw opslaan: dat werkt gewoon (één download).
  await go(page, '#/pages');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: nl.pages.save, exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: nl.saveDialog.download, exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe('rapport (bewerkt).pdf');
  expect(downloads).toEqual(['rapport (bewerkt).pdf']);
});

test('Pagina’s: Stoppen tijdens het opslaan, in de gewone kleur, zonder download', async ({
  page,
}) => {
  await openPdf(page, '/#/pages', await report(), { lang: 'nl' });
  const saving = await holdSaving(page);
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  await page.getByRole('button', { name: nl.pages.save, exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: nl.saveDialog.download, exact: true })
    .click();
  await expect.poll(saving.waited).toBe(true);
  await page.getByRole('button', { name: nl.pages.stop, exact: true }).click();
  await expect(page.getByText(nl.pages.stopping)).toBeVisible();
  saving.release();
  const stopped = page.getByText(nl.pages.stopped);
  await expect(stopped).toBeVisible();
  expect(await stopped.evaluate((el) => getComputedStyle(el).color)).not.toBe(
    await warningColor(page),
  );
  await page.waitForTimeout(1000);
  expect(downloads).toEqual([]);
});
