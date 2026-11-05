import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { format } from '../src/i18n/format';
import { messages, openPage, type Theme } from './helpers';

/**
 * PDF → Platte tekst (Geavanceerd, alleen op de computer): een PDF openen en de tekst eruit halen.
 * De PDF's worden hier gemaakt en in de browser door pdf.js gelezen, zoals bij een echte PDF.
 */

/** Openen met pdf.js kan onder belasting even duren: de eerste controle wacht langer. */
const SLOW = { timeout: 15_000 };

const nl = messages.nl;
const p = nl.plainText;
const s = p.settings;

/**
 * Een brief zoals Word hem als PDF opslaat: 11 pt, regelafstand 14,5 pt en 8 pt witruimte na elke
 * alinea (22,4 pt tussen alinea's), met op elke pagina een kop en een voet met het paginanummer.
 * `scan` voegt een pagina zonder tekstlaag toe.
 */
async function letter(name: string, pages: string[][][], { scan = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((paragraphs, index) => {
    const page = doc.addPage([595, 842]);
    page.drawText('Woningstichting Voorbeeld', { x: 71, y: 800, size: 9, font });
    let y = 740;
    for (const lines of paragraphs) {
      for (const line of lines) {
        page.drawText(line, { x: 71, y, size: 11, font });
        y -= 14.5;
      }
      y -= 22.4 - 14.5;
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
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

const PAGES = [
  [
    ['Geachte heer Jansen,'],
    ['Hierbij ontvangt u de nieuwe huurovereen-', 'komst voor de woning aan de Voorbeeldstraat.'],
    ['De huur bedraagt 550 euro per maand en', 'gaat in op 1 januari 2026.'],
  ],
  [
    ['Wij verzoeken u de overeenkomst te tekenen', 'en binnen twee weken terug te sturen.'],
    ['Heeft u vragen, dan kunt u ons bellen op', 'telefoonnummer 012-3456789.'],
    ['Met vriendelijke groet,'],
  ],
];

/** De tekst zoals hij uit de brief moet komen, met de standaardinstellingen. */
const TEXT = [
  'Geachte heer Jansen,',
  'Hierbij ontvangt u de nieuwe huurovereenkomst voor de woning aan de Voorbeeldstraat.',
  'De huur bedraagt 550 euro per maand en gaat in op 1 januari 2026.',
  'Wij verzoeken u de overeenkomst te tekenen en binnen twee weken terug te sturen.',
  'Heeft u vragen, dan kunt u ons bellen op telefoonnummer 012-3456789.',
  'Met vriendelijke groet,',
].join('\n\n');

/**
 * De tekst zoals hij er staat. Vergelijk met `toHaveJSProperty('textContent', …)` of `textContent()`:
 * `toHaveText` en `toContainText` voegen witruimte samen, en dan is een witregel gelijk aan een spatie.
 */
const output = (page: Page) => page.locator('pre.plaintext__output');

const choose = async (page: Page, options?: { scan?: boolean }) =>
  page.locator('#plaintext-file').setInputFiles(await letter('brief.pdf', PAGES, options));

const axe = async (page: Page) => {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(result.violations).toEqual([]);
};

test.describe('PDF → Platte tekst', () => {
  test.skip(({ isMobile }) => isMobile, 'Geavanceerd is er alleen op de computer');

  test('staat bij Geavanceerd', async ({ page }) => {
    await openPage(page, '/#/advanced', { lang: 'nl' });
    await page.getByRole('link', { name: new RegExp(nl.advanced.tools.text.title) }).click();
    await expect(page).toHaveURL(/#\/advanced\/text$/);
    await expect(
      page.getByRole('heading', { level: 1, name: nl.advanced.tools.text.title }),
    ).toBeVisible();
    await expect(page.getByText(p.placeholder)).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as Theme[]) {
    test(`haalt de tekst uit een PDF, zonder kop en voet (thema ${theme})`, async ({ page }) => {
      await openPage(page, '/#/advanced/text', { lang: 'nl', theme });
      await choose(page, { scan: true });

      await expect(output(page)).toHaveJSProperty('textContent', TEXT, SLOW);
      await expect(
        page.getByText(/^\d+ tekens · 2 van 3 pagina’s gelezen · gemiddeld/),
      ).toBeVisible();
      await expect(
        page.getByText(format(p.noTextPages, { list: format(p.pageOne, { n: 3 }) })),
      ).toBeVisible();
      const slot = page.locator('section.compare-slot');
      await expect(slot.getByText('brief.pdf')).toBeVisible();
      await expect(slot.getByText(/^3 pagina’s · .* · 1 pagina zonder tekstlaag$/)).toBeVisible();
      await expect(slot.locator('img.compare-slot__thumb')).toBeVisible();
      await axe(page);
    });
  }

  test('elke instelling werkt meteen', async ({ page }) => {
    await openPage(page, '/#/advanced/text', { lang: 'nl' });
    await choose(page);
    await expect(output(page)).toHaveJSProperty('textContent', TEXT, SLOW);
    const settings = page.getByRole('group', { name: s.title });

    // De kop en voet komen op elke pagina terug; zonder weglaten staan ze erin.
    await settings.getByRole('checkbox', { name: s.strip }).uncheck();
    await expect(output(page)).toContainText('Woningstichting Voorbeeld');
    await expect(output(page)).toContainText('Pagina 2 van 2');
    await settings.getByRole('checkbox', { name: s.strip }).check();
    await expect(output(page)).toHaveJSProperty('textContent', TEXT);

    // Afgebroken woorden blijven afgebroken als herstellen uit staat.
    await settings.getByRole('checkbox', { name: s.dehyphen }).uncheck();
    await expect(output(page)).toContainText('huurovereen- komst');
    await settings.getByRole('checkbox', { name: s.dehyphen }).check();

    // De alinea-gevoeligheid: bij 1,6 (de oude standaard) en hoger wordt pagina 1 één alinea.
    const slider = settings.getByRole('slider', { name: s.gap });
    await expect(settings.getByText('1,3')).toBeVisible();
    await slider.focus();
    await page.keyboard.press('End');
    await expect(settings.getByText('2,5')).toBeVisible();
    await expect
      .poll(() => output(page).textContent())
      .toContain('Geachte heer Jansen, Hierbij ontvangt u');
    await page.keyboard.press('Home');
    await expect(output(page)).toHaveJSProperty('textContent', TEXT);

    // Regels los: elke regel op een eigen regel, en de gevoeligheid doet dan niet mee.
    await settings.getByRole('checkbox', { name: s.joinLines }).uncheck();
    await expect
      .poll(() => output(page).textContent())
      .toContain('Geachte heer Jansen,\nHierbij ontvangt u');
    await expect(slider).toBeDisabled();
    await axe(page);

    // Wissen: de PDF is weg, de instellingen blijven.
    await page.getByRole('button', { name: p.clear }).click();
    await expect(page.getByText(p.placeholder)).toBeVisible();
    await expect(settings.getByRole('checkbox', { name: s.joinLines })).not.toBeChecked();
  });

  test('downloaden als tekstbestand en kopiëren naar het klembord', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openPage(page, '/#/advanced/text', { lang: 'nl' });
    await choose(page);
    await expect(output(page)).toHaveJSProperty('textContent', TEXT, SLOW);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: p.download }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('brief_extract.txt');
    await expect(page.getByText(format(p.downloaded, { name: 'brief_extract.txt' }))).toBeVisible();
    expect(readFileSync((await download.path())!, 'utf-8')).toBe(TEXT);

    await page.getByRole('button', { name: p.copy }).click();
    await expect(page.getByText(p.copied)).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    // Windows zet op het klembord CRLF in plaats van LF.
    expect(copied.replace(/\r\n/g, '\n')).toBe(TEXT);
  });
});

test.describe('PDF → Platte tekst op een scherm met schaal 150 %', () => {
  test.skip(({ isMobile }) => isMobile, 'Geavanceerd is er alleen op de computer');
  test.use({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1.5 });

  test('de knoppen passen op één regel', async ({ page }) => {
    await openPage(page, '/#/advanced/text', { lang: 'nl' });
    // Een gewone schuifbalk in het linkervak (17 px op Windows) kost breedte; de testbrowser toont
    // geen schuifbalken, dus die ruimte halen we hier zelf weg.
    await page.addStyleTag({ content: '.workspace__tools { padding-right: 23px !important; }' });
    await choose(page);
    await expect(page.locator('img.compare-slot__thumb')).toBeVisible(SLOW);
    const lines = (button: Locator) =>
      button.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      });
    // De knop in het vak met de PDF is een label bij het bestandsveld.
    expect(await lines(page.getByText(p.slot.replace, { exact: true })), p.slot.replace).toBe(1);
    for (const name of [p.copy, p.download, p.clear]) {
      expect(await lines(page.getByRole('button', { name, exact: true })), name).toBe(1);
    }
  });
});
