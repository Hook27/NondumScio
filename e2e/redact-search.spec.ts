import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { messages } from './helpers';
import { download, drag, isBlack, openRedactWith, pixels, textOf } from './redact-helpers';

const nl = messages.nl;
const s = nl.redact.search;

const NAME = 'Pieter Jansen';
const IBAN = 'NL91 ABNA 0417 1643 00';
const MAIL = 'pieter.jansen@voorbeeld.nl';
const SIZE = 14;

const FONT = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);

/** Waar (in punten, van links) een stuk van een regel staat die op x = 60 begint. */
function span(line: string, hit: string, size = SIZE): [number, number] {
  const before = line.slice(0, line.indexOf(hit));
  const start = 60 + FONT.widthOfTextAtSize(before, size);
  return [start, start + FONT.widthOfTextAtSize(hit, size)];
}

/**
 * Pagina 1: een klant met naam, rekeningnummer en e-mailadres. Pagina 2: de naam nog een keer,
 * in een zin. Pagina 3: niets bijzonders.
 */
const LINES: [string, number][][] = [
  [
    [`Klant ${NAME}`, 150],
    [`IBAN ${IBAN}`, 200],
    [`Mail ${MAIL}`, 250],
  ],
  [[`Contact: ${NAME} belt weleens.`, 150]],
  [['OPENBAAR drie', 150]],
];

async function makeSearchPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of LINES) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 30, y: 30, width: 535, height: 782, color: rgb(0.85, 0.9, 1) });
    for (const [text, top] of lines) {
      page.drawText(text, { x: 60, y: 842 - top, size: SIZE, font, color: rgb(0, 0, 0) });
    }
  }
  return Buffer.from(await doc.save());
}

const candidates = (page: Page) => page.locator('[data-candidate]');
const boxes = (page: Page) => page.locator('[data-annotation]');

async function searchAll(page: Page) {
  await page.getByLabel(s.terms).fill(NAME);
  await page.getByLabel(s.iban).check();
  await page.getByLabel(s.email).check();
  await page.getByRole('button', { name: s.find }).click();
  await expect(page.getByText('4 treffers op 2 pagina’s.')).toBeVisible();
}

test.describe('redigeren: zoeken en markeren', () => {
  test('toont het paneel zonder dat de pagina breder wordt dan het scherm', async ({ page }) => {
    await openRedactWith(page, await makeSearchPdf());
    await expect(page.getByLabel(s.terms)).toBeVisible();
    await expect(page.getByRole('button', { name: s.find })).toBeDisabled();
    await page.getByLabel(s.email).check();
    await expect(page.getByRole('button', { name: s.find })).toBeEnabled();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });

  test.describe('op de computer', () => {
    test.skip(({ isMobile }) => isMobile, 'Precies klikken en slepen op de pagina: desktop');

    test('van zoeken tot een geredigeerd bestand: alleen de aangevinkte treffers worden zwart', async ({
      page,
    }) => {
      await openRedactWith(page, await makeSearchPdf());
      await searchAll(page);

      // De treffers staan als oranje vakken op de pagina; er zijn nog geen echte vakken.
      await expect(candidates(page)).toHaveCount(4);
      await expect(boxes(page)).toHaveCount(0);
      const list = page.getByRole('list', { name: s.list });
      await expect(list).toContainText(NAME);
      await expect(list).toContainText(IBAN);
      await expect(list).toContainText(MAIL);

      // De naam in de zin op pagina 2 laten we staan.
      await page.getByRole('checkbox', { name: /^Treffer 4, pagina 2/ }).uncheck();
      await expect(page.getByRole('button', { name: 'Zet vakken (3)' })).toBeVisible();
      await page.getByRole('button', { name: 'Zet vakken (3)' }).click();
      await expect(boxes(page)).toHaveCount(3);
      await expect(candidates(page)).toHaveCount(0);
      await expect(page.getByText(s.appliedOther.replace('{n}', '3'))).toBeVisible();

      const result = await download(page);
      const text = await textOf(result);
      // Pagina 1 is een afbeelding geworden, de andere pagina's hebben hun tekst nog.
      expect(text[0]!.trim()).toBe('');
      expect(text[1]).toContain(NAME);
      expect(text[2]).toContain('OPENBAAR drie');

      // De drie gevonden stukken zijn zwart: van begin tot eind, op de hoogte van de letters.
      const regels = LINES[0]!;
      const stukken: [number, number, number][] = [
        [...span(regels[0]![0], NAME), regels[0]![1]],
        [...span(regels[1]![0], IBAN), regels[1]![1]],
        [...span(regels[2]![0], MAIL), regels[2]![1]],
      ];
      const punten: [number, number][] = stukken.flatMap(([van, tot, top]) =>
        [van + 2, (van + tot) / 2, tot - 2].map((x): [number, number] => [Math.round(x), top - 4]),
      );
      const { colors } = await pixels(page, result, [...punten, [300, 700]]);
      colors.slice(0, 9).forEach((color, i) => {
        expect(isBlack(color), `punt ${i}: ${color.join(',')}`).toBe(true);
      });
      // Daarbuiten is de pagina ongemoeid.
      expect(isBlack(colors[9]!)).toBe(false);
    });

    test('een klik op een oranje vak zet het vinkje om, een klik op de lijst laat het oplichten', async ({
      page,
    }) => {
      await openRedactWith(page, await makeSearchPdf());
      await searchAll(page);
      const first = page.getByRole('checkbox', { name: /^Treffer 1, / });
      await expect(first).toBeChecked();

      const shape = candidates(page).first().locator('rect').first();
      await shape.scrollIntoViewIfNeeded();
      const area = (await shape.boundingBox())!;
      await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
      await expect(first).not.toBeChecked();
      await expect(candidates(page).first()).toHaveClass(/annotate-candidate--off/);
      await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
      await expect(first).toBeChecked();

      await page.locator('.search__go').nth(3).click();
      await expect(page.locator('.annotate-candidate--focus')).toHaveCount(1);
      // Een klik is geen tekening: er zijn nog steeds geen vakken.
      await expect(boxes(page)).toHaveCount(0);
    });

    test('opnieuw zoeken laat treffers weg die al in een vak liggen', async ({ page }) => {
      await openRedactWith(page, await makeSearchPdf());
      await searchAll(page);
      await page.getByRole('button', { name: 'Zet vakken (4)' }).click();
      await expect(boxes(page)).toHaveCount(4);
      await page.getByRole('button', { name: s.find }).click();
      await expect(page.getByText(s.noHits)).toBeVisible();
      await expect(
        page.getByText('Al afgedekt door een vak en daarom niet getoond: 4.'),
      ).toBeVisible();
      await expect(boxes(page)).toHaveCount(4);
      // En de vakken zijn in één keer ongedaan te maken.
      await page.getByRole('button', { name: nl.pages.undo }).click();
      await expect(boxes(page)).toHaveCount(0);
    });

    test('is toegankelijk met treffers in beeld', async ({ page }) => {
      await openRedactWith(page, await makeSearchPdf());
      await searchAll(page);
      const results = await new AxeBuilder({ page }).analyze();
      expect(results.violations).toEqual([]);
    });
  });
});

