import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { format } from '../src/i18n/format';
import { messages, openPage, type Theme } from './helpers';

/**
 * PDF → Platte tekst (Geavanceerd, alleen op de computer): een PDF openen, leesvakken tekenen en de
 * tekst eruit halen.
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

const LINES = 8;
const column = (side: string, no: number) =>
  Array.from({ length: LINES }, (_, i) => `${side} kolom pagina ${no} regel ${i + 1}`);

/**
 * Een artikel in twee kolommen, zoals een tijdschrift: bovenaan een titel over de volle breedte,
 * dan links en rechts acht regels van 10 pt, en onderaan een paginanummer.
 */
async function article(name: string, pages = 2) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let no = 1; no <= pages; no++) {
    const page = doc.addPage([595, 842]);
    page.drawText('Proefartikel over leesvakken', { x: 60, y: 780, size: 16, font });
    column('Linker', no).forEach((line, i) =>
      page.drawText(line, { x: 60, y: 700 - i * 12, size: 10, font }),
    );
    column('Rechter', no).forEach((line, i) =>
      page.drawText(line, { x: 315, y: 700 - i * 12, size: 10, font }),
    );
    page.drawText(`Pagina ${no}`, { x: 280, y: 40, size: 9, font });
  }
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

/** De kolommen als vak (links, boven, rechts, onder), in punten vanaf linksonder. */
const LEFT_BOX = [50, 715, 300, 600] as const;
const RIGHT_BOX = [305, 715, 560, 600] as const;

/** Een punt op de pagina (in punten vanaf linksonder) als plek op het scherm. */
async function at(page: Page, x: number, y: number) {
  const box = (await page.locator('.plaintext-preview__page').boundingBox())!;
  return { x: box.x + (x / 595) * box.width, y: box.y + ((842 - y) / 842) * box.height };
}

/** Met de muis slepen van het ene punt naar het andere (in punten). */
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const start = await at(page, ...from);
  const end = await at(page, ...to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
}

const draw = (page: Page, [left, top, right, bottom]: readonly [number, number, number, number]) =>
  drag(page, [left, top], [right, bottom]);

/** Telt de pixels die niet wit zijn: het voorbeeld is echt getekend. */
/** Een vingerafdruk van het getekende beeld: verschilt per pagina. */
const fingerprint = (page: Page) =>
  page.locator('canvas.plaintext-preview__canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum = (sum * 31 + data[i]!) % 1_000_000_007;
    return sum;
  });

const ink = (page: Page) =>
  page.locator('canvas.plaintext-preview__canvas').evaluate((canvas: HTMLCanvasElement) => {
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i]! < 200) n++;
    return n;
  });

const openArticle = async (page: Page, pages = 2) => {
  await openPage(page, '/#/advanced/text', { lang: 'nl' });
  await page.locator('#plaintext-file').setInputFiles(await article('artikel.pdf', pages));
  await expect(page.locator('canvas.plaintext-preview__canvas')).toBeVisible(SLOW);
};

