import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { pdfFile } from './fixtures';
import { downloadVia, messages, openPage } from './helpers';

const nl = messages.nl;

/** Tekent in de browser een effen afbeelding en geeft de bytes van een echte PNG of JPEG terug. */
async function makeImage(
  page: Page,
  type: 'image/png' | 'image/jpeg',
  width: number,
  height: number,
  color = '#2c56c9',
): Promise<Buffer> {
  const base64 = await page.evaluate(
    async (args) => {
      const canvas = document.createElement('canvas');
      canvas.width = args.width;
      canvas.height = args.height;
      const context = canvas.getContext('2d')!;
      context.fillStyle = args.color;
      context.fillRect(0, 0, args.width, args.height);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((result) => resolve(result!), args.type, 0.9),
      );
      let text = '';
      for (const byte of new Uint8Array(await blob.arrayBuffer()))
        text += String.fromCharCode(byte);
      return btoa(text);
    },
    { type, width, height, color },
  );
  return Buffer.from(base64, 'base64');
}

/** Zet in een JPEG de EXIF-draaiing `value` (6 = de foto moet 90° rechtsom om rechtop te staan). */
function withExifOrientation(jpeg: Buffer, value: number): Buffer {
  const tiff = Buffer.from([
    0x4d,
    0x4d,
    0,
    42,
    0,
    0,
    0,
    8,
    0,
    1,
    0x01,
    0x12,
    0,
    3,
    0,
    0,
    0,
    1,
    0,
    value,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const length = exif.length + 2;
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, length >> 8, length & 255]), exif]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
}

async function openImages(page: Page, theme: 'light' | 'dark' = 'light') {
  await openPage(page, '/#/convert', { lang: 'nl', theme });
  await expect(page.getByRole('heading', { name: nl.convert.pickTitle })).toBeVisible();
}

const imagesList = (page: Page) => page.getByRole('list', { name: nl.convert.listLabel });

async function sizes(path: string) {
  const doc = await PDFDocument.load(readFileSync(path));
  return doc.getPages().map((p) => p.getSize());
}

/** De afmetingen (breedte, hoogte) uit het IHDR-blok van een PNG. */
const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

const isPng = (bytes: Uint8Array) => [0x89, 0x50, 0x4e, 0x47].every((b, i) => bytes[i] === b);
const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