test.describe('redigeren: zoeken op een gescande pagina (OCR)', () => {
  test.skip(({ isMobile }) => isMobile, 'Precies slepen op de pagina: desktop');
  // De eerste keer laadt de herkenning (enkele MB) en een pagina op 300 dpi kost even.
  test.setTimeout(240_000);

  const SCAN_LINE = `Dossier ${NAME}`;
  const SCAN_SIZE = 28;
  const SCAN_TOP = 200;

  /** Een "scan": een pagina met alleen een afbeelding, gemaakt met Redigeren zelf (vak in een lege hoek). */
  async function makeScan(page: Page): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const sheet = doc.addPage([595, 842]);
    sheet.drawText(SCAN_LINE, {
      x: 60,
      y: 842 - SCAN_TOP,
      size: SCAN_SIZE,
      font,
      color: rgb(0, 0, 0),
    });
    await openRedactWith(page, Buffer.from(await doc.save()));
    await page.keyboard.press('r');
    await drag(page, [480, 60], [560, 120]);
    await expect(boxes(page)).toHaveCount(1);
    const scan = await download(page);
    expect((await textOf(scan))[0]!.trim()).toBe('');
    return scan;
  }

  test('zonder OCR wordt de scan overgeslagen, met OCR vind je de naam en wordt die zwart', async ({
    page,
  }) => {
    const scan = await makeScan(page);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await openRedactWith(page, scan, 'light', 'scan.pdf');

    await page.getByLabel(s.terms).fill('Jansen');
    await page.getByRole('button', { name: s.find }).click();
    await expect(page.getByText(s.skippedOne)).toBeVisible();
    await expect(candidates(page)).toHaveCount(0);
    // Zonder OCR wordt er niets van de herkenning geladen.
    expect(requests.filter((url) => url.includes('/ocr/'))).toEqual([]);

    await page.getByLabel(s.ocr).check();
    await expect(page.getByText(s.ocrHelp)).toBeVisible();
    await page.getByRole('button', { name: s.find }).click();
    await expect(page.getByText('1 treffer op 1 pagina.')).toBeVisible({ timeout: 200_000 });
    await expect(page.getByText(s.recognizedOne)).toBeVisible();
    await expect(page.locator('.search__tag')).toHaveText(s.viaOcr);
    await expect(candidates(page)).toHaveCount(1);
    expect(requests.some((url) => url.includes('/ocr/lang/nld.traineddata.gz'))).toBe(true);

    await page.getByRole('button', { name: 'Zet vakken (1)' }).click();
    await expect(boxes(page)).toHaveCount(1);
    const result = await download(page);

    // "Jansen" is zwart in de afbeelding, van begin tot eind.
    const [van, tot] = span(SCAN_LINE, 'Jansen', SCAN_SIZE);
    const y = SCAN_TOP - 8;
    const { colors } = await pixels(
      page,
      result,
      [van + 3, (van + tot) / 2, tot - 3].map((x): [number, number] => [Math.round(x), y]),
    );
    colors.forEach((color, i) =>
      expect(isBlack(color), `punt ${i}: ${color.join(',')}`).toBe(true),
    );
  });
});
