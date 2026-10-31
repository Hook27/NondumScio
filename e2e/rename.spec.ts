import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { downloadVia, messages, openPage } from './helpers';

/**
 * Slim hernoemen (Geavanceerd, alleen op de computer): brieven met een tekstlaag openen, de
 * voorgestelde namen nakijken en hernoemde kopieën downloaden.
 */

const r = messages.nl.rename;

/** Een brief van één pagina met deze regels bovenaan, zoals de tekstlaag van een scan. */
async function letter(lines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((line, i) => page.drawText(line, { x: 60, y: 780 - i * 24, size: 12, font }));
  return Buffer.from(await doc.save());
}

/** Een brief met een eigen paginabreedte (om de volgorde in het resultaat te herkennen). */
async function letterOf(lines: string[], width: number, pages = 1): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 0; n < pages; n += 1) {
    const page = doc.addPage([width, 842]);
    lines.forEach((line, i) => page.drawText(line, { x: 40, y: 780 - i * 24, size: 12, font }));
  }
  return Buffer.from(await doc.save());
}

/** De bladwijzers zoals een PDF-lezer ze ziet (gelezen met pdf.js): titel en pagina (vanaf 1). */
async function readOutline(path: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise;
  const outline = (await doc.getOutline()) ?? [];
  const result = [];
  for (const item of outline) {
    const dest = item.dest as [{ num: number; gen: number }, ...unknown[]];
    result.push({ title: item.title, page: (await doc.getPageIndex(dest[0])) + 1 });
  }
  await doc.loadingTask.destroy();
  return result;
}

const nameOf = (page: Page, file: string) => page.getByLabel(`Nieuwe naam voor ${file}`);

async function openLetters(page: Page, count: number) {
  const files = await Promise.all(
    Array.from({ length: count }, async (_, i) => ({
      name: `brief_${i + 1}.pdf`,
      mimeType: 'application/pdf',
      buffer: await letter([
        'Gemeente Utrecht',
        'Postbus 16200',
        'Datum: 12 maart 2026',
        `Betreft: Aanslag ${i + 1}`,
        ...Array.from({ length: 12 }, (_, n) => `Regel ${n + 1} van de brief met wat tekst`),
      ]),
    })),
  );
  await openPage(page, '/#/advanced/rename', { lang: 'nl' });
  await page.locator('#rename-files').setInputFiles(files);
  await expect(page.locator('.rename-table tbody tr')).toHaveCount(count);
}