test.describe('omzetten: afbeeldingen naar PDF', () => {
  test('maakt een PDF van een PNG en een JPEG, in de gekozen volgorde', async ({ page }) => {
    await openImages(page);
    await page.locator('#images-file').setInputFiles([
      {
        name: 'breed.png',
        mimeType: 'image/png',
        buffer: await makeImage(page, 'image/png', 300, 150),
      },
      {
        name: 'hoog.jpg',
        mimeType: 'image/jpeg',
        buffer: await makeImage(page, 'image/jpeg', 150, 300, '#c92c56'),
      },
    ]);
    await expect(imagesList(page).getByRole('listitem')).toHaveCount(2);
    await expect(page.getByRole('heading', { level: 2, name: '2 afbeeldingen' })).toBeVisible();

    // De staande afbeelding naar voren.
    await page.getByRole('button', { name: 'hoog.jpg omhoog' }).click();
    await expect(imagesList(page).getByRole('listitem').first()).toContainText('hoog.jpg');

    const download = await downloadVia(
      page,
      page.getByRole('button', { name: nl.convert.make }),
      'foto’s',
    );
    expect(download.suggestedFilename()).toBe('foto’s.pdf');
    const [first, second] = await sizes((await download.path())!);
    // "Passend": de pagina heeft de verhouding van de afbeelding.
    expect(first!.height / first!.width).toBeCloseTo(2, 1);
    expect(second!.width / second!.height).toBeCloseTo(2, 1);
  });

  test('met A4 en marge krijgt elke pagina een vast formaat', async ({ page }) => {
    await openImages(page);
    await page.locator('#images-file').setInputFiles([
      {
        name: 'a.png',
        mimeType: 'image/png',
        buffer: await makeImage(page, 'image/png', 300, 150),
      },
      {
        name: 'b.png',
        mimeType: 'image/png',
        buffer: await makeImage(page, 'image/png', 150, 300),
      },
    ]);
    await expect(imagesList(page).getByRole('listitem')).toHaveCount(2);
    await page.getByLabel(nl.convert.a4).check();
    await page.getByLabel(nl.convert.marginNormal).check();
    const download = await downloadVia(page, page.getByRole('button', { name: nl.convert.make }));
    expect(download.suggestedFilename()).toBe('afbeeldingen.pdf');
    const [first, second] = await sizes((await download.path())!);
    expect(first!.width).toBeCloseTo(841.89, 0);
    expect(first!.height).toBeCloseTo(595.28, 0);
    expect(second!.width).toBeCloseTo(595.28, 0);
    expect(second!.height).toBeCloseTo(841.89, 0);
  });

  test('een foto die op zijn kant is opgeslagen (EXIF) staat rechtop in de PDF', async ({
    page,
  }) => {
    await openImages(page);
    // 200 bij 100 beeldpunten opgeslagen, met de aanwijzing "90° rechtsom": bedoeld als staand.
    const landscape = await makeImage(page, 'image/jpeg', 200, 100);
    await page.locator('#images-file').setInputFiles({
      name: 'telefoon.jpg',
      mimeType: 'image/jpeg',
      buffer: withExifOrientation(landscape, 6),
    });
    await expect(imagesList(page).getByRole('listitem')).toHaveCount(1);
    const download = await downloadVia(page, page.getByRole('button', { name: nl.convert.make }));
    expect(download.suggestedFilename()).toBe('telefoon.pdf');
    const [size] = await sizes((await download.path())!);
    expect(size!.height).toBeGreaterThan(size!.width);
  });

  test('slaat bestanden over die geen JPG of PNG zijn, en laat de rest staan', async ({ page }) => {
    await openImages(page);
    await page.locator('#images-file').setInputFiles([
      { name: 'tekst.png', mimeType: 'image/png', buffer: Buffer.from('dit is geen afbeelding') },
      {
        name: 'goed.png',
        mimeType: 'image/png',
        buffer: await makeImage(page, 'image/png', 20, 20),
      },
    ]);
    await expect(imagesList(page).getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('alert')).toContainText(
      'tekst.png is geen JPG- of PNG-afbeelding en is overgeslagen.',
    );
  });

  test('verwijderen en alles wissen', async ({ page }) => {
    await openImages(page);
    await page.locator('#images-file').setInputFiles([
      { name: 'a.png', mimeType: 'image/png', buffer: await makeImage(page, 'image/png', 20, 20) },
      { name: 'b.png', mimeType: 'image/png', buffer: await makeImage(page, 'image/png', 20, 20) },
    ]);
    await page.getByRole('button', { name: 'a.png weghalen' }).click();
    await expect(imagesList(page).getByRole('listitem')).toHaveCount(1);
    await page.getByRole('button', { name: nl.document.close }).click();
    await expect(page.getByRole('heading', { name: nl.convert.pickTitle })).toBeVisible();
  });

  test('afbeeldingen sleep je naar een andere plek, en dat is ongedaan te maken', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Aanraken werkt via hetzelfde greepje als bij Samenvoegen (daar getest)');
    await openImages(page);
    await page.locator('#images-file').setInputFiles(
      await Promise.all(
        ['een', 'twee', 'drie'].map(async (name) => ({
          name: `${name}.png`,
          mimeType: 'image/png',
          buffer: await makeImage(page, 'image/png', 60, 40),
        })),
      ),
    );
    const items = imagesList(page).getByRole('listitem');
    const order = () => imagesList(page).locator('.merge-list__name').allTextContents();
    await expect(items).toHaveCount(3);
    await imagesList(page).evaluate((el) => el.scrollIntoView({ block: 'center' }));

    // Het greepje van de derde naar de bovenrand van de eerste.
    const grip = (await items.nth(2).locator('.drag-handle').boundingBox())!;
    const first = (await items.nth(0).boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 20, first.y + 6, { steps: 8 });
    await expect(
      imagesList(page).locator('.merge-list__item--drop-before, .merge-list__item--drop-after'),
    ).toHaveCount(1);
    await page.mouse.up();
    expect(await order()).toEqual(['drie.png', 'een.png', 'twee.png']);

    await page.getByRole('button', { name: nl.pages.undo }).click();
    expect(await order()).toEqual(['een.png', 'twee.png', 'drie.png']);
    await page.getByRole('button', { name: nl.pages.redo }).click();
    expect(await order()).toEqual(['drie.png', 'een.png', 'twee.png']);

    // De volgorde komt ook in de PDF: de eerste pagina is de staande afbeelding.
    const download = await downloadVia(page, page.getByRole('button', { name: nl.convert.make }));
    expect((await sizes((await download.path())!)).length).toBe(3);
  });

  test('op een telefoon staat de knop om de PDF te maken vast onderaan', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'Alleen voor de telefoonindeling');
    await openImages(page);
    await page.locator('#images-file').setInputFiles(
      await Promise.all(
        Array.from({ length: 8 }, async (_, i) => ({
          name: `foto-${i + 1}.png`,
          mimeType: 'image/png',
          buffer: await makeImage(page, 'image/png', 40, 40),
        })),
      ),
    );
    await expect(imagesList(page).getByRole('listitem')).toHaveCount(8);
    await imagesList(page).getByRole('listitem').last().scrollIntoViewIfNeeded();
    const make = page.getByRole('button', { name: nl.convert.make });
    const box = (await make.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(page.viewportSize()!.height - 20);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('omzetten: PDF naar afbeeldingen', () => {
  async function openPdf(page: Page, pages: number) {
    await openPage(page, '/#/convert', { lang: 'nl' });
    await page.getByRole('button', { name: nl.convert.toImages }).click();
    await page.locator('#pdf-file').setInputFiles(await pdfFile('rapport.pdf', pages));
    await expect(page.getByRole('list', { name: nl.merge.files })).toBeVisible({
      timeout: 15_000,
    });
  }

  test('alle pagina’s als PNG op 72 dpi, samen in een ZIP', async ({ page }) => {
    await openPdf(page, 3);
    await page.getByLabel(nl.convert.dpi72).check();
    const download = await downloadVia(
      page,
      page.getByRole('button', { name: '3 afbeeldingen downloaden (ZIP)' }),
    );
    expect(download.suggestedFilename()).toBe('rapport (afbeeldingen).zip');
    const files = unzipSync(new Uint8Array(readFileSync((await download.path())!)));
    expect(Object.keys(files)).toEqual([
      'rapport (pagina 1).png',
      'rapport (pagina 2).png',
      'rapport (pagina 3).png',
    ]);
    for (const bytes of Object.values(files)) {
      expect(isPng(bytes)).toBe(true);
      // A4 (595 × 842 punten) op 72 dpi is 595 × 842 beeldpunten.
      expect(pngSize(bytes)).toEqual({ width: 595, height: 842 });
    }
  });

  test('de resolutie bepaalt de grootte', async ({ page }) => {
    await openPdf(page, 1);
    // 150 dpi is de standaard.
    const download = await downloadVia(
      page,
      page.getByRole('button', { name: nl.convert.downloadOne }),
    );
    expect(download.suggestedFilename()).toBe('rapport (pagina 1).png');
    const bytes = new Uint8Array(readFileSync((await download.path())!));
    expect(isPng(bytes)).toBe(true);
    expect(pngSize(bytes)).toEqual({ width: 1240, height: 1754 });
  });

  test('één gekozen pagina als JPG, los gedownload', async ({ page }) => {
    await openPdf(page, 4);
    await page.getByLabel(nl.convert.jpeg).check();
    await page.getByLabel(nl.convert.dpi72).check();
    const field = page.getByLabel('Pagina’s kiezen uit rapport.pdf');
    await field.fill('2');
    await field.press('Enter');
    await expect(page.getByText(/Eén pagina wordt omgezet/).first()).toBeVisible();
    const download = await downloadVia(
      page,
      page.getByRole('button', { name: nl.convert.downloadOne }),
    );
    expect(download.suggestedFilename()).toBe('rapport (pagina 2).jpg');
    expect(isJpeg(new Uint8Array(readFileSync((await download.path())!)))).toBe(true);
  });

  test('het resultaat staat op een witte achtergrond', async ({ page }) => {
    await openPdf(page, 1);
    await page.getByLabel(nl.convert.dpi72).check();
    const download = await downloadVia(
      page,
      page.getByRole('button', { name: nl.convert.downloadOne }),
    );
    const bytes = readFileSync((await download.path())!);
    // Het beeld is zelf een PNG; laat de browser de linkerbovenhoek (de rand van de pagina) lezen.
    const pixel = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return [...context.getImageData(5, 5, 1, 1).data];
    }, bytes.toString('base64'));
    expect(pixel).toEqual([255, 255, 255, 255]);
  });

  test('zet meerdere PDF’s tegelijk om, met dezelfde lijst als Samenvoegen', async ({ page }) => {
    await openPage(page, '/#/convert', { lang: 'nl' });
    await page.getByRole('button', { name: nl.convert.toImages }).click();
    await page
      .locator('#pdf-file')
      .setInputFiles([await pdfFile('rapport.pdf', 2), await pdfFile('bijlage.pdf', 1)]);
    const list = page.getByRole('list', { name: nl.merge.files });
    await expect(list.getByRole('listitem')).toHaveCount(2, { timeout: 15_000 });
    await expect(page.getByText(/3 pagina’s worden omgezet/).first()).toBeVisible();

    // Een bestand toevoegen kan hier, zonder naar Samenvoegen te gaan.
    await page.locator('#merge-add').setInputFiles(await pdfFile('extra.pdf', 1));
    await expect(list.getByRole('listitem')).toHaveCount(3);
    await expect(page.getByText(/4 pagina’s worden omgezet/).first()).toBeVisible();

    // En de volgorde aanpassen: bijlage naar voren.
    await page.getByRole('button', { name: 'bijlage.pdf omhoog' }).click();
    await page.getByLabel(nl.convert.dpi72).check();
    const download = await downloadVia(
      page,
      page.getByRole('button', { name: '4 afbeeldingen downloaden (ZIP)' }),
    );
    const files = unzipSync(new Uint8Array(readFileSync((await download.path())!)));
    expect(Object.keys(files)).toEqual([
      '1 - bijlage (pagina 1).png',
      '2 - rapport (pagina 1).png',
      '3 - rapport (pagina 2).png',
      '4 - extra (pagina 1).png',
    ]);
    for (const bytes of Object.values(files)) expect(isPng(bytes)).toBe(true);
  });

  test('volgt de volgorde en de verwijderde pagina’s van Pagina’s', async ({ page }) => {
    await openPdf(page, 3);
    await page.getByLabel(nl.convert.dpi72).check();
    // Pagina 2 weghalen bij Pagina's en terugkomen: nog twee pagina's.
    await page.goto('./#/pages');
    await page.getByRole('option').nth(1).click();
    await page.getByRole('button', { name: nl.pages.remove }).click();
    await page.goto('./#/convert');
    await expect(page.getByText(/2 pagina’s worden omgezet/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: nl.convert.toImages })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

test.describe('omzetten: toegankelijkheid en wisselen', () => {
  test('de focus blijft op de gekozen knop als je wisselt', async ({ page }) => {
    await openImages(page);
    const toImages = page.getByRole('button', { name: nl.convert.toImages });
    await toImages.click();
    await expect(page.getByRole('heading', { name: nl.document.openTitle })).toBeVisible();
    await expect(page.getByRole('button', { name: nl.convert.toImages })).toBeFocused();
    await page.getByRole('button', { name: nl.convert.toPdf }).click();
    await expect(page.getByRole('button', { name: nl.convert.toPdf })).toBeFocused();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`de drie schermen zijn toegankelijk (${theme})`, async ({ page }) => {
      const check = async () => {
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        expect(
          result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
        ).toEqual([]);
      };

      await openImages(page, theme);
      await check();

      await page.locator('#images-file').setInputFiles([
        {
          name: 'a.png',
          mimeType: 'image/png',
          buffer: await makeImage(page, 'image/png', 60, 40),
        },
        {
          name: 'b.jpg',
          mimeType: 'image/jpeg',
          buffer: await makeImage(page, 'image/jpeg', 40, 60),
        },
      ]);
      await expect(imagesList(page).getByRole('listitem')).toHaveCount(2);
      await check();

      await page.getByRole('button', { name: nl.convert.toImages }).click();
      await page.locator('#pdf-file').setInputFiles(await pdfFile('rapport.pdf', 3));
      await expect(page.locator('.thumb[data-rendered="true"]').first()).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole('button', { name: nl.info }).click();
      await check();
    });
  }
});
