import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts, rgb } from 'pdf-lib';
import { downloadVia, messages, openPage } from './helpers';
import {
  download,
  drag,
  isBlack,
  leaks,
  linkTargets,
  pages,
  pixels,
  textOf,
} from './redact-helpers';

const nl = messages.nl;

const SECRET = 'GEHEIM-4711';
const IBAN = 'NL00TEST0123456789';

/**
 * Een PDF van drie pagina's. Pagina 2 bevat het geheim en een rekeningnummer (met bovenaan een
 * kop die erbuiten blijft); de titel, auteur en het onderwerp bevatten het geheim ook. Met
 * `contents` heeft pagina 1 een klikbare inhoudsopgave: koppelingen naar pagina 2 en 3.
 */
async function makeSecretPdf({ contents = false } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.setTitle(`Rapport ${SECRET}`);
  doc.setAuthor('Jan Jansen');
  doc.setSubject(`Onderwerp ${SECRET}`);
  const lines: [string[], number][] = [
    [['OPENBAAR een'], 100],
    [['KOP boven', `Het wachtwoord is ${SECRET} voor niemand`, `IBAN ${IBAN}`], 100],
    [['OPENBAAR drie'], 100],
  ];
  lines.forEach(([texts, top], pageIndex) => {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 30, y: 30, width: 535, height: 782, color: rgb(0.85, 0.9, 1) });
    texts.forEach((text, i) => {
      // Van boven naar beneden: 100, 200 (hier het geheim) en 300 punten van de bovenkant.
      page.drawText(text, { x: 60, y: 842 - (top + i * 100), size: 22, font, color: rgb(0, 0, 0) });
    });
    page.drawText(`pagina ${pageIndex + 1}`, { x: 60, y: 60, size: 12, font });
  });
  if (contents) {
    const [first, ...rest] = doc.getPages();
    const links = rest.map((target, i) =>
      doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [60, 500 - i * 40, 300, 530 - i * 40],
          Border: [0, 0, 0],
          Dest: [target.ref, 'Fit'],
        }),
      ),
    );
    first!.node.set(PDFName.of('Annots'), doc.context.obj(links));
  }
  return Buffer.from(await doc.save());
}

const boxes = (page: Page) => page.locator('[data-annotation]');

async function openRedact(page: Page, theme: 'light' | 'dark' = 'light', pdf?: Buffer) {
  await openPage(page, '/#/redact', { lang: 'nl', theme });
  await page.locator('#pdf-file').setInputFiles({
    name: 'rapport.pdf',
    mimeType: 'application/pdf',
    buffer: pdf ?? (await makeSecretPdf()),
  });
  await expect(pages(page).first()).toHaveAttribute('data-rendered', 'true', { timeout: 15_000 });
}

/** Het vak over de regels met het geheim en het rekeningnummer van pagina 2. */
async function boxOverSecret(page: Page) {
  await page.keyboard.press('r');
  await drag(page, [40, 160], [560, 330], 1);
  await expect(boxes(page)).toHaveCount(1);
}

