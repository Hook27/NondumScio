import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { format } from '../src/i18n/format';
import { messages, openPage, type Theme } from './helpers';

/**
 * PDF's vergelijken (Geavanceerd, alleen op de computer): een origineel (A) en een nieuwe versie (B)
 * openen en de tekstverschillen zien. De PDF's worden hier gemaakt en in de browser door pdf.js
 * gelezen, zoals bij een echte PDF.
 */

/**
 * Openen en tekenen met pdf.js kan onder belasting (alle tests tegelijk) even duren: de eerste
 * controle daarna wacht langer, zoals in de andere specs (OPEN_TIMEOUT).
 */
const SLOW = { timeout: 15_000 };

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

/** Een PDF met eigen gegevens (metadata) en paginaformaten, met op elke pagina één regel tekst. */
async function profiled(
  name: string,
  meta: { author?: string; modified: Date },
  sizes: [number, number][],
) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle('Huurovereenkomst');
  if (meta.author) doc.setAuthor(meta.author);
  doc.setCreator('Tekstverwerker');
  doc.setProducer('Testprinter');
  doc.setCreationDate(new Date(Date.UTC(2026, 0, 1, 12, 0)));
  doc.setModificationDate(meta.modified);
  for (const [width, height] of sizes) {
    const page = doc.addPage([width, height]);
    page.drawText('Een regel tekst op deze pagina.', { x: 60, y: height - 80, size: 11, font });
  }
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

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
      await expect(table.getByRole('columnheader', { name: 'A · huur-oud.pdf' })).toBeVisible(SLOW);
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
    await expect(page.getByText('Kies nog PDF B om te vergelijken.')).toBeVisible(SLOW);
    await expect(slot(page, 'a').getByText(/· 1 pagina zonder tekstlaag$/)).toBeVisible();
    await page.locator('#compare-file-b').setInputFiles(await file('kopie.pdf', OLD));

    await expect(page.getByText(c.noDiff)).toBeVisible(SLOW);
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
    await expect(both('3 alinea’s')).toBeVisible(SLOW);
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
    await expect(both('3 alinea’s')).toBeVisible(SLOW);

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

test.describe('PDF’s vergelijken: documentprofiel', () => {
  test.skip(({ isMobile }) => isMobile, 'Geavanceerd is er alleen op de computer');

  for (const theme of ['light', 'dark'] as Theme[]) {
    test(`zet de gegevens van A en B naast elkaar, en per pagina (thema ${theme})`, async ({
      page,
    }) => {
      const p = c.profile;
      await openPage(page, '/#/advanced/compare', { lang: 'nl', theme });
      await page.locator('#compare-file-a').setInputFiles([
        await profiled(
          'contract-a.pdf',
          { author: 'Jansen', modified: new Date(Date.UTC(2026, 0, 2, 12, 0)) },
          [
            [595, 842],
            [595, 842],
          ],
        ),
        await profiled('contract-b.pdf', { modified: new Date(Date.UTC(2026, 2, 1, 9, 30)) }, [
          [595, 842],
          [842, 595],
          [595, 842],
        ]),
      ]);
      await expect(page.getByRole('table')).toBeVisible(SLOW);
      await page.getByRole('button', { name: c.tabs.profile }).click();
      await expect(page.getByRole('heading', { name: p.title })).toBeVisible();
      // De instellingen horen bij de tekst.
      await expect(page.getByRole('group', { name: c.settings.title })).toHaveCount(0);

      const fields = page.getByRole('table', { name: p.fieldsCaption });
      const row = (field: string) => fields.getByRole('row').filter({ hasText: field });
      await expect(row(p.fields.title)).toContainText('Huurovereenkomst');
      await expect(row(p.fields.title)).not.toHaveClass(/compare-profile__differs/);
      await expect(row(p.fields.author)).toHaveClass(/compare-profile__differs/);
      await expect(row(p.fields.author)).toContainText('Jansen');
      await expect(row(p.fields.author)).toContainText(p.empty);
      await expect(row(p.fields.created)).toContainText('1 januari 2026, 12:00');
      await expect(row(p.fields.created)).not.toHaveClass(/compare-profile__differs/);
      await expect(row(p.fields.modified)).toContainText('2 januari 2026, 12:00');
      await expect(row(p.fields.modified)).toContainText('1 maart 2026, 09:30');
      await expect(row(p.fields.sizes)).toContainText('595×842 pt (2), 842×595 pt (1)');
      await expect(row(p.fields.creator)).toContainText('Tekstverwerker');
      await expect(row(p.fields.producer)).toContainText('Testprinter');
      // Naam, grootte, pagina's, formaten, auteur, gewijzigd en tekens.
      await expect(page.getByText('7 van 16 velden wijken af')).toBeVisible();

      const pages = page.getByRole('table', { name: p.pagesCaption });
      await expect(pages.getByRole('row')).toHaveCount(4);
      await expect(pages.getByRole('row').nth(2)).toContainText(p.notes.size);
      await expect(pages.getByRole('row').nth(3)).toContainText(p.notes.onlyB);

      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(result.violations).toEqual([]);
    });
  }
});

/** Telt in het getekende pixelverschil de rode (alleen in A) en groene (alleen in B) pixels. */
function countColours(page: Page) {
  return page.locator('canvas.compare-visual__canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0;
    let green = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! > 200 && data[i + 1]! < 100) red++;
      if (data[i + 1]! > 200 && data[i]! < 100) green++;
    }
    return { red, green };
  });
}

