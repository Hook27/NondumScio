import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
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

/**
 * Een brief zoals Word hem als PDF opslaat: 11 pt, regelafstand 14,5 pt en 8 pt witruimte na elke
 * alinea (22,4 pt tussen alinea's), gemeten in een echte PDF uit Word.
 */
async function wordLetter(name: string, paragraphs: string[][]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  let y = 760;
  for (const lines of paragraphs) {
    for (const line of lines) {
      page.drawText(line, { x: 71, y, size: 11, font });
      y -= 14.5;
    }
    y -= 22.4 - 14.5;
  }
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

const WORD_A = [
  ['Dit is de eerste alinea. Hij loopt over', 'twee regels en stopt hier.'],
  ['De tweede alinea staat eronder, met', 'een witregel van 8 pt ertussen.'],
  ['De derde alinea.'],
];
const WORD_B = [WORD_A[0]!, [WORD_A[1]![0]!, 'een witregel van 6 pt ertussen.'], WORD_A[2]!];

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

      // Onder elkaar: één kolom; het gewijzigde bedrag als − (A) boven + (B).
      await page.getByRole('button', { name: c.views.unified }).click();
      await expect(table.getByRole('columnheader')).toHaveText([
        'A · huur-oud.pdf → B · huur-nieuw.pdf',
      ]);
      const minus = table.locator('tr', { has: page.locator('del') });
      const plus = table.locator('tr', { has: page.locator('ins') });
      await expect(minus.locator('.compare-diff__sign')).toHaveText('−');
      await expect(plus.locator('.compare-diff__sign')).toHaveText('+');
      await expect(minus.locator('del')).toHaveText('500');
      await expect(plus.locator('ins')).toHaveText('550');
      const unified = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(unified.violations).toEqual([]);
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

test.describe('PDF’s vergelijken: instellingen', () => {
  test.skip(({ isMobile }) => isMobile, 'Geavanceerd is er alleen op de computer');

  test('herkent de alinea’s van Word, en elke instelling werkt meteen', async ({ page }) => {
    const s = c.settings;
    await openPage(page, '/#/advanced/compare', { lang: 'nl' });
    await page
      .locator('#compare-file-a')
      .setInputFiles([
        await wordLetter('brief-a.pdf', WORD_A),
        await wordLetter('brief-b.pdf', WORD_B),
      ]);
    const both = (units: string) => page.getByText(`A: 1 pagina, ${units} · B: 1 pagina, ${units}`);
    await expect(both('3 alinea’s')).toBeVisible();
    // Alleen de tweede alinea is gewijzigd, met alleen het getal gemarkeerd.
    await expect(page.getByText('1 gewijzigd')).toBeVisible();
    await expect(page.getByRole('table').locator('del')).toHaveText('8');

    const settings = page.getByRole('group', { name: s.title });
    const slider = settings.getByRole('slider', { name: s.gap });
    await expect(settings.getByText('1,3')).toBeVisible();
    // Met de drempel van de losse pdf-vergelijker (en hoger) wordt de pagina één alinea.
    await slider.focus();
    await page.keyboard.press('End');
    await expect(settings.getByText('2,5')).toBeVisible();
    await expect(both('1 alinea')).toBeVisible();
    await page.keyboard.press('Home');
    await expect(settings.getByText('1,1')).toBeVisible();
    await expect(both('3 alinea’s')).toBeVisible();

    await settings.getByRole('button', { name: c.levels.sentence.label }).click();
    await expect(both('4 zinnen')).toBeVisible();
    await settings.getByRole('button', { name: c.levels.line.label }).click();
    await expect(both('5 regels')).toBeVisible();
    await expect(slider).toBeDisabled();

    // Alles tonen: ook de ongewijzigde regels, zonder inklapknop.
    await expect(page.getByRole('table').getByRole('button')).toHaveCount(1);
    await settings.getByRole('checkbox', { name: s.onlyDiff }).uncheck();
    await expect(page.getByRole('table').getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('table').getByText('twee regels en stopt hier.')).toHaveCount(2);

    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);
  });
});

test.describe('PDF’s vergelijken op een scherm met schaal 150 %', () => {
  test.skip(({ isMobile }) => isMobile, 'Geavanceerd is er alleen op de computer');
  // Zoals een laptop met Windows-schaal 150 %: de letters vallen daar net iets breder uit.
  test.use({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1.5 });

  test('de knoppen passen op één regel', async ({ page }) => {
    await openPage(page, '/#/advanced/compare', { lang: 'nl' });
    // Een gewone schuifbalk in het linkervak (17 px op Windows) kost breedte. De testbrowser toont
    // geen schuifbalken, dus die ruimte halen we hier zelf weg.
    await page.addStyleTag({ content: '.workspace__tools { padding-right: 23px !important; }' });
    await page
      .locator('#compare-file-a')
      .setInputFiles([await file('huur-oud.pdf', OLD), await file('huur-nieuw.pdf', NEW)]);
    // Het aantal regels van de tekst op een knop.
    const lines = (button: Locator) =>
      button.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      });
    for (const side of ['a', 'b'] as const) {
      // Pas met het plaatje van pagina 1 erbij staat het vak er helemaal.
      await expect(slot(page, side).locator('img.compare-slot__thumb')).toBeVisible();
      expect(await lines(slot(page, side).getByText(c.sides[side].replace)), side).toBe(1);
    }
    // De keuze naast elkaar of onder elkaar, in de kop van het rechtervak.
    for (const name of [c.views.split, c.views.unified]) {
      expect(await lines(page.getByRole('button', { name })), name).toBe(1);
    }
  });
});
