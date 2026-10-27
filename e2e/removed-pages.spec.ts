import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { makeSizedPdf } from './fixtures';
import { downloadVia, messages, openPage } from './helpers';
import { leaks, linkTargets, textOf } from './redact-helpers';

/**
 * Weggehaalde pagina's zijn echt weg, ook als een koppeling (zoals in een inhoudsopgave) ernaar
 * wees. Koppelingen naar pagina's die blijven, wijzen naar hun nieuwe plek.
 */

const nl = messages.nl;
const SECRET = 'GEHEIM-4711';

/** Vier pagina's: een inhoudsopgave met koppelingen naar 2, 3 en 4; pagina 2 heeft het geheim. */
async function makeContentsPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const texts = ['Inhoud', `Het wachtwoord is ${SECRET}`, 'Hoofdstuk drie', 'Hoofdstuk vier'];
  const pages = texts.map((text) => {
    const page = doc.addPage([595, 842]);
    page.drawText(text, { x: 60, y: 760, size: 22, font });
    return page;
  });
  const links = pages.slice(1).map((target, i) =>
    doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [60, 700 - i * 40, 300, 730 - i * 40],
        Border: [0, 0, 0],
        Dest: [target.ref, 'Fit'],
      }),
    ),
  );
  pages[0]!.node.set(PDFName.of('Annots'), doc.context.obj(links));
  return Buffer.from(await doc.save());
}

const options = (page: Page) => page.getByRole('option');

test.describe('weggehaalde pagina’s zijn echt weg', () => {
  test('Pagina’s: een koppeling naar de weggehaalde pagina houdt die niet vast', async ({
    page,
  }) => {
    const source = await makeContentsPdf();
    // Controle op de controle: in het origineel staat het geheim, met drie koppelingen.
    expect(await leaks(source, SECRET)).toBe(true);
    expect(await linkTargets(source)).toEqual([2, 3, 4]);

    await openPage(page, '/#/pages', { lang: 'nl' });
    await page.locator('input[type="file"]').setInputFiles({
      name: 'inhoud.pdf',
      mimeType: 'application/pdf',
      buffer: source,
    });
    await expect(options(page)).toHaveCount(4);
    await options(page).nth(1).click();
    await page
      .getByRole('toolbar', { name: nl.pages.toolbar })
      .getByRole('button', { name: nl.pages.remove })
      .click();
    await expect(options(page)).toHaveCount(3);

    const file = await downloadVia(
      page,
      page
        .getByRole('toolbar', { name: nl.pages.toolbar })
        .getByRole('button', { name: nl.pages.save }),
    );
    const result = readFileSync((await file.path())!);
    expect(await leaks(result, SECRET)).toBe(false);
    expect(await leaks(result, 'wachtwoord')).toBe(false);
    // De koppeling naar de weggehaalde pagina is weg; de andere wijzen naar de nieuwe plekken.
    expect(await linkTargets(result)).toEqual([2, 3]);
    expect(await textOf(result)).toEqual(['Inhoud', 'Hoofdstuk drie', 'Hoofdstuk vier']);
  });

  test('Samenvoegen: een koppeling naar een pagina die niet meedoet, haalt die niet mee', async ({
    page,
  }) => {
    await openPage(page, '/#/merge', { lang: 'nl' });
    await page.locator('#pdf-file').setInputFiles([
      { name: 'voorblad.pdf', mimeType: 'application/pdf', buffer: await makeSizedPdf([500]) },
      { name: 'inhoud.pdf', mimeType: 'application/pdf', buffer: await makeContentsPdf() },
    ]);
    const field = page.getByLabel('Pagina’s kiezen uit inhoud.pdf');
    await expect(field).toHaveValue('1-4', { timeout: 15_000 });
    await field.fill('1, 3-4');
    await field.press('Enter');
    await expect(field).toHaveValue('1, 3-4');

    const file = await downloadVia(page, page.getByRole('button', { name: nl.merge.download }));
    const result = readFileSync((await file.path())!);
    expect(await leaks(result, SECRET)).toBe(false);
    expect(await textOf(result)).toHaveLength(4);
    // De inhoudsopgave staat nu op pagina 2; zijn koppelingen wijzen naar 3 en 4.
    expect(await linkTargets(result, 2)).toEqual([3, 4]);
  });
});