const extract = (page: Page) => page.getByRole('button', { name: p.extract }).click();

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
    test(`eerst het voorbeeld, dan de tekst na "Tekst extraheren" (thema ${theme})`, async ({
      page,
    }) => {
      await openPage(page, '/#/advanced/text', { lang: 'nl', theme });
      await choose(page, { scan: true });
      await expect(page.locator('canvas.plaintext-preview__canvas')).toBeVisible(SLOW);
      await expect(page.getByText(format(p.preview.page, { n: 1, total: 3 }))).toBeVisible();
      await expect.poll(() => ink(page)).toBeGreaterThan(100);
      await expect(output(page)).toHaveCount(0);
      const slot = page.locator('section.plaintext-slot');
      await expect(slot.getByText(/^3 pagina’s · .* · 1 pagina zonder tekstlaag$/)).toBeVisible();
      await expect(slot.getByText('brief.pdf')).toBeVisible();
      await axe(page);

      await extract(page);
      await expect(page.getByRole('button', { name: p.views.result })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(output(page)).toHaveJSProperty('textContent', TEXT);
      await expect(
        page.getByText(format(p.noTextPages, { list: format(p.pageOne, { n: 3 }) })),
      ).toBeVisible();
      await expect(
        page.getByText(/^Klaar: \d+ tekens · 2 van 3 pagina’s gelezen\.$/),
      ).toBeVisible();
      await axe(page);
    });
  }

  test('leesvakken: alleen wat in de vakken staat, in tekenvolgorde', async ({ page }) => {
    await openArticle(page);
    const zones = page.getByRole('group', { name: p.zones.title });
    await zones.getByRole('checkbox', { name: p.zones.use }).check();
    await expect(zones.getByText(p.zones.empty)).toBeVisible();

    // Eerst de rechterkolom, dan de linker: zo wordt het ook gelezen.
    await draw(page, RIGHT_BOX);
    await draw(page, LEFT_BOX);
    await expect(zones.locator('.plaintext-zones__label')).toHaveText(['Vak 1', 'Vak 2']);
    await expect(page.locator('.plaintext-zone__num')).toHaveText(['1', '2']);
    await axe(page);

    await extract(page);
    const both = (no: number) =>
      `${column('Rechter', no).join(' ')}\n\n${column('Linker', no).join(' ')}`;
    await expect(output(page)).toHaveJSProperty('textContent', `${both(1)}\n\n${both(2)}`);

    // Ctrl+Z haalt het laatste vak weg (in het voorbeeld); dan alleen nog de rechterkolom.
    await page.getByRole('button', { name: p.views.preview }).click();
    await page.keyboard.press('Control+z');
    await expect(zones.locator('.plaintext-zones__label')).toHaveText(['Vak 1']);
    await extract(page);
    await expect(output(page)).toHaveJSProperty(
      'textContent',
      `${column('Rechter', 1).join(' ')}\n\n${column('Rechter', 2).join(' ')}`,
    );
  });

  test('een vak verplaatsen en een rand verslepen', async ({ page }) => {
    await openArticle(page, 1);
    await page.getByRole('checkbox', { name: p.zones.use }).check();
    await draw(page, LEFT_BOX);
    // Het vak naar rechts schuiven: dan leest het de rechterkolom.
    await drag(page, [150, 650], [405, 650]);
    await extract(page);
    await expect(output(page)).toHaveJSProperty('textContent', column('Rechter', 1).join(' '));

    // De onderrand omhoog, tot net onder de derde regel (y 676): alleen de eerste drie.
    await page.getByRole('button', { name: p.views.preview }).click();
    await drag(page, [432, 600], [432, 670]);
    await extract(page);
    await expect(output(page)).toHaveJSProperty(
      'textContent',
      column('Rechter', 1).slice(0, 3).join(' '),
    );
  });

  test('bladeren en zoomen', async ({ page }) => {
    await openArticle(page, 3);
    const label = (n: number) => page.getByText(format(p.preview.page, { n, total: 3 }));
    await expect.poll(() => ink(page)).toBeGreaterThan(100);
    const first = await fingerprint(page);
    await page.getByRole('button', { name: p.preview.next }).click();
    await expect(label(2)).toBeVisible();
    // Er wordt echt een andere pagina getekend (de regels noemen hun paginanummer).
    await expect.poll(() => fingerprint(page)).not.toBe(first);
    await page.keyboard.press('End');
    await expect(label(3)).toBeVisible();
    await page.keyboard.press('Home');
    await expect(label(1)).toBeVisible();
    // Het scrollwiel: de hele pagina past, dus het bladert meteen door.
    const centre = await at(page, 300, 420);
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, 200);
    await expect(label(2)).toBeVisible();

    const value = page.locator('.plaintext-zoom__value');
    const fitted = parseInt((await value.textContent())!, 10);
    await page.getByRole('button', { name: p.preview.zoomIn }).click();
    await expect
      .poll(async () => parseInt((await value.textContent())!, 10))
      .toBeGreaterThan(fitted);
    await page.getByRole('button', { name: p.preview.fitWidth }).click();
    await expect(page.getByRole('button', { name: p.preview.fitWidth })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: p.preview.fitPage }).click();
    await expect(value).toHaveText(`${fitted}%`);
  });

  test('instellingen werken bij opnieuw extraheren', async ({ page }) => {
    await openPage(page, '/#/advanced/text', { lang: 'nl' });
    await choose(page);
    await extract(page);
    await expect(output(page)).toHaveJSProperty('textContent', TEXT, SLOW);
    const settings = page.getByRole('group', { name: s.title });

    // Kop- en voetteksten: pas na opnieuw extraheren staan ze erin.
    await settings.getByRole('checkbox', { name: s.strip }).uncheck();
    await expect(page.getByText(p.stale)).toBeVisible();
    await expect(output(page)).toHaveJSProperty('textContent', TEXT);
    await extract(page);
    await expect(page.getByText(p.stale)).toHaveCount(0);
    await expect(output(page)).toContainText('Woningstichting Voorbeeld');
    await expect(output(page)).toContainText('Pagina 2 van 2');
    await settings.getByRole('checkbox', { name: s.strip }).check();

    // De alinea-gevoeligheid: bij 2,5 wordt pagina 1 één alinea.
    const slider = settings.getByRole('slider', { name: s.gap });
    await expect(settings.getByText('1,3')).toBeVisible();
    await slider.focus();
    await page.keyboard.press('End');
    await expect(settings.getByText('2,5')).toBeVisible();
    await extract(page);
    await expect
      .poll(() => output(page).textContent())
      .toContain('Geachte heer Jansen, Hierbij ontvangt u');

    // Regels los: elke regel apart, en de gevoeligheid doet dan niet mee.
    await settings.getByRole('checkbox', { name: s.joinLines }).uncheck();
    await expect(slider).toBeDisabled();
    await extract(page);
    await expect
      .poll(() => output(page).textContent())
      .toContain('Geachte heer Jansen,\nHierbij ontvangt u');

    // Wissen: de PDF is weg, de instellingen blijven.
    await page.getByRole('button', { name: p.clear, exact: true }).click();
    await expect(page.getByText(p.placeholder)).toBeVisible();
    await expect(settings.getByRole('checkbox', { name: s.joinLines })).not.toBeChecked();
  });

  test('downloaden als tekstbestand en kopiëren naar het klembord', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openPage(page, '/#/advanced/text', { lang: 'nl' });
    await choose(page);
    await extract(page);
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

test.describe('PDF → Platte tekst: vakken per pagina en bewaren', () => {
  test.skip(({ isMobile }) => isMobile, 'Geavanceerd is er alleen op de computer');

  const z = p.zones;
  const sv = p.save;
  const zones = (page: Page) => page.getByRole('group', { name: z.title });
  const labels = (page: Page) => zones(page).locator('.plaintext-zones__label');
  const openBlock = (page: Page, title: string) =>
    page.locator('summary', { hasText: title }).click();

  test('eigen vakken voor één pagina, in een andere kleur, en een pagina helemaal lezen', async ({
    page,
  }) => {
    await openArticle(page, 3);
    await zones(page).getByRole('checkbox', { name: z.use }).check();
    await draw(page, LEFT_BOX);

    // Pagina 2: eigen vakken, de rechterkolom.
    await page.getByRole('button', { name: p.preview.next }).click();
    await zones(page).getByRole('checkbox', { name: z.own }).check();
    await expect(zones(page).getByText(format(z.ownOn, { n: 2 }))).toBeVisible();
    await zones(page).getByRole('button', { name: z.clearAll }).click();
    await draw(page, RIGHT_BOX);
    await expect(labels(page)).toHaveText(['Vak 1']);
    // Oranje rand: de kleur van eigen vakken, niet die van de standaardvakken.
    const colour = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => getComputedStyle(el).borderTopColor);
    const own = await colour('.plaintext-zone--own');
    await page.getByRole('button', { name: p.preview.previous }).click();
    await expect(page.locator('.plaintext-zone--own')).toHaveCount(0);
    expect(await colour('.plaintext-zone')).not.toBe(own);
    await axe(page);

    await extract(page);
    await expect(output(page)).toHaveJSProperty(
      'textContent',
      [
        column('Linker', 1).join(' '),
        column('Rechter', 2).join(' '),
        column('Linker', 3).join(' '),
      ].join('\n\n'),
    );

    // Pagina 3 zonder vakken: overgeslagen, of helemaal gelezen.
    await page.getByRole('button', { name: p.views.preview }).click();
    await page.getByRole('button', { name: p.preview.last }).click();
    await zones(page).getByRole('checkbox', { name: z.own }).check();
    await zones(page).getByRole('button', { name: z.clearAll }).click();
    await extract(page);
    await expect(page.getByText(format(p.skippedPages, { list: 'pagina 3' }))).toBeVisible();
    await zones(page).getByRole('checkbox', { name: z.readEmpty }).check();
    await extract(page);
    await expect
      .poll(() => output(page).textContent())
      .toContain(`Proefartikel over leesvakken\n\n${column('Linker', 3).join(' ')}`);
  });

  test('onthoudt de vakken per bestandsnaam, ook na herladen', async ({ page }) => {
    await openArticle(page, 2);
    await zones(page).getByRole('checkbox', { name: z.use }).check();
    await draw(page, RIGHT_BOX);
    await page
      .getByRole('group', { name: s.title })
      .getByRole('checkbox', { name: s.dehyphen })
      .uncheck();

    await page.reload();
    await page.locator('#plaintext-file').setInputFiles(await article('artikel.pdf', 2));
    await expect(
      page.locator('section.plaintext-slot').getByText(/instellingen hersteld$/),
    ).toBeVisible(SLOW);
    await expect(zones(page).getByRole('checkbox', { name: z.use })).toBeChecked();
    await expect(labels(page)).toHaveText(['Vak 1']);
    await expect(
      page.getByRole('group', { name: s.title }).getByRole('checkbox', { name: s.dehyphen }),
    ).not.toBeChecked();
    await extract(page);
    await expect(output(page)).toHaveJSProperty(
      'textContent',
      `${column('Rechter', 1).join(' ')}\n\n${column('Rechter', 2).join(' ')}`,
    );
  });

  test('opslaan en laden als .json, ook een bestand van de losse extractor', async ({ page }) => {
    await openArticle(page, 2);
    await zones(page).getByRole('checkbox', { name: z.use }).check();
    await draw(page, LEFT_BOX);
    await openBlock(page, sv.title);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: sv.export }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('artikel_instellingen.json');
    const saved = JSON.parse(readFileSync((await download.path())!, 'utf-8'));
    expect(saved).toMatchObject({ v: 2, pdf: 'artikel.pdf', options: { useCrop: true } });
    expect(saved.zones.d).toHaveLength(1);
    await axe(page);

    // Een bestand zoals de extractor het maakt: de rechterkolom als vak, pagina 2 overslaan.
    const [left, top, right, bottom] = RIGHT_BOX;
    const original = {
      v: 2,
      pdf: 'artikel.pdf',
      zones: {
        d: [{ x0: left / 595, y0: (842 - top) / 842, x1: right / 595, y1: (842 - bottom) / 842 }],
        p: { '2': [] },
      },
      joinOverride: {},
      options: { useCrop: true, columns: true, dehyphen: true, joinLines: true, paraGap: '1.6' },
      meta: { title: '', author: '', subject: '', date: '' },
    };
    await page.locator('#plaintext-settings-file').setInputFiles({
      name: 'uit-de-extractor.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(original)),
    });
    await expect(
      page.getByText(format(sv.imported, { name: 'uit-de-extractor.json' })),
    ).toBeVisible();
    await expect(page.getByRole('slider', { name: s.gap })).toHaveValue('1.6');
    await extract(page);
    await expect(output(page)).toHaveJSProperty('textContent', column('Rechter', 1).join(' '));
    await expect(page.getByText(format(p.skippedPages, { list: 'pagina 2' }))).toBeVisible();
  });

  test('onthouden instellingen vergeten, na een vraag', async ({ page }) => {
    await openArticle(page, 1);
    await zones(page).getByRole('checkbox', { name: z.use }).check();
    await draw(page, LEFT_BOX);
    const remembered = () =>
      page.evaluate(
        () => Object.keys(localStorage).filter((k) => k.startsWith('nondumscio:plaintext:')).length,
      );
    expect(await remembered()).toBe(1);
    await openBlock(page, sv.title);
    await page.getByRole('button', { name: sv.forget }).click();
    const dialog = page.getByRole('dialog', { name: sv.forgetTitle });
    await expect(dialog).toBeVisible();
    await axe(page);
    await dialog.getByRole('button', { name: sv.cancel }).click();
    expect(await remembered()).toBe(1);
    await page.getByRole('button', { name: sv.forget }).click();
    await page.getByRole('dialog').getByRole('button', { name: sv.forgetConfirm }).click();
    await expect(page.getByText(sv.forgottenOne)).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await remembered()).toBe(0);
    // Wat open staat, blijft staan.
    await expect(labels(page)).toHaveText(['Vak 1']);
  });
});