test.describe('redigeren: de tekst is echt weg', () => {
  test.skip(
    ({ isMobile }) => isMobile,
    'Precies slepen op de pagina: desktop (telefoon: aparte test)',
  );

  test('het geheim staat nergens meer in het bestand, de rest van het document is ongemoeid', async ({
    page,
  }) => {
    const source = await makeSecretPdf();
    // Controle op de controle: in het origineel staat het geheim wél, en is het te lezen.
    expect(await leaks(source, SECRET)).toBe(true);
    expect((await textOf(source))[1]).toContain(SECRET);

    await openRedact(page, 'light', source);
    await boxOverSecret(page);
    const result = await download(page);

    // 1. De tekst: pagina 2 heeft niets meer, de andere pagina's wel.
    const text = await textOf(result);
    expect(text).toHaveLength(3);
    expect(text[0]).toContain('OPENBAAR een');
    expect(text[1]!.trim()).toBe('');
    expect(text[2]).toContain('OPENBAAR drie');
    // 2. Nergens in het bestand: niet als tekst, niet als hex, niet in titel of onderwerp.
    expect(await leaks(result, SECRET)).toBe(false);
    expect(await leaks(result, IBAN)).toBe(false);
    expect(await leaks(result, 'wachtwoord')).toBe(false);
    // 3. Documentgegevens zijn standaard niet overgenomen.
    const out = await PDFDocument.load(result, { updateMetadata: false });
    expect(out.getTitle()).toBeUndefined();
    expect(out.getAuthor()).toBeUndefined();
    expect(out.getSubject()).toBeUndefined();
    // 4. Pagina 2 is één afbeelding op 300 dpi (595 punten = 2479 beeldpunten).
    const resources = out.getPage(1).node.Resources()!;
    expect(resources.has(PDFName.of('Font'))).toBe(true); // pdf-lib zet een lege lijst
    const xobjects = resources.lookup(PDFName.of('XObject')) as unknown as {
      entries(): [unknown, unknown][];
    };
    const [[, imageRef]] = xobjects.entries() as [[unknown, never]];
    const image = out.context.lookup(imageRef) as PDFRawStream;
    expect(Number(image.dict.get(PDFName.of('Width'))?.toString())).toBe(2479);
    // 5. De app zegt zelf dat hij het gecontroleerd heeft.
    await expect(page.getByRole('status').filter({ hasText: nl.redact.verifiedOne })).toBeVisible();
  });

  test('een inhoudsopgave met koppelingen haalt de originele pagina niet mee, en blijft werken', async ({
    page,
  }) => {
    const source = await makeSecretPdf({ contents: true });
    expect(await linkTargets(source)).toEqual([2, 3]);

    await openRedact(page, 'light', source);
    await boxOverSecret(page);
    const result = await download(page);

    // Nergens in het bestand, ook niet als verstopte kopie van de oude pagina 2.
    expect(await leaks(result, SECRET)).toBe(false);
    expect(await leaks(result, IBAN)).toBe(false);
    expect(await leaks(result, 'wachtwoord')).toBe(false);
    // De koppelingen wijzen naar de pagina's van het nieuwe bestand: 2 (nu een afbeelding) en 3.
    expect(await linkTargets(result)).toEqual([2, 3]);
    expect((await textOf(result))[2]).toContain('OPENBAAR drie');
  });

  test('het gebied is echt zwart, en alleen dat gebied', async ({ page }) => {
    await openRedact(page);
    await boxOverSecret(page);
    const result = await download(page);
    const seen = await pixels(page, result.length > 0 ? await pageTwoOnly(result) : result, [
      [300, 245], // midden van het vak
      [45, 170], // net binnen de linkerbovenhoek
      [555, 325], // net binnen de rechteronderhoek
      [300, 100], // boven het vak: licht
      [300, 450], // onder het vak: licht
    ]);
    expect(seen.size).toEqual({ width: 595, height: 842 });
    const [middle, topLeft, bottomRight, above, below] = seen.colors as number[][];
    expect(isBlack(middle!)).toBe(true);
    expect(isBlack(topLeft!)).toBe(true);
    expect(isBlack(bottomRight!)).toBe(true);
    expect(isBlack(above!)).toBe(false);
    expect(isBlack(below!)).toBe(false);
  });

  test('documentgegevens blijven alleen behouden als je dat kiest', async ({ page }) => {
    await openRedact(page);
    await boxOverSecret(page);
    await page.getByLabel(nl.redact.stripMetadata).uncheck();
    const result = await download(page);
    const out = await PDFDocument.load(result, { updateMetadata: false });
    expect(out.getTitle()).toBe(`Rapport ${SECRET}`);
    expect(out.getAuthor()).toBe('Jan Jansen');
    // De pagina-inhoud is wel weg, ook met behouden documentgegevens.
    expect((await textOf(result))[1]!.trim()).toBe('');
  });

  test('de resolutie bepaalt de grootte van de afbeelding', async ({ page }) => {
    await openRedact(page);
    await boxOverSecret(page);
    await expect(page.getByLabel(nl.redact.dpi300)).toBeChecked();
    await page.getByLabel(nl.redact.dpi150).check();
    const result = await download(page);
    const out = await PDFDocument.load(result, { updateMetadata: false });
    const xobjects = out.getPage(1).node.Resources()!.lookup(PDFName.of('XObject')) as unknown as {
      entries(): [unknown, unknown][];
    };
    const [[, ref]] = xobjects.entries() as [[unknown, never]];
    const image = out.context.lookup(ref) as PDFRawStream;
    expect(Number(image.dict.get(PDFName.of('Width'))?.toString())).toBe(1240);
  });

  test('het voorbeeld toont de vakken effen zwart, en zonder voorbeeld zie je wat eronder staat', async ({
    page,
  }) => {
    await openRedact(page);
    await boxOverSecret(page);
    const rect = boxes(page).first().locator('rect').first();
    expect(Number(await rect.getAttribute('fill-opacity'))).toBeLessThan(1);
    await page.getByLabel(nl.redact.preview).check();
    expect(Number(await rect.getAttribute('fill-opacity'))).toBe(1);
  });

  test('met draaiing: een pagina die bij Pagina’s gedraaid is, wordt op de goede plek afgedekt', async ({
    page,
  }) => {
    await openRedact(page);
    // Naar Pagina's, pagina 2 een kwartslag rechtsom, en terug naar Redigeren.
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.pages.title }).click();
    await page.getByRole('option').nth(1).click();
    await page.getByRole('button', { name: nl.pages.rotateRight }).click();
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.redact.title }).click();
    await pages(page)
      .nth(1)
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expect(pages(page).nth(1)).toHaveAttribute('data-rendered', 'true', { timeout: 15_000 });

    // De pagina is nu 842 breed en 595 hoog. De regels met het geheim (op 200 en 300 punten van
    // de bovenkant) staan nu in een kolom: x = 842 − 300 … 842 − 200 = 542 … 642 punten.
    await page.keyboard.press('r');
    // De kop van het paneel ligt over de bovenkant van de pagina: begin dus onderaan en sleep
    // omhoog (de pointer blijft vastgepakt, ook als het eind onder de kop valt).
    await drag(page, [660, 480], [520, 10], 1, 842);
    await expect(boxes(page)).toHaveCount(1);
    const result = await download(page);

    expect(await leaks(result, SECRET)).toBe(false);
    expect((await textOf(result))[1]!.trim()).toBe('');
    const seen = await pixels(page, await pageTwoOnly(result), [
      [590, 250], // midden van het vak
      [100, 100], // ver erbuiten
    ]);
    expect(seen.size).toEqual({ width: 842, height: 595 });
    expect(isBlack(seen.colors[0]!)).toBe(true);
    expect(isBlack(seen.colors[1]!)).toBe(false);
  });
});

