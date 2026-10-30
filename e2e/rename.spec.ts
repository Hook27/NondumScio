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
});