test.describe('Slim hernoemen', () => {
  test.skip(({ isMobile }) => isMobile, 'Geavanceerd is er alleen op de computer');

  test('stelt namen voor en downloadt de hernoemde kopieën als ZIP', async ({ page }) => {
    const gemeente = await letter([
      'Gemeente Utrecht',
      'Postbus 16200',
      'Datum: 12 maart 2026',
      'Betreft: Aanslag gemeentelijke belastingen',
    ]);
    const bank = await letter(['ING Bank N.V.', 'Datum 3-2-2026', 'Betreft: Afschrift']);
    await openPage(page, '/#/advanced/rename', { lang: 'nl' });
    await page.locator('#rename-files').setInputFiles([
      { name: 'scan_001.pdf', mimeType: 'application/pdf', buffer: gemeente },
      { name: 'scan_002.pdf', mimeType: 'application/pdf', buffer: bank },
    ]);
    await expect(nameOf(page, 'scan_001.pdf')).toHaveValue('260312 gemeente utrecht aan.pdf');
    await expect(nameOf(page, 'scan_002.pdf')).toHaveValue('260203 ing bank n afschrift.pdf');
    await expect(page.getByText('2 bestanden · klaar')).toBeVisible();

    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);

    // Een eigen onderwerp voor de bankbrief.
    await page.getByLabel('Onderwerp van scan_002.pdf').fill('Jaaroverzicht');
    await expect(nameOf(page, 'scan_002.pdf')).toHaveValue('260203 ing bank n jaaroverz.pdf');

    const download = await downloadVia(page, page.getByRole('button', { name: r.download }));
    expect(download.suggestedFilename()).toMatch(/^pdfs-hernoemd_\d{8}_\d{4}\.zip$/);
    const files = unzipSync(new Uint8Array(readFileSync((await download.path())!)));
    expect(Object.keys(files)).toEqual([
      '260312 gemeente utrecht aan.pdf',
      '260203 ing bank n jaaroverz.pdf',
    ]);
    // Kopieën: precies het originele bestand, alleen met een andere naam.
    expect(Buffer.from(files['260203 ing bank n jaaroverz.pdf']!).equals(bank)).toBe(true);

    // Onthouden: het eigen onderwerp zodra het veld verlaten werd, en bij het downloaden ook wat
    // de tool zelf vond.
    await page.getByRole('button', { name: r.views.database }).click();
    await expect(page.getByLabel('Naam van afzender 1')).toHaveValue('Gemeente Utrecht');
    await expect(page.getByLabel('Naam van afzender 2')).toHaveValue('ING Bank N');
    await expect(page.getByLabel('Naam van onderwerp 1')).toHaveValue('Jaaroverzicht');
    await expect(page.getByLabel('Naam van onderwerp 2')).toHaveValue(
      'Aanslag gemeentelijke belastingen',
    );
  });

  test('met zichtbare tekst blijven alle brieven bereikbaar; het linkervak is smal', async ({
    page,
  }) => {
    await openLetters(page, 4);
    const view = page.locator('.workspace__view');
    // Het rechtervak blijft binnen het venster en scrolt zelf.
    const sizes = await view.evaluate((element) => ({
      client: element.clientHeight,
      scroll: element.scrollHeight,
      window: window.innerHeight,
    }));
    expect(sizes.client).toBeLessThan(sizes.window);
    expect(sizes.scroll).toBeGreaterThan(sizes.client);
    const last = page.locator('.rename-table tbody tr').last();
    await view.evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(last.getByLabel('Nieuwe naam voor brief_4.pdf')).toBeInViewport();
    // Het linkervak is smaller dan bij de taken (hooguit 18rem).
    const tools = await page.locator('.workspace__tools').boundingBox();
    expect(tools!.width).toBeLessThanOrEqual(18 * 16);
  });

  test('naar een andere taak en terug: de stand is er nog', async ({ page }) => {
    await openLetters(page, 2);
    await page.getByLabel('Onderwerp van brief_2.pdf').fill('Eigen onderwerp');
    const menu = page.getByRole('navigation', { name: messages.nl.mainMenu });
    await menu.getByRole('link', { name: messages.nl.tasks.merge.title }).click();
    await expect(page).toHaveURL(/#\/merge$/);
    await menu.getByRole('link', { name: messages.nl.advanced.title }).click();
    await page
      .getByRole('link', { name: new RegExp(messages.nl.advanced.tools.rename.title) })
      .click();
    await expect(nameOf(page, 'brief_2.pdf')).toHaveValue('260312 gemeente utrecht eig.pdf');
    await expect(page.locator('.rename-table tbody tr')).toHaveCount(2);
  });

  test('database: importeren, herkennen, onthouden en exporteren', async ({ page }) => {
    const axe = () =>
      new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    await openPage(page, '/#/advanced/rename', { lang: 'nl' });
    const toView = (name: string) => page.getByRole('button', { name }).click();
    await toView(r.views.database);
    await expect(page.getByRole('button', { name: r.views.database })).toBeFocused();
    await expect(page.getByText(r.db.empty)).toHaveCount(2);

    // Een export van de HTML-tool (verzonnen namen).
    await page.locator('#rename-db-import').setInputFiles({
      name: 'pdf-hernoemer-database.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify(
          {
            afzenders: [{ naam: 'ING', triggers: ['ing bank'] }],
            onderwerpen: [{ naam: 'Rekening', triggers: ['afschrift'] }],
          },
          null,
          2,
        ),
      ),
    });
    await expect(
      page.getByText('Geïmporteerd en samengevoegd: +1 afzender, +1 onderwerp.'),
    ).toBeVisible();
    expect((await axe()).violations).toEqual([]);

    // Na herladen is de database er nog.
    await page.reload();
    await toView(r.views.database);
    await expect(page.getByLabel('Naam van afzender 1')).toHaveValue('ING');
    await expect(page.getByLabel('Herkenwoorden van onderwerp 1')).toHaveValue('afschrift');

    await toView(r.views.rename);
    await page.locator('#rename-files').setInputFiles([
      {
        name: 'scan_001.pdf',
        mimeType: 'application/pdf',
        buffer: await letter(['Gemeente Utrecht', 'Datum: 12 maart 2026', 'Betreft: Aanslag']),
      },
      {
        name: 'scan_002.pdf',
        mimeType: 'application/pdf',
        buffer: await letter(['ING Bank N.V.', 'Datum 3-2-2026', 'Betreft: Afschrift']),
      },
    ]);
    // Herkend uit de database, met een groene rand.
    const sender = page.getByLabel('Afzender van scan_002.pdf');
    await expect(sender).toHaveValue('ING');
    await expect(nameOf(page, 'scan_002.pdf')).toHaveValue('260203 ing rekening.pdf');
    await expect(sender).toHaveAccessibleDescription(r.known);
    await expect(sender).toHaveCSS('border-top-color', 'rgb(21, 128, 61)');
    await expect(page.getByLabel('Afzender van scan_001.pdf')).not.toHaveCSS(
      'border-top-color',
      'rgb(21, 128, 61)',
    );
    expect((await axe()).violations).toEqual([]);

    // Een eigen onderwerp wordt onthouden zodra je het veld verlaat.
    await page.getByLabel('Onderwerp van scan_001.pdf').fill('OZB');
    await page.keyboard.press('Tab');
    await toView(r.views.database);
    await expect(page.getByLabel('Naam van onderwerp 2')).toHaveValue('OZB');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: r.db.export }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^pdf-hernoemer-database_\d{8}_\d{4}\.json$/);
    expect(JSON.parse(readFileSync((await download.path())!, 'utf8'))).toEqual({
      afzenders: [{ naam: 'ING', triggers: ['ing bank'] }],
      onderwerpen: [
        { naam: 'Rekening', triggers: ['afschrift'] },
        { naam: 'OZB', triggers: [] },
      ],
    });
    // Terug naar Hernoemen: de brieven staan er nog.
    await toView(r.views.rename);
    await expect(nameOf(page, 'scan_001.pdf')).toHaveValue('260312 gemeente utrecht ozb.pdf');
  });

  test('samenvoegen: op datum, met een losse PDF, eigen volgorde en bladwijzers', async ({
    page,
  }) => {
    await openPage(page, '/#/advanced/rename', { lang: 'nl' });
    await page.locator('#rename-files').setInputFiles([
      {
        name: 'scan_001.pdf',
        mimeType: 'application/pdf',
        buffer: await letterOf(['ING Bank N.V.', 'Datum 3-2-2026', 'Betreft: Afschrift'], 400, 2),
      },
      {
        name: 'scan_002.pdf',
        mimeType: 'application/pdf',
        buffer: await letterOf(['Gemeente Utrecht', 'Datum: 12 maart 2026', 'Betreft: OZB'], 500),
      },
    ]);
    await expect(nameOf(page, 'scan_002.pdf')).toHaveValue('260312 gemeente utrecht ozb.pdf');
    await page.getByRole('button', { name: r.views.merge }).click();
    await page.locator('#rename-merge-add').setInputFiles({
      name: '260101 notaris akte.pdf',
      mimeType: 'application/pdf',
      buffer: await letterOf(['Notaris'], 300),
    });
    await expect(page.getByText(r.merge.addedOne)).toBeVisible();
    const rows = page.locator('.rename-merge tbody tr');
    await expect(rows.locator('.rename-table__file')).toHaveText([
      '260312 gemeente utrecht ozb.pdf',
      '260203 ing bank n afschrift.pdf',
      /^260101 notaris akte\.pdf\s*extern$/,
    ]);
    await expect(
      page.getByText('3 bestanden · 4 pagina’s · eerst de nieuwste, als laatste de oudste'),
    ).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);

    // De notaris naar boven: de focus blijft bij de pijlen van die brief.
    const up = page.getByRole('button', { name: '260101 notaris akte.pdf omhoog' });
    await up.click();
    await up.click();
    await expect(
      page.getByRole('button', { name: '260101 notaris akte.pdf omlaag' }),
    ).toBeFocused();

    const download = await downloadVia(page, page.getByRole('button', { name: r.merge.download }));
    expect(download.suggestedFilename()).toBe('260101-260312 samengevoegd.pdf');
    const path = (await download.path())!;
    const merged = await PDFDocument.load(readFileSync(path));
    expect(merged.getPages().map((p) => p.getWidth())).toEqual([300, 500, 400, 400]);
    expect(await readOutline(path)).toEqual([
      { title: '260101 notaris akte', page: 1 },
      { title: '260312 gemeente utrecht ozb', page: 2 },
      { title: '260203 ing bank n afschrift', page: 3 },
    ]);
  });

  test('een scan zonder tekstlaag krijgt met OCR toch een naam; zonder scans geen OCR', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await openPage(page, '/#/advanced/rename', { lang: 'nl' });
    await page.locator('#rename-files').setInputFiles({
      name: 'tekst.pdf',
      mimeType: 'application/pdf',
      buffer: await letter(['ING Bank N.V.', 'Datum 3-2-2026', 'Betreft: Afschrift']),
    });
    await expect(nameOf(page, 'tekst.pdf')).toHaveValue('260203 ing bank n afschrift.pdf');
    await expect(page.getByText('1 bestand · klaar')).toBeVisible();
    // Een brief met tekstlaag: niets van de tekstherkenning geladen.
    expect(requests.filter((url) => url.includes('/ocr/'))).toEqual([]);

    // Een scan: alleen een afbeelding van de brief, zonder tekstlaag. Met een datum in de
    // bestandsnaam, die het moet afleggen tegen de herkende datum.
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1240;
      canvas.height = 1754;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000000';
      context.font = '40px Arial, sans-serif';
      ['Gemeente Utrecht', 'Postbus 16200', 'Datum: 12 maart 2026', 'Betreft: Aanslag'].forEach(
        (line, i) => context.fillText(line, 120, 200 + i * 70),
      );
      return canvas.toDataURL('image/png').split(',')[1]!;
    });
    const doc = await PDFDocument.create();
    const image = await doc.embedPng(Buffer.from(png, 'base64'));
    doc.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
    await page.locator('#rename-add').setInputFiles({
      name: 'scan_20260101.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    const scan = page.locator('.rename-table tbody tr').filter({ hasText: 'scan_20260101.pdf' });
    await expect(scan.getByText(r.ocr.done)).toBeVisible({ timeout: 200_000 });
    await expect(page.getByLabel('Datum voor scan_20260101.pdf')).toHaveValue('260312');
    await expect(page.getByLabel('Afzender van scan_20260101.pdf')).toHaveValue('Gemeente Utrecht');
    await expect(nameOf(page, 'scan_20260101.pdf')).toHaveValue('260312 gemeente utrecht aan.pdf');
    await expect(page.getByText('2 bestanden · klaar')).toBeVisible();
    // De herkenning kwam van de eigen site (/ocr/), met Nederlandse taaldata.
    expect(requests.some((url) => url.includes('/ocr/lang/nld.traineddata.gz'))).toBe(true);

    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);
  });

  test('ontbreekt de briefdatum in de tekstlaag, dan vindt OCR hem op de pagina', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openPage(page, '/#/advanced/rename', { lang: 'nl' });
    // Wat er op papier staat: met "Heerlen," en de briefdatum eronder.
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1240;
      canvas.height = 1754;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#000000';
      context.font = '40px Arial, sans-serif';
      [
        'Verzekeraar',
        'Heerlen,',
        '3 november 2025',
        'Onderwerp: premieverhoging per 1 januari 2026',
        'U ziet het 5 januari 2026 terug.',
      ].forEach((line, i) => context.fillText(line, 120, 200 + i * 70));
      return canvas.toDataURL('image/png').split(',')[1]!;
    });
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const sheet = doc.addPage([595, 842]);
    sheet.drawImage(await doc.embedPng(Buffer.from(png, 'base64')), {
      x: 0,
      y: 0,
      width: 595,
      height: 842,
    });
    // De (onzichtbare) tekstlaag van de scanner, waarin de briefdatum ontbreekt.
    [
      'Verzekeraar',
      'Heerlen,',
      'Onderwerp: premieverhoging per 1 januari 2026',
      'U ziet het 5 januari 2026 terug.',
    ].forEach((line, i) =>
      sheet.drawText(line, { x: 60, y: 760 - i * 34, size: 12, font, opacity: 0 }),
    );
    await page.locator('#rename-files').setInputFiles({
      name: 'scan_009.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    const row = page.locator('.rename-table tbody tr').filter({ hasText: 'scan_009.pdf' });
    await expect(row.getByText(r.ocr.dateFound)).toBeVisible({ timeout: 200_000 });
    await expect(page.getByLabel('Datum voor scan_009.pdf')).toHaveValue('251103');
    // Afzender en onderwerp komen uit de tekstlaag.
    await expect(page.getByLabel('Afzender van scan_009.pdf')).toHaveValue('Verzekeraar');
    await expect(page.getByLabel('Onderwerp van scan_009.pdf')).toHaveValue(
      'premieverhoging per 1 januari 2026',
    );
    await expect(
      page.getByLabel('Gevonden datums in scan_009.pdf').locator('option').nth(1),
    ).toHaveText('251103 · tekst: 3 november 2025 · OCR');
  });

  test('bekijken: de PDF in een venster, pagina voor pagina', async ({ page }) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const text of ['Gemeente Utrecht', 'Bijlage op pagina twee']) {
      doc.addPage([595, 842]).drawText(text, { x: 60, y: 780, size: 28, font });
    }
    await openPage(page, '/#/advanced/rename', { lang: 'nl' });
    await page.locator('#rename-files').setInputFiles({
      name: 'scan_009.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    const view = page.getByRole('button', { name: 'scan_009.pdf bekijken' });
    await view.click();
    const dialog = page.getByRole('dialog', { name: /scan_009\.pdf/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Pagina 1 van 2')).toBeVisible();
    // De pagina is echt getekend: het canvas heeft beeldpunten, en er staat iets donkers op.
    const canvas = dialog.locator('canvas');
    await expect
      .poll(() =>
        canvas.evaluate((element: HTMLCanvasElement) => {
          if (element.width === 0) return false;
          const data = element
            .getContext('2d')!
            .getImageData(0, 0, element.width, element.height).data;
          for (let i = 0; i < data.length; i += 4) if (data[i]! < 100) return true;
          return false;
        }),
      )
      .toBe(true);

    const result = await new AxeBuilder({ page })
      .include('dialog')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(result.violations).toEqual([]);

    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByText('Pagina 2 van 2')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(view).toBeFocused();
  });
});