/** Een PDF met alleen de tweede pagina, om die met de omzetter te kunnen bekijken. */
async function pageTwoOnly(bytes: Buffer): Promise<Buffer> {
  const source = await PDFDocument.load(bytes, { updateMetadata: false });
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(source, [1]);
  out.addPage(page!);
  return Buffer.from(await out.save());
}

test.describe('redigeren: de vakken gelden bij elke taak', () => {
  // Meerdere downloads met redactie op 300 dpi per test: bij een volledige testrun (druk) past
  // dat niet altijd in de standaard 30 s.
  test.setTimeout(60_000);
  test.skip(({ isMobile }) => isMobile, 'Precies slepen op de pagina: desktop');

  test('Pagina’s: downloaden neemt de redactie mee, en weggehaalde pagina’s zijn echt weg', async ({
    page,
  }) => {
    await openRedact(page);
    await boxOverSecret(page);
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.pages.title }).click();
    const result = await download(page);
    expect(await leaks(result, SECRET)).toBe(false);
    expect((await textOf(result))[1]!.trim()).toBe('');
    expect((await textOf(result))[0]).toContain('OPENBAAR een');
  });

  test('Samenvoegen en Splitsen: ook daar geen restanten', async ({ page }) => {
    await openRedact(page);
    await boxOverSecret(page);

    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.merge.title }).click();
    const merged = await downloadVia(page, page.getByRole('button', { name: nl.merge.download }));
    const mergedBytes = readFileSync((await merged.path())!);
    expect(await leaks(mergedBytes, SECRET)).toBe(false);
    expect((await textOf(mergedBytes))[1]!.trim()).toBe('');

    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.split.title }).click();
    const part = async (n: number) => {
      const file = await downloadVia(
        page,
        page.getByRole('button', { name: `Deel ${n} downloaden` }),
      );
      return readFileSync((await file.path())!);
    };
    const [one, two] = [await part(1), await part(2)];
    expect((await textOf(one))[0]).toContain('OPENBAAR een');
    expect(await leaks(one, SECRET)).toBe(false);
    expect(await leaks(two, SECRET)).toBe(false);
    expect((await textOf(two))[0]!.trim()).toBe('');
  });

  test('Omzetten: de afbeelding van die pagina heeft het gebied zwart', async ({ page }) => {
    await openRedact(page);
    await boxOverSecret(page);
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.convert.title }).click();
    await page.getByLabel(nl.convert.dpi72).check();
    await expect(page.getByText(nl.convert.redactionsApplied)).toBeVisible();
    // Alleen pagina 2 bewaren: de andere pagina's weghalen via het bereik.
    const field = page.getByLabel('Pagina’s kiezen uit rapport.pdf');
    await field.fill('2');
    await field.press('Enter');
    const file = await downloadVia(
      page,
      page.getByRole('button', { name: nl.convert.downloadOne }),
    );
    const png = readFileSync((await file.path())!);
    const colors = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return [
        [300, 245],
        [300, 450],
      ].map(([x, y]) => [...context.getImageData(x!, y!, 1, 1).data].slice(0, 3));
    }, png.toString('base64'));
    expect(isBlack(colors[0]!)).toBe(true);
    expect(isBlack(colors[1]!)).toBe(false);
  });

  test('Bewerken: de vakken staan er ook, maar zonder dat je ze kunt zetten', async ({ page }) => {
    await openRedact(page);
    await boxOverSecret(page);
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.edit.title }).click();
    // Pagina's worden pas getekend als ze in beeld zijn: eerst naar de bovenkant.
    await pages(page)
      .first()
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expect(pages(page).first()).toHaveAttribute('data-rendered', 'true', { timeout: 15_000 });
    // Er is geen gereedschap om vakken te zetten, wel het vak zelf.
    await expect(
      page.getByRole('toolbar').getByRole('button', { name: nl.redact.redact }),
    ).toHaveCount(0);
    await expect(boxes(page)).toHaveCount(1);
    await expect(boxes(page).first()).toHaveAccessibleName(nl.redact.boxOf);
    // En bij Bewerken downloaden past de redactie ook toe.
    const result = await download(page);
    expect(await leaks(result, SECRET)).toBe(false);
  });

  test('ongedaan maken staat in dezelfde reeks: vak weg, dan is er niets meer om te redigeren', async ({
    page,
  }) => {
    await openRedact(page);
    await boxOverSecret(page);
    await page.getByRole('button', { name: nl.pages.undo }).click();
    await expect(boxes(page)).toHaveCount(0);
    // Zonder vak blijft het bestand zoals het was: de tekst staat er nog, ook het geheim.
    const result = await download(page);
    expect((await textOf(result))[1]).toContain(SECRET);
  });
});