test.describe('PDF → Platte tekst op een scherm met schaal 150 %', () => {
  test.skip(({ isMobile }) => isMobile, 'Geavanceerd is er alleen op de computer');
  test.use({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1.5 });

  test('de pagina krijgt de ruimte: één balk erboven, en bij Hele pagina past hij', async ({
    page,
  }) => {
    await openArticle(page, 2);
    // De balk (voorbeeld/resultaat, bladeren, zoomen) staat op één regel (de keuze is iets hoger).
    const tops = await page
      .locator('.plaintext-bar > *')
      .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(Math.max(...tops) - Math.min(...tops), JSON.stringify(tops)).toBeLessThan(10);
    // De pagina is minstens 60 % van de hoogte van het venster, en past er helemaal in.
    const box = (await page.locator('.plaintext-preview__page').boundingBox())!;
    expect(box.height).toBeGreaterThan(768 * 0.6);
    expect(box.y + box.height).toBeLessThanOrEqual(768);
    // Het PDF-vak en de blokken links staan niet over elkaar heen.
    const slot = (await page.locator('.plaintext-slot').boundingBox())!;
    const zones = (await page.locator('details.plaintext-block').first().boundingBox())!;
    expect(zones.y).toBeGreaterThanOrEqual(slot.y + slot.height);
    // Een blok klapt dicht met een klik op de kop.
    await page.locator('summary', { hasText: p.zones.title }).click();
    await expect(page.getByRole('checkbox', { name: p.zones.use })).toBeHidden();
    await page.locator('summary', { hasText: p.zones.title }).click();
    await expect(page.getByRole('checkbox', { name: p.zones.use })).toBeVisible();
  });

  test('de knoppen passen op één regel', async ({ page }) => {
    await openPage(page, '/#/advanced/text', { lang: 'nl' });
    // Een gewone schuifbalk in het linkervak (17 px op Windows) kost breedte; de testbrowser toont
    // geen schuifbalken, dus die ruimte halen we hier zelf weg.
    await page.addStyleTag({ content: '.workspace__tools { padding-right: 23px !important; }' });
    await choose(page);
    await expect(page.locator('canvas.plaintext-preview__canvas')).toBeVisible(SLOW);
    await page.getByRole('checkbox', { name: p.zones.use }).check();
    const lines = (button: Locator) =>
      button.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length;
      });
    // De knop in het vak met de PDF is een label bij het bestandsveld.
    expect(await lines(page.getByText(p.slot.replace, { exact: true })), p.slot.replace).toBe(1);
    const names = [
      p.views.preview,
      p.views.result,
      p.clear,
      p.zones.undo,
      p.zones.clearAll,
      p.extract,
      p.preview.fitPage,
      p.preview.fitWidth,
      p.zones.allOwn,
    ];
    for (const name of names) {
      expect(await lines(page.getByRole('button', { name, exact: true })), name).toBe(1);
    }
    await page.locator('summary', { hasText: p.save.title }).click();
    for (const name of [p.save.export, p.save.import, p.save.forget]) {
      expect(await lines(page.getByRole('button', { name, exact: true })), name).toBe(1);
    }
    await extract(page);
    for (const name of [p.copy, p.download]) {
      expect(await lines(page.getByRole('button', { name, exact: true })), name).toBe(1);
    }
  });
});
