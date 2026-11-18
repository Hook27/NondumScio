import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { makeSizedPdf } from './fixtures';
import { messages, openPage } from './helpers';

/**
 * Vaste ruimte voor de schuifbalk in het werkvak (audit F19). Zonder die ruimte wordt het vak
 * smaller zodra de schuifbalk verschijnt; Bewerken en Redigeren tekenen de pagina's dan opnieuw
 * passend, en dat kan heen en weer gaan. De testbrowser verbergt schuifbalken normaal (dan nemen ze
 * geen ruimte in en zie je het verschil niet); in dit bestand staan ze aan, zoals op Windows.
 */
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.skip(({ isMobile }) => isMobile, 'Het werkvak met twee vakken is er alleen op de computer');

/** De breedte die de inhoud van het rechtervak krijgt (zonder de schuifbalk). */
const inner = (page: Page) =>
  page
    .locator('.workspace__view')
    .first()
    .evaluate((el) => ({
      client: el.clientWidth,
      scrolls: el.scrollHeight > el.clientHeight,
    }));

test('Bewerken: het vak houdt dezelfde breedte, met en zonder schuifbalk', async ({ page }) => {
  await openPage(page, '/#/edit', { lang: 'nl' });
  // Eén heel brede, lage pagina: passend getekend is hij laag, dus geen schuifbalk.
  await page.locator('#pdf-file').setInputFiles({
    name: 'breed.pdf',
    mimeType: 'application/pdf',
    buffer: await makeSizedPdf([4000]),
  });
  await expect(page.locator('.annotate-page').first()).toHaveAttribute('data-rendered', 'true', {
    timeout: 15_000,
  });
  const before = await inner(page);
  expect(before.scrolls).toBe(false);

  // Een bestand met vijf staande pagina's erbij: nu past het niet meer, dus wel een schuifbalk.
  await page.locator('#edit-add').setInputFiles({
    name: 'vijf.pdf',
    mimeType: 'application/pdf',
    buffer: await makeSizedPdf([595, 595, 595, 595, 595]),
  });
  await expect(page.locator('.annotate-page')).toHaveCount(6, { timeout: 15_000 });
  const after = await inner(page);
  expect(after.scrolls).toBe(true);
  expect(after.client).toBe(before.client);
});

test.describe('Platte tekst op een scherm met schaal 150 %', () => {
  // Op 1,5 × getekend en afgerond was het beeld soms een pixel hoger dan de pagina: dan liep het
  // voorbeeld over, kreeg het een eigen schuifbalk, werd het smaller, en sprong "Hele breedte" heen
  // en weer (zo gezien bij 1172, 1244, 1307 en 1442 px breed).
  test.use({ deviceScaleFactor: 1.5 });

  test('"Hele breedte" staat stil, bij elke vensterbreedte', async ({ page }) => {
    test.setTimeout(120_000);
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const sheet = doc.addPage([595, 842]);
    for (let i = 0; i < 40; i++) {
      sheet.drawText(`Regel ${i + 1} van de brief.`, { x: 70, y: 780 - i * 18, size: 11, font });
    }
    await page.setViewportSize({ width: 1300, height: 760 });
    await openPage(page, '/#/advanced/text', { lang: 'nl' });
    await page.locator('#plaintext-file').setInputFiles({
      name: 'brief.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    await expect(page.locator('canvas.plaintext-preview__canvas')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: messages.nl.pageBar.fitWidth }).click();

    const jumps: string[] = [];
    for (let width = 1100; width <= 1450; width += 9) {
      await page.setViewportSize({ width, height: 760 });
      const seen = await page.evaluate(async () => {
        const widths: number[] = [];
        for (let i = 0; i < 5; i++) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          const box = document.querySelector<HTMLElement>('.plaintext-preview__page')!;
          widths.push(Math.round(box.getBoundingClientRect().width));
        }
        const wrap = document.querySelector<HTMLElement>('.plaintext-preview')!;
        return { widths, overflow: wrap.scrollHeight - wrap.clientHeight };
      });
      if (new Set(seen.widths).size > 1 || seen.overflow > 0) {
        jumps.push(`${width} px: ${seen.widths.join(', ')} (loopt ${seen.overflow} px over)`);
      }
    }
    expect(jumps).toEqual([]);
  });
});

test('elk rechtervak heeft vaste ruimte voor de schuifbalk, en het linkervak niet', async ({
  page,
}) => {
  await openPage(page, '/#/edit', { lang: 'nl' });
  // Een werkvak zoals elke taak het heeft (Pagina's, Bewerken, Redigeren, Platte tekst, Vergelijken,
  // Triage, Slim hernoemen …): dezelfde klassen, dus dezelfde regels.
  const styles = await page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    const result: Record<string, string> = {};
    for (const kind of ['', 'compare', 'triage', 'plaintext', 'rename']) {
      const section = document.createElement('section');
      section.className = `workspace ${kind}`.trim();
      section.innerHTML = '<div class="workspace__tools"></div><div class="workspace__view"></div>';
      main.append(section);
      const [tools, view] = [...section.children] as HTMLElement[];
      result[`${kind || 'gewoon'} rechts`] = getComputedStyle(view!).scrollbarGutter;
      result[`${kind || 'gewoon'} links`] = getComputedStyle(tools!).scrollbarGutter;
      section.remove();
    }
    return result;
  });
  for (const [where, gutter] of Object.entries(styles)) {
    expect(gutter, where).toBe(where.endsWith('rechts') ? 'stable' : 'auto');
  }
});
