import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { makeScanPdf, pdfFile } from './fixtures';
import { messages, openPage } from './helpers';

const nl = messages.nl;

const fileInput = (page: Page) => page.locator('input[type="file"]');
const thumbnails = (page: Page) => page.locator('.thumb');

/** Hoeveel pixels van een getekende miniatuur niet (bijna) wit zijn. */
function inkedPixels(page: Page, index: number) {
  return page
    .locator('.thumb canvas')
    .nth(index)
    .evaluate((canvas: HTMLCanvasElement) => {
      const context = canvas.getContext('2d');
      if (!context || canvas.width === 0) return 0;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i]! < 240 || data[i + 1]! < 240 || data[i + 2]! < 240) count += 1;
      }
      return count;
    });
}

test.describe('PDF openen', () => {
  test('opent een PDF en tekent een miniatuur per pagina', async ({ page }) => {
    await openPage(page, '/#/pages', { lang: 'nl' });
    await fileInput(page).setInputFiles(await pdfFile('rapport.pdf', 3));

    await expect(page.getByRole('heading', { level: 2, name: 'rapport.pdf' })).toBeVisible();
    await expect(page.locator('.document__meta')).toContainText('3 pagina’s');
    await expect(thumbnails(page)).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) {
      await expect(thumbnails(page).nth(i)).toHaveAttribute('data-rendered', 'true');
      expect(await inkedPixels(page, i)).toBeGreaterThan(500);
    }
    await expect(page.getByRole('img', { name: 'Pagina 2' })).toBeVisible();
  });

  test('tekent ook een gescande pagina (afbeelding in JPEG 2000)', async ({ page }) => {
    const waarschuwingen: string[] = [];
    page.on('console', (message) => {
      if (/decode image|wasmUrl|failed to initialize/i.test(message.text())) {
        waarschuwingen.push(message.text());
      }
    });
    await openPage(page, '/#/pages', { lang: 'nl' });
    await fileInput(page).setInputFiles({
      name: 'scan.pdf',
      mimeType: 'application/pdf',
      buffer: await makeScanPdf(),
    });
    await expect(thumbnails(page).first()).toHaveAttribute('data-rendered', 'true');

    // De zwarte balken van de scan moeten in de miniatuur staan.
    const donker = await page
      .locator('.thumb canvas')
      .first()
      .evaluate((canvas: HTMLCanvasElement) => {
        const { data } = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
        let count = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i]! < 60) count += 1;
        return count / (canvas.width * canvas.height);
      });
    expect(donker).toBeGreaterThan(0.05);
    expect(waarschuwingen).toEqual([]);
  });

  test('levert de hulpbestanden van pdf.js mee', async ({ page, request }) => {
    await openPage(page, '/', { lang: 'nl' });
    for (const bestand of [
      'pdfjs/wasm/jbig2.wasm',
      'pdfjs/wasm/openjpeg.wasm',
      'pdfjs/cmaps/UniJIS-UTF16-H.bcmap',
      'pdfjs/standard_fonts/FoxitFixed.pfb',
    ]) {
      const response = await request.get(new URL(bestand, page.url()).href);
      expect(response.status(), bestand).toBe(200);
    }
  });

  test('een liggende pagina krijgt een lagere miniatuur', async ({ page }) => {
    await openPage(page, '/#/pages', { lang: 'nl' });
    await fileInput(page).setInputFiles(await pdfFile('gemengd.pdf', 2, [2]));
    await expect(thumbnails(page).nth(1)).toHaveAttribute('data-rendered', 'true');

    const staand = await page.locator('.thumb canvas').nth(0).boundingBox();
    const liggend = await page.locator('.thumb canvas').nth(1).boundingBox();
    expect(liggend!.height).toBeLessThan(staand!.height * 0.8);
  });

  test('tekent bij een groot document alleen wat in beeld komt', async ({ page }) => {
    await openPage(page, '/#/pages', { lang: 'nl' });
    await fileInput(page).setInputFiles(await pdfFile('dik.pdf', 120));
    await expect(thumbnails(page)).toHaveCount(120);
    await expect(thumbnails(page).first()).toHaveAttribute('data-rendered', 'true');

    const getekend = await page.locator('.thumb[data-rendered="true"]').count();
    expect(getekend).toBeLessThan(120);

    await thumbnails(page).last().scrollIntoViewIfNeeded();
    await expect(thumbnails(page).last()).toHaveAttribute('data-rendered', 'true');
  });

  test('gebruikt één gedeelde kijker, ook bij honderden pagina’s', async ({ page }) => {
    await page.addInitScript(() => {
      const Original = window.IntersectionObserver;
      const teller = window as unknown as { kijkers: number };
      teller.kijkers = 0;
      window.IntersectionObserver = class extends Original {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          super(callback, options);
          teller.kijkers += 1;
        }
      } as typeof IntersectionObserver;
    });
    await openPage(page, '/#/pages', { lang: 'nl' });
    await fileInput(page).setInputFiles(await pdfFile('dik.pdf', 300));
    await expect(thumbnails(page)).toHaveCount(300);
    await expect(thumbnails(page).first()).toHaveAttribute('data-rendered', 'true');
    expect(await page.evaluate(() => (window as unknown as { kijkers: number }).kijkers)).toBe(1);
  });

  test('het document blijft open als je van taak wisselt, en sluiten werkt', async ({ page }) => {
    await openPage(page, '/#/split', { lang: 'nl' });
    await fileInput(page).setInputFiles(await pdfFile('blijft.pdf', 2));
    await expect(page.getByRole('heading', { level: 2, name: 'blijft.pdf' })).toBeVisible();

    await page
      .getByRole('navigation', { name: nl.mainMenu })
      .getByRole('link', { name: nl.tasks.merge.title })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: nl.tasks.merge.title })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'blijft.pdf' })).toBeVisible();

    await page.getByRole('button', { name: nl.document.close }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: nl.document.openTitle }),
    ).toBeVisible();
  });

  test('weigert een bestand dat geen PDF is', async ({ page }) => {
    await openPage(page, '/#/pages', { lang: 'nl' });
    await fileInput(page).setInputFiles({
      name: 'foto.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    });
    await expect(page.getByRole('alert')).toHaveText(
      'foto.jpg is geen PDF. Kies een bestand dat eindigt op .pdf.',
    );
  });

  test('meldt een beschadigde PDF', async ({ page }) => {
    await openPage(page, '/#/pages', { lang: 'nl' });
    await fileInput(page).setInputFiles({
      name: 'kapot.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7\nhier staat geen echte pdf in\n%%EOF'),
    });
    await expect(page.getByRole('alert')).toHaveText(
      'kapot.pdf kon niet worden geopend. Het bestand is mogelijk beschadigd.',
    );
  });

  test('stuurt het bestand nergens naartoe', async ({ page, baseURL }) => {
    const elders: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith(baseURL!) && !request.url().startsWith('blob:')) {
        elders.push(request.url());
      }
    });
    await openPage(page, '/#/pages', { lang: 'nl' });
    await fileInput(page).setInputFiles(await pdfFile('privé.pdf', 2));
    await expect(thumbnails(page).nth(1)).toHaveAttribute('data-rendered', 'true');
    expect(elders).toEqual([]);
  });

  test('werkt in het Engels', async ({ page }) => {
    await openPage(page, '/#/pages', { lang: 'en' });
    await fileInput(page).setInputFiles(await pdfFile('report.pdf', 1));
    await expect(page.locator('.document__meta')).toContainText('1 page');
    await expect(page.getByRole('img', { name: 'Page 1' })).toBeVisible();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`is toegankelijk met een geopend document (${theme})`, async ({ page }) => {
      await openPage(page, '/#/pages', { lang: 'nl', theme });
      await fileInput(page).setInputFiles(await pdfFile('toegankelijk.pdf', 2));
      await expect(thumbnails(page).nth(1)).toHaveAttribute('data-rendered', 'true');

      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  }
});
