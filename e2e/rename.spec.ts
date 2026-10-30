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