test.describe('redigeren: toegankelijkheid en telefoon', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`het scherm met een redactievak is toegankelijk (${theme})`, async ({ page }) => {
      await openRedact(page, theme);
      await page.keyboard.press('r');
      await pages(page).first().focus();
      await page.keyboard.press('Enter');
      await expect(boxes(page)).toHaveCount(1);
      // Met de OCR-keuze en de uitleg erbij aan.
      await page.getByLabel(nl.redact.ocr).check();
      await expect(page.getByText(nl.redact.ocrHelp)).toBeVisible();
      await page.getByRole('button', { name: nl.info }).click();
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
      ).toEqual([]);
    });
  }

  test('met het toetsenbord: vak plaatsen, schuiven, verwijderen; en downloaden werkt ook op een telefoon', async ({
    page,
  }) => {
    await openRedact(page);
    await page.keyboard.press('r');
    await pages(page).nth(1).focus();
    await page.keyboard.press('Enter');
    const box = boxes(page).first();
    await expect(box).toHaveAccessibleName(nl.redact.boxOf);
    await box.focus();
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.getByText(nl.redact.affectedOne)).toBeVisible();

    const result = await download(page);
    // De pagina met het vak is een afbeelding geworden; de andere twee hebben hun tekst nog.
    const text = await textOf(result);
    expect(text[0]).toContain('OPENBAAR een');
    expect(text[1]!.trim()).toBe('');
    expect(text[2]).toContain('OPENBAAR drie');
  });

  test('de uitleg staat bij de ⓘ-knop en noemt wat wel en niet wordt overgenomen', async ({
    page,
  }) => {
    await openRedact(page);
    await page.getByRole('button', { name: nl.info }).click();
    await expect(
      page.getByText(/bladwijzers, formulieren en bijlagen worden niet overgenomen/),
    ).toBeVisible();
  });
});

