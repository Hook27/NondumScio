import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { messages, openPage, openPdf, SLOW } from './helpers';

const nl = messages.nl;
const NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Een gewone pagina met een paar regels tekst. */
async function letter() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  for (let i = 0; i < 10; i++) {
    page.drawText(`Regel ${i + 1} van de proefbrief over greepjes`, {
      x: 60,
      y: 760 - i * 16,
      size: 11,
      font,
    });
  }
  return { name: 'brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

type Look = { color: string; edge: string; cursor: string; size: number };

/** Hoe een greepje eruitziet: kleur, rand, muisaanwijzer en maat (met de rand erbij). */
const look = (grip: Locator): Promise<Look> =>
  grip.evaluate((el) => {
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    // Een SVG-greepje (Bewerken, Redigeren) heeft vulling en lijn; de lijn valt buiten zijn maat.
    if (el instanceof SVGElement) {
      return {
        color: style.fill,
        edge: style.stroke,
        cursor: style.cursor,
        size: Math.round(rect.width + parseFloat(style.strokeWidth)),
      };
    }
    return {
      color: style.backgroundColor,
      edge: style.borderTopColor,
      cursor: style.cursor,
      size: Math.round(rect.width),
    };
  });

async function looks(page: Page, scope: string) {
  const result: Record<string, Look> = {};
  for (const name of NAMES) {
    result[name] = await look(page.locator(`${scope} [data-handle="${name}"]`));
  }
  return result;
}

test.describe('greepjes: overal dezelfde', () => {
  test.skip(({ isMobile }) => isMobile, 'Platte tekst staat alleen op de computer');

  test('Redigeren en Platte tekst: acht gelijke vierkantjes met de pijl de goede kant op', async ({
    page,
  }) => {
    const file = await letter();

    // Redigeren: een vak met het toetsenbord; het is meteen gekozen, met zijn greepjes.
    await openPdf(page, '/#/redact', file, { lang: 'nl' });
    const sheet = page.locator('.annotate-page').first();
    await expect(sheet).toHaveAttribute('data-rendered', 'true', SLOW);
    await page.keyboard.press('r');
    await sheet.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.annotate-page [data-handle]')).toHaveCount(8);
    const redact = await looks(page, '.annotate-page');

    // De rechterzijde 40 beeldpunten naar rechts (en wat omlaag): alleen breder.
    const box = page.locator('[data-annotation] rect').first();
    const before = (await box.boundingBox())!;
    const grip = (await page.locator('[data-handle="e"]').boundingBox())!;
    const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 25, { steps: 6 });
    await page.mouse.up();
    const after = (await box.boundingBox())!;
    expect(after.width - before.width).toBeCloseTo(40, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);

    // Platte tekst: een leesvak tekenen.
    await openPage(page, '/#/advanced/text', { lang: 'nl' });
    await page.locator('#plaintext-file').setInputFiles(file);
    await expect(page.locator('canvas.plaintext-preview__canvas')).toBeVisible(SLOW);
    await page
      .getByRole('group', { name: nl.plainText.zones.title })
      .getByRole('checkbox', { name: nl.plainText.zones.use })
      .check();
    const sheetBox = (await page.locator('.plaintext-preview__page').boundingBox())!;
    await page.mouse.move(sheetBox.x + sheetBox.width * 0.1, sheetBox.y + sheetBox.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(sheetBox.x + sheetBox.width * 0.6, sheetBox.y + sheetBox.height * 0.3, {
      steps: 6,
    });
    await page.mouse.up();
    await expect(page.locator('.plaintext-zone')).toHaveCount(1);
    const text = await looks(page, '.plaintext-zone');

    // Dezelfde vierkantjes: kleur, rand, maat en muisaanwijzer, greepje voor greepje.
    expect(redact).toEqual(text);
    expect(text.e).toMatchObject({ size: 12, cursor: 'ew-resize' });
    expect(text.nw!.cursor).toBe('nwse-resize');
    expect(text.n!.cursor).toBe('ns-resize');
    expect(text.ne!.cursor).toBe('nesw-resize');
  });
});
