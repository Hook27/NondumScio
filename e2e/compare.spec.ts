import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { messages, openPage, type Theme } from './helpers';

/**
 * PDF's vergelijken (Geavanceerd, alleen op de computer): een origineel (A) en een nieuwe versie (B)
 * openen en de tekstverschillen zien. De PDF's worden hier gemaakt en in de browser door pdf.js
 * gelezen, zoals bij een echte PDF.
 */

const nl = messages.nl;
const c = nl.compare;

/**
 * Een huurovereenkomst: per pagina een kop, alinea's (elk over twee regels, met een witregel
 * ertussen) en een voet met het paginanummer. `scan` voegt een pagina zonder tekstlaag toe.
 */
async function contract(pages: string[][], { scan = false } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((paragraphs, index) => {
    const page = doc.addPage([595, 842]);
    page.drawText('Huurovereenkomst Voorbeeldstraat 1', { x: 60, y: 800, size: 10, font });
    let y = 740;
    for (const paragraph of paragraphs) {
      const words = paragraph.split(' ');
      const half = Math.ceil(words.length / 2);
      for (const line of [words.slice(0, half).join(' '), words.slice(half).join(' ')]) {
        if (!line) continue;
        page.drawText(line, { x: 60, y, size: 11, font });
        y -= 14;
      }
      y -= 16;
    }
    page.drawText(`Pagina ${index + 1} van ${pages.length}`, { x: 260, y: 40, size: 9, font });
  });
  if (scan) {
    // Alleen een vlak, geen tekst: zoals een gescande pagina.
    doc.addPage([595, 842]).drawRectangle({
      x: 60,
      y: 400,
      width: 300,
      height: 200,
      color: rgb(0.6, 0.6, 0.6),
    });
  }
  return Buffer.from(await doc.save());
}

const OLD = [
  [
    'Partijen komen het volgende overeen.',
    'De woning ligt aan de Voorbeeldstraat.',
    'Deze overeenkomst gaat in op 1 januari 2026.',
    'De huur bedraagt 500 euro per maand.',
    'De huurder betaalt ook de servicekosten.',
  ],
  ['De opzegtermijn is een maand.', 'Huisdieren zijn niet toegestaan.'],
];

const NEW = [
  [
    'Partijen komen het volgende overeen.',
    'De woning ligt aan de Voorbeeldstraat.',
    'Deze overeenkomst gaat in op 1 januari 2026.',
    'De huur bedraagt 550 euro per maand.',
  ],
  [
    'De opzegtermijn is een maand.',
    'Huisdieren zijn niet toegestaan.',
    'De woning wordt schoon opgeleverd.',
  ],
];

const file = async (name: string, pages: string[][], options?: { scan?: boolean }) => ({
  name,
  mimeType: 'application/pdf',
  buffer: await contract(pages, options),
});

const slot = (page: Page, side: 'a' | 'b') =>
  page.locator('section.compare-slot').filter({
    has: page.getByRole('heading', { name: c.sides[side].title }),
  });

test.describe('PDF’s vergelijken', () => {
  test.skip(({ isMobile }) => isMobile, 'Geavanceerd is er alleen op de computer');

  test('staat bij Geavanceerd', async ({ page }) => {
    await openPage(page, '/#/advanced', { lang: 'nl' });
    await page.getByRole('link', { name: new RegExp(nl.advanced.tools.compare.title) }).click();
    await expect(page).toHaveURL(/#\/advanced\/compare$/);
    await expect(
      page.getByRole('heading', { level: 1, name: nl.advanced.tools.compare.title }),
    ).toBeVisible();
    await expect(page.getByText(c.placeholder)).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as Theme[]) {
    test(`toont de tekstverschillen van twee versies (thema ${theme})`, async ({ page }) => {
      await openPage(page, '/#/advanced/compare', { lang: 'nl', theme });
      // Twee tegelijk: de eerste wordt A, de tweede B.
      await page
        .locator('#compare-file-a')
        .setInputFiles([await file('huur-oud.pdf', OLD), await file('huur-nieuw.pdf', NEW)]);

      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader', { name: 'A · huur-oud.pdf' })).toBeVisible();
      await expect(table.getByRole('columnheader', { name: 'B · huur-nieuw.pdf' })).toBeVisible();
      await expect(page.getByText('1 toegevoegd')).toBeVisible();
      await expect(page.getByText('1 verwijderd')).toBeVisible();
      await expect(page.getByText('1 gewijzigd')).toBeVisible();
      await expect(
        page.getByText('A: 2 pagina’s, 7 alinea’s · B: 2 pagina’s, 7 alinea’s'),
      ).toBeVisible();

      // Binnen de gewijzigde alinea alleen het bedrag gemarkeerd.
      await expect(table.locator('del')).toHaveText('500');
      await expect(table.locator('ins')).toHaveText('550');
      await expect(table.getByText('De huurder betaalt ook de servicekosten.')).toBeVisible();
      // De nieuwe alinea staat op pagina 2.
      const added = table.locator('tr', { hasText: 'De woning wordt schoon opgeleverd.' });
      await expect(added).toHaveClass(/compare-diff__row--added/);
      await expect(added.getByText('p2', { exact: true })).toBeVisible();
      // Kop en voet komen op elke pagina terug en tellen niet mee.
      await expect(table.getByText('Huurovereenkomst')).toHaveCount(0);
      await expect(table.getByText(/Pagina \d van 2/)).toHaveCount(0);

      // Een klein plaatje van de eerste pagina, en wat er gelezen is.
      const thumb = slot(page, 'a').locator('img.compare-slot__thumb');
      await expect(thumb).toBeVisible();
      expect(await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      await expect(slot(page, 'a').getByText(/^2 pagina’s · .* tekens$/)).toBeVisible();

      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(result.violations).toEqual([]);

      // De twee gelijke alinea's bovenaan zijn ingeklapt; met een klik komen ze erbij.
      await expect(table.getByText('Partijen komen het volgende overeen.')).toHaveCount(0);
      await table.getByRole('button', { name: '2 ongewijzigde alinea’s tonen' }).click();
      await expect(table.getByText('Partijen komen het volgende overeen.')).toHaveCount(2);
      await expect(table.locator('tr', { hasText: 'Partijen komen' })).toBeFocused();
    });
  }

  test('omwisselen, een pagina zonder tekstlaag en geen verschillen', async ({ page }) => {
    await openPage(page, '/#/advanced/compare', { lang: 'nl' });
    await page
      .locator('#compare-file-a')
      .setInputFiles(await file('scan.pdf', OLD, { scan: true }));
    await expect(page.getByText('Kies nog PDF B om te vergelijken.')).toBeVisible();
    await expect(slot(page, 'a').getByText(/· 1 pagina zonder tekstlaag$/)).toBeVisible();
    await page.locator('#compare-file-b').setInputFiles(await file('kopie.pdf', OLD));

    await expect(page.getByText(c.noDiff)).toBeVisible();
    await expect(page.getByText(/^Pagina’s zonder tekstlaag: 1 van 3 in A\./)).toBeVisible();

    await page.getByRole('button', { name: c.swap }).click();
    await expect(page.getByText(/^Pagina’s zonder tekstlaag: 1 van 3 in B\./)).toBeVisible();
    await expect(slot(page, 'a').getByText('kopie.pdf')).toBeVisible();

    await page.getByRole('button', { name: c.clear }).click();
    await expect(page.getByText(c.placeholder)).toBeVisible();
  });
});