test.describe('redigeren: tekstherkenning (OCR)', () => {
  test.skip(({ isMobile }) => isMobile, 'Precies slepen op de pagina: desktop');
  // De eerste keer laadt de herkenning (enkele MB) en een pagina op 300 dpi kost even.
  test.setTimeout(180_000);

  const ocrBox = (page: Page) => page.getByLabel(nl.redact.ocr);

  test('staat standaard uit: dan staat er op de pagina met een vak geen tekst', async ({
    page,
  }) => {
    const verzoeken: string[] = [];
    page.on('request', (request) => verzoeken.push(request.url()));
    await openRedact(page);
    await expect(ocrBox(page)).not.toBeChecked();
    await boxOverSecret(page);
    const result = await download(page);
    expect((await textOf(result))[1]!.trim()).toBe('');
    // Zonder OCR wordt er niets van de herkenning geladen.
    expect(verzoeken.filter((url) => url.includes('/ocr/'))).toEqual([]);
  });

  test('met OCR is de overgebleven tekst terug, en het geheim niet', async ({ page, baseURL }) => {
    const elders: string[] = [];
    const verzoeken: string[] = [];
    page.on('request', (request) => {
      verzoeken.push(request.url());
      if (!request.url().startsWith(baseURL!) && !/^(blob|data):/.test(request.url())) {
        elders.push(request.url());
      }
    });
    await openRedact(page);
    await ocrBox(page).check();
    // Toetsen als R gelden niet in een veld: eerst de focus naar de pagina.
    await pages(page).first().focus();
    await boxOverSecret(page);
    await expect(page.getByText(nl.redact.affectedOcrOne)).toBeVisible();
    const result = await download(page);

    // Het geheim en het rekeningnummer zijn weg, in tekst én in het bestand.
    expect(await leaks(result, SECRET)).toBe(false);
    expect(await leaks(result, IBAN)).toBe(false);
    const text = await textOf(result);
    expect(text[1]).not.toMatch(/GEHEIM|4711|IBAN|NL00|TEST0123|wachtwoord/i);
    // De kop buiten het vak is herkend en dus weer te zoeken en te selecteren.
    expect(text[1]).toMatch(/KOP/i);
    expect(text[1]).toMatch(/boven/i);
    // De andere pagina's hebben hun eigen tekst nog.
    expect(text[0]).toContain('OPENBAAR een');
    expect(text[2]).toContain('OPENBAAR drie');

    // De herkende tekst is onzichtbaar: de pagina ziet er nog steeds uit als de afbeelding.
    const doc = await PDFDocument.load(result, { updateMetadata: false });
    expect(doc.getTitle()).toBeUndefined();

    // Alles kwam van de eigen site, en de herkenning is echt geladen.
    expect(elders).toEqual([]);
    expect(verzoeken.some((url) => url.includes('/ocr/lang/nld.traineddata.gz'))).toBe(true);
    expect(verzoeken.some((url) => url.includes('/ocr/lang/eng.traineddata.gz'))).toBe(true);
    await expect(page.getByText(/herkende tekst toegevoegd/)).toBeVisible();
  });

  test('stoppen laat niets downloaden', async ({ page }) => {
    await openRedact(page);
    await ocrBox(page).check();
    // Toetsen als R gelden niet in een veld: eerst de focus naar de pagina.
    await pages(page).first().focus();
    await boxOverSecret(page);
    let gedownload = false;
    page.on('download', () => (gedownload = true));
    await page.getByRole('button', { name: nl.pages.save }).click();
    await page.getByRole('dialog').getByRole('button', { name: nl.saveDialog.download }).click();
    await page.getByRole('button', { name: nl.redact.stop }).click();
    await expect(page.getByText(nl.pages.errors.cancelled)).toBeVisible();
    expect(gedownload).toBe(false);
    // Daarna kan het gewoon opnieuw (zonder OCR).
    await ocrBox(page).uncheck();
    const result = await download(page);
    expect(await leaks(result, SECRET)).toBe(false);
  });
});