test.describe('PDF’s vergelijken: beeld', () => {
  test.skip(({ isMobile }) => isMobile, 'Geavanceerd is er alleen op de computer');

  for (const theme of ['light', 'dark'] as Theme[]) {
    test(`tekent het verschil, naast elkaar en als overlay (thema ${theme})`, async ({ page }) => {
      const v = c.visual;
      await openPage(page, '/#/advanced/compare', { lang: 'nl', theme });
      await page
        .locator('#compare-file-a')
        .setInputFiles([await file('huur-oud.pdf', OLD), await file('huur-nieuw.pdf', NEW)]);
      await expect(page.getByRole('table')).toBeVisible(SLOW);
      await page.getByRole('button', { name: c.tabs.visual }).click();

      // Het pixelverschil: rood voor de alinea die alleen in A staat, groen voor "550".
      const stat = page.locator('.compare-visual__stat');
      await expect(stat).toHaveText(/^Verschil: \d+,\d\d% van de pagina · /, SLOW);
      await expect(stat).not.toHaveText(/^Verschil: 0,00%/);
      await expect(
        page.getByRole('img', { name: format(v.labels.diff, { a: 1, b: 1 }) }),
      ).toBeVisible();
      const colours = await countColours(page);
      expect(colours.red).toBeGreaterThan(100);
      expect(colours.green).toBeGreaterThan(0);
      expect(colours.red).toBeGreaterThan(colours.green);

      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(result.violations).toEqual([]);

      const modes = page.getByRole('group', { name: v.modes.label });
      await modes.getByRole('button', { name: v.modes.side }).click();
      await expect(stat).toHaveText(/^A: \d+×\d+ px · B: \d+×\d+ px$/, SLOW);
      await expect(page.locator('.compare-visual__side canvas')).toHaveCount(2);
      await modes.getByRole('button', { name: v.modes.overlay }).click();
      await expect(stat).toHaveText('Overlay: B voor 50% over A', SLOW);
      await modes.getByRole('button', { name: v.modes.diff }).click();
      await expect(stat).toHaveText(/^Verschil: /, SLOW);

      // Bladeren met de toetsen, en B verschuiven tot voorbij het einde.
      await page.getByRole('heading', { name: v.title }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByText('A: pagina 2 · B: pagina 2')).toBeVisible();
      await expect(stat).toHaveText(/^Verschil: /, SLOW);
      await page.getByRole('spinbutton', { name: v.offset }).fill('1');
      await page.getByRole('spinbutton', { name: v.offset }).press('Tab');
      await expect(page.getByText('Pagina 3 bestaat niet in B (B heeft 2 pagina’s).')).toBeVisible(
        SLOW,
      );
      await page.getByRole('spinbutton', { name: v.offset }).fill('0');
      await page.getByRole('spinbutton', { name: v.offset }).press('Tab');
      await expect(stat).toHaveText(/^Verschil: /, SLOW);

      // Inzoomen tekent groter (en scherp: opnieuw door pdf.js), passend weer kleiner.
      const canvas = page.locator('canvas.compare-visual__canvas');
      // Tijdens het vervangen door een nieuw getekend canvas is er heel even geen maat.
      const width = async () => (await canvas.boundingBox())?.width ?? Number.NaN;
      const before = await width();
      await page.getByRole('button', { name: v.zoomIn }).click();
      await expect(page.getByText('125%')).toBeVisible();
      await expect.poll(width, SLOW).toBeGreaterThan(before * 1.2);
      await page.getByRole('button', { name: v.fit }).click();
      await expect.poll(width, SLOW).toBeLessThan(before + 2);
    });
  }

  test('twee gelijke PDF’s: geen verschil in beeld', async ({ page }) => {
    await openPage(page, '/#/advanced/compare', { lang: 'nl' });
    await page
      .locator('#compare-file-a')
      .setInputFiles([await file('kopie-1.pdf', OLD), await file('kopie-2.pdf', OLD)]);
    await expect(page.getByText(c.noDiff)).toBeVisible(SLOW);
    await page.getByRole('button', { name: c.tabs.visual }).click();
    await expect(page.locator('.compare-visual__stat')).toHaveText(
      /^Verschil: 0,00% van de pagina · 0,0% van de inkt · 0 px$/,
      SLOW,
    );
    expect(await countColours(page)).toEqual({ red: 0, green: 0 });
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
      await expect(slot(page, side).locator('img.compare-slot__thumb')).toBeVisible(SLOW);
      expect(await lines(slot(page, side).getByText(c.sides[side].replace)), side).toBe(1);
    }
    // De keuze naast elkaar of onder elkaar, in de kop van het rechtervak.
    for (const name of [c.views.split, c.views.unified]) {
      expect(await lines(page.getByRole('button', { name })), name).toBe(1);
    }
    // Bij het beeld: verschil, naast elkaar of overlay.
    await page.getByRole('button', { name: c.tabs.visual }).click();
    const modes = page.getByRole('group', { name: c.visual.modes.label });
    for (const name of [c.visual.modes.diff, c.visual.modes.side, c.visual.modes.overlay]) {
      expect(await lines(modes.getByRole('button', { name })), name).toBe(1);
    }
  });
});
