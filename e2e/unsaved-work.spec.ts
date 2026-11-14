import { expect, test, type Page } from '@playwright/test';
import { makeSizedPdf } from './fixtures';
import { messages, openPage, SLOW } from './helpers';

/**
 * Niets kwijt zonder waarschuwing: bij het sluiten van het tabblad met werk dat nog niet gedownload
 * is, en bij een bestand dat naast een sleepvak wordt losgelaten (dat opende de browser anders in
 * het tabblad).
 */

const nl = messages.nl;

/** Sluit het tabblad en geeft terug welk venster de browser toont (of null). */
async function closeTab(page: Page): Promise<string | null> {
  const dialog = new Promise<string | null>((resolve) => {
    page.once('dialog', (shown) => {
      resolve(shown.type());
      void shown.dismiss();
    });
    page.once('close', () => resolve(null));
  });
  await page.close({ runBeforeUnload: true });
  return dialog;
}

/** Laat een PDF los op het element dat `selector` vindt; geeft terug of de app dat opving. */
const dropPdf = (page: Page, selector: string) =>
  page.evaluate((target) => {
    const data = new DataTransfer();
    data.items.add(new File(['%PDF-1.7 los'], 'los.pdf', { type: 'application/pdf' }));
    const element = document.querySelector(target)!;
    const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data });
    element.dispatchEvent(over);
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data });
    element.dispatchEvent(drop);
    return { over: over.defaultPrevented, drop: drop.defaultPrevented };
  }, selector);

test.describe('niets kwijt zonder waarschuwing', () => {
  test.skip(({ isMobile }) => isMobile, 'Geavanceerd is er alleen op de computer');

  test('Platte tekst: een aangepaste tekst die nog niet gedownload is', async ({ page }) => {
    await openPage(page, '/#/advanced/text', { lang: 'nl' });
    await page.locator('#plaintext-file').setInputFiles({
      name: 'brief.pdf',
      mimeType: 'application/pdf',
      buffer: await makeSizedPdf([595]),
    });
    await page.getByRole('button', { name: nl.plainText.extract }).click();
    const output = page.locator('textarea.plaintext__output');
    await expect(output).toBeVisible({ timeout: 15_000 });
    await output.fill('Mijn eigen tekst.');
    expect(await closeTab(page)).toBe('beforeunload');
  });

  test('Triage: een besluit dat nog niet gedownload is', async ({ page }) => {
    await openPage(page, '/#/advanced/triage', { lang: 'nl' });
    await page.locator('#triage-files').setInputFiles([
      { name: 'a.pdf', mimeType: 'application/pdf', buffer: await makeSizedPdf([595]) },
      { name: 'b.pdf', mimeType: 'application/pdf', buffer: await makeSizedPdf([595]) },
    ]);
    await expect(page.getByRole('button', { name: nl.triage.keep })).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: nl.triage.keep }).click();
    expect(await closeTab(page)).toBe('beforeunload');
  });

  test('Triage zonder besluit: sluiten zonder vraag', async ({ page }) => {
    await openPage(page, '/#/advanced/triage', { lang: 'nl' });
    await page
      .locator('#triage-files')
      .setInputFiles([
        { name: 'a.pdf', mimeType: 'application/pdf', buffer: await makeSizedPdf([595]) },
      ]);
    await expect(page.getByRole('button', { name: nl.triage.keep })).toBeEnabled({
      timeout: 15_000,
    });
    expect(await closeTab(page)).toBeNull();
  });

  test('een PDF naast het sleepvak loslaten: tegengehouden; in het vak: geopend', async ({
    page,
  }) => {
    await openPage(page, '/#/advanced/compare', { lang: 'nl' });
    // Vergelijken wordt pas geladen als je het opent: eerst wachten tot het sleepvak er is (op een
    // drukke machine duurt dat even, en dan vond de test het vak nog niet).
    await expect(page.locator('.dropzone').first()).toBeVisible(SLOW);
    // Naast het sleepvak (de kop van de pagina): de app houdt het tegen.
    expect(await dropPdf(page, 'h1')).toEqual({ over: true, drop: true });
    // In het sleepvak van A: daar wordt het bestand gewoon opgevangen.
    expect(await dropPdf(page, '.dropzone')).toEqual({ over: true, drop: true });
    await expect(page.getByText('los.pdf').first()).toBeVisible(SLOW);
  });
});
