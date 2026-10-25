import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, degrees, rgb } from 'pdf-lib';
import { pdfFile } from './fixtures';
import { downloadVia, messages, openPage } from './helpers';

const nl = messages.nl;

/** De pagina's uit `pdfFile` zijn A4: 595 × 842 punten. */
const PAGE_WIDTH = 595;

const pages = (page: Page) => page.locator('.annotate-page');
const annotations = (page: Page) => page.locator('[data-annotation]');

async function openEdit(page: Page, pageCount = 1, theme: 'light' | 'dark' = 'light') {
  await openPage(page, '/#/edit', { lang: 'nl', theme });
  await page.locator('#pdf-file').setInputFiles(await pdfFile('rapport.pdf', pageCount));
  await expect(pages(page).first()).toHaveAttribute('data-rendered', 'true', { timeout: 15_000 });
}

/** Het scherm als punten op de pagina: waar op het scherm staat punt (x, y) van pagina `index`? */
async function pointOn(page: Page, index: number, x: number, y: number) {
  const box = (await pages(page).nth(index).boundingBox())!;
  const scale = box.width / PAGE_WIDTH;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

async function chooseTool(page: Page, name: string) {
  await page
    .getByRole('toolbar', { name: nl.edit.toolbar })
    .getByRole('button', { name, exact: true })
    .click();
}

/** Sleept met de muis van de ene plek naar de andere (in punten op de pagina). */
async function drag(page: Page, from: [number, number], to: [number, number], pageIndex = 0) {
  // Een pagina verderop eerst bovenaan in beeld zetten.
  if (pageIndex > 0) {
    await pages(page)
      .nth(pageIndex)
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
  }
  const a = await pointOn(page, pageIndex, ...from);
  const b = await pointOn(page, pageIndex, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

async function typeText(page: Page, at: [number, number], text: string, pageIndex = 0) {
  await chooseTool(page, nl.edit.text);
  const point = await pointOn(page, pageIndex, ...at);
  await page.mouse.click(point.x, point.y);
  await page.keyboard.type(text);
  // Escape sluit het tekstveld af.
  await page.keyboard.press('Escape');
}

/** Rendert een PDF van één pagina op 72 dpi met de omzetter van de app zelf, en geeft de PNG. */
async function renderToPng(page: Page, pdf: Buffer): Promise<Buffer> {
  await openPage(page, '/#/convert', { lang: 'nl' });
  await page.getByRole('button', { name: nl.convert.toImages }).click();
  await page.locator('#pdf-file').setInputFiles({
    name: 'resultaat.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });
  await page.getByLabel(nl.convert.dpi72).check();
  const download = await downloadVia(
    page,
    page.getByRole('button', { name: nl.convert.downloadOne }),
  );
  return readFileSync((await download.path())!);
}

type Probe = {
  /** Punten waarvan we de kleur willen weten. */
  points?: [number, number][];
  /** Vakken waarin we donkere beeldpunten tellen. */
  dark?: { x: number; y: number; width: number; height: number }[];
};

/** Leest uit een PNG de kleur van punten en het aantal donkere beeldpunten in vakken. */
async function probe(page: Page, png: Buffer, { points = [], dark = [] }: Probe) {
  return page.evaluate(
    async ({ base64, points, dark }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return {
        size: { width: image.width, height: image.height },
        colors: points.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3)),
        dark: dark.map((box) => {
          const { data } = context.getImageData(box.x, box.y, box.width, box.height);
          let count = 0;
          for (let i = 0; i < data.length; i += 4) {
            if (data[i]! < 90 && data[i + 1]! < 90 && data[i + 2]! < 110) count += 1;
          }
          return count;
        }),
      };
    },
    { base64: png.toString('base64'), points, dark },
  );
}

/** De achtergrond van de testpagina binnen het blauwe vlak: (217, 230, 255). */
const BACKGROUND = [217, 230, 255];
const distance = (a: number[], b: number[]) =>
  a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0);

test.describe('annotaties: de weergave en het maken', () => {
  test('toont de pagina’s groot, en zoomen verandert de breedte', async ({ page }) => {
    await openEdit(page, 2);
    await expect(pages(page)).toHaveCount(2);
    const before = (await pages(page).first().boundingBox())!;
    expect(before.width).toBeGreaterThan(300);

    const toolbar = page.getByRole('toolbar', { name: nl.edit.toolbar });
    await toolbar.getByRole('button', { name: nl.edit.zoomIn }).click();
    await toolbar.getByRole('button', { name: nl.edit.zoomIn }).click();
    const bigger = (await pages(page).first().boundingBox())!;
    expect(bigger.width / before.width).toBeCloseTo(1.5, 1);
    await expect(pages(page).first()).toHaveAttribute('data-rendered', 'true');

    await toolbar.getByRole('button', { name: /terug naar paginabreedte/ }).click();
    const back = (await pages(page).first().boundingBox())!;
    expect(back.width).toBeCloseTo(before.width, 0);
    await toolbar.getByRole('button', { name: nl.edit.zoomOut }).click();
    expect((await pages(page).first().boundingBox())!.width / before.width).toBeCloseTo(0.75, 1);
  });

  test('uitzoomen geeft een overzicht: 2, 3 of 4 pagina’s naast elkaar', async ({ page }) => {
    await openEdit(page, 4);
    const toolbar = page.getByRole('toolbar', { name: nl.edit.toolbar });
    const row = async () => {
      const boxes = await pages(page).evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().top + window.scrollY)),
      );
      return boxes.filter((top) => top === boxes[0]).length;
    };
    expect(await row()).toBe(1);
    for (const [times, columns] of [
      [2, 2],
      [1, 3],
      [1, 4],
    ] as const) {
      for (let i = 0; i < times; i += 1) {
        await toolbar.getByRole('button', { name: nl.edit.zoomOut }).click();
      }
      await expect.poll(row).toBe(columns);
    }
    // Het overzicht blijft binnen het vak.
    const view = (await page.locator('.annotate-pages').boundingBox())!;
    const last = (await pages(page).last().boundingBox())!;
    expect(last.x + last.width).toBeLessThanOrEqual(view.x + view.width + 1);
  });

  test('de bestandslijst en de kop rechts zijn zoals bij Samenvoegen', async ({ page }) => {
    await openPage(page, '/#/edit', { lang: 'nl' });
    await page
      .locator('#pdf-file')
      .setInputFiles([await pdfFile('een.pdf', 2), await pdfFile('twee.pdf', 1)]);
    const list = page.getByRole('list', { name: nl.merge.files });
    await expect(list.getByRole('listitem')).toHaveCount(2, { timeout: 15_000 });
    await expect(list.locator('.drag-handle')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: nl.merge.result })).toBeVisible();
    await expect(pages(page)).toHaveCount(3);

    // Volgorde en weghalen werken hier ook, en alles samen is één ongedaan-maken-reeks.
    await page.getByRole('button', { name: 'twee.pdf omhoog' }).click();
    await expect(list.locator('.merge-list__name')).toHaveText(['twee.pdf', 'een.pdf']);
    await page.keyboard.press('r');
    await pages(page).first().focus();
    await page.keyboard.press('Enter');
    await expect(annotations(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'een.pdf weghalen' }).click();
    await expect(pages(page)).toHaveCount(1);

    const undo = page.getByRole('button', { name: nl.pages.undo });
    await undo.click();
    await expect(pages(page)).toHaveCount(3);
    await undo.click();
    await expect(annotations(page)).toHaveCount(0);
    await undo.click();
    await expect(list.locator('.merge-list__name')).toHaveText(['een.pdf', 'twee.pdf']);
    await expect(undo).toBeDisabled();
  });

  test('tekst plaatsen, aanpassen en weghalen', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Precies klikken op de pagina: desktop (op een telefoon: aparte test)');
    await openEdit(page);
    await typeText(page, [100, 100], 'Hallo wereld');
    await expect(annotations(page)).toHaveCount(1);
    await expect(annotations(page).first()).toHaveAccessibleName('Tekst: Hallo wereld');
    await expect(page.getByText('1 annotatie')).toBeVisible();

    // Dubbelklikken (of Enter) brengt hem weer in het tekstveld.
    await chooseTool(page, nl.edit.select);
    await annotations(page).first().focus();
    await page.keyboard.press('Enter');
    const field = page.getByRole('textbox', { name: nl.edit.textLabel });
    await expect(field).toBeFocused();
    await field.fill('Gedag');
    await page.keyboard.press('Escape');
    await expect(annotations(page).first()).toHaveAccessibleName('Tekst: Gedag');

    // Leeg maken haalt hem weg.
    await annotations(page).first().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: nl.edit.textLabel }).fill('');
    await page.keyboard.press('Escape');
    await expect(annotations(page)).toHaveCount(0);
  });

  test('markeren, rechthoek en lijn teken je door te slepen; een klik zonder slepen doet niets', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Precies slepen op de pagina: desktop');
    await openEdit(page);
    await chooseTool(page, nl.edit.highlight);
    await drag(page, [100, 150], [300, 190]);
    await chooseTool(page, nl.edit.rect);
    await drag(page, [320, 100], [500, 180]);
    await chooseTool(page, nl.edit.line);
    await drag(page, [100, 230], [500, 260]);
    await expect(annotations(page)).toHaveCount(3);
    await expect(annotations(page).nth(0)).toHaveAccessibleName(nl.edit.highlightOf);
    await expect(annotations(page).nth(1)).toHaveAccessibleName(nl.edit.rectOf);
    await expect(annotations(page).nth(2)).toHaveAccessibleName(nl.edit.lineOf);

    // Een klik is geen tekening.
    const point = await pointOn(page, 0, 400, 300);
    await page.mouse.click(point.x, point.y);
    await expect(annotations(page)).toHaveCount(3);
  });

  test('ongedaan maken en opnieuw, ook met Ctrl+Z', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Precies slepen op de pagina: desktop');
    await openEdit(page);
    const undo = page.getByRole('button', { name: nl.pages.undo });
    const redo = page.getByRole('button', { name: nl.pages.redo });
    await expect(undo).toBeDisabled();
    await chooseTool(page, nl.edit.rect);
    await drag(page, [100, 100], [200, 160]);
    await drag(page, [250, 100], [350, 160]);
    await expect(annotations(page)).toHaveCount(2);

    await undo.click();
    await expect(annotations(page)).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(annotations(page)).toHaveCount(0);
    await expect(undo).toBeDisabled();
    await redo.click();
    await page.keyboard.press('Control+y');
    await expect(annotations(page)).toHaveCount(2);
    await expect(redo).toBeDisabled();
  });

  test('selecteren, verplaatsen, vergroten en verwijderen', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Precies slepen op de pagina: desktop');
    await openEdit(page);
    await chooseTool(page, nl.edit.rect);
    await drag(page, [100, 100], [200, 160]);
    await chooseTool(page, nl.edit.select);

    const shape = annotations(page).first();
    const before = (await shape.locator('rect').first().boundingBox())!;
    // Verplaatsen: aan het midden pakken en 50 punten naar rechts en 30 omlaag.
    await drag(page, [150, 130], [200, 160]);
    const after = (await shape.locator('rect').first().boundingBox())!;
    const scale = (await pages(page).first().boundingBox())!.width / PAGE_WIDTH;
    expect(after.x - before.x).toBeCloseTo(50 * scale, 0);
    expect(after.y - before.y).toBeCloseTo(30 * scale, 0);

    // Vergroten: het rechteronderhoekpunt (hoek 3) 40 punten verder.
    const handle = page.locator('[data-handle="3"]');
    await expect(handle).toBeVisible();
    const grip = (await handle.boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + 40 * scale, grip.y + grip.height / 2, {
      steps: 6,
    });
    await page.mouse.up();
    const grown = (await shape.locator('rect').first().boundingBox())!;
    expect(grown.width - after.width).toBeCloseTo(40 * scale, 0);
    expect(grown.height).toBeCloseTo(after.height, 0);

    // Ongedaan maken: eerst de grootte, dan de plek.
    await page.getByRole('button', { name: nl.pages.undo }).click();
    expect((await shape.locator('rect').first().boundingBox())!.width).toBeCloseTo(after.width, 0);

    // Verwijderen met de knop en met Delete.
    await page.getByRole('button', { name: nl.edit.remove }).click();
    await expect(annotations(page)).toHaveCount(0);
    await page.getByRole('button', { name: nl.pages.undo }).click();
    await expect(annotations(page)).toHaveCount(1);
    await annotations(page).first().focus();
    await page.keyboard.press('Delete');
    await expect(annotations(page)).toHaveCount(0);
  });

  test('met het toetsenbord: gereedschap kiezen, plaatsen met Enter, verschuiven en verwijderen', async ({
    page,
  }) => {
    await openEdit(page);
    await page.keyboard.press('r');
    await expect(page.getByRole('button', { name: nl.edit.rect, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await pages(page).first().focus();
    await page.keyboard.press('Enter');
    await expect(annotations(page)).toHaveCount(1);

    const shape = annotations(page).first();
    await shape.focus();
    const before = (await shape.locator('rect').first().boundingBox())!;
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const after = (await shape.locator('rect').first().boundingBox())!;
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y + 5);
    // Alle pijltjes achter elkaar zijn één stap om ongedaan te maken.
    await page.getByRole('button', { name: nl.pages.undo }).click();
    expect((await shape.locator('rect').first().boundingBox())!.x).toBeCloseTo(before.x, 0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: nl.edit.select, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await shape.focus();
    await page.keyboard.press('Backspace');
    await expect(annotations(page)).toHaveCount(0);
  });

  test('kleur, lettergrootte en dikte horen bij het gereedschap en bij wat geselecteerd is', async ({
    page,
  }) => {
    await openEdit(page);
    await page.keyboard.press('r');
    await pages(page).first().focus();
    await page.keyboard.press('Enter');
    const shape = annotations(page).first();
    await expect(page.getByRole('button', { name: nl.edit.colors.red })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: nl.edit.colors.blue }).click();
    await expect(shape.locator('rect').first()).toHaveAttribute('stroke', '#2c56c9');
    const widthOf = async () =>
      Number(await shape.locator('rect').first().getAttribute('stroke-width'));
    const thin = await widthOf();
    await page.getByLabel(nl.edit.strokeWidth).selectOption('6');
    // 6 punten is drie keer zo dik als de standaard van 2, hoe groot de pagina ook is.
    expect((await widthOf()) / thin).toBeCloseTo(3, 1);

    // Het volgende vak krijgt de gekozen kleur al.
    await page.keyboard.press('Escape');
    await page.keyboard.press('r');
    await pages(page).first().focus();
    await page.keyboard.press('Enter');
    await expect(annotations(page).nth(1).locator('rect').first()).toHaveAttribute(
      'stroke',
      '#2c56c9',
    );

    // Tekst: de lettergrootte.
    await page.keyboard.press('Escape');
    await page.keyboard.press('t');
    await expect(page.getByLabel(nl.edit.textSize)).toBeVisible();
    await expect(page.getByLabel(nl.edit.strokeWidth)).toHaveCount(0);
  });

  test('meldt tekens die niet getekend kunnen worden', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Precies klikken op de pagina: desktop');
    await openEdit(page);
    await typeText(page, [100, 100], 'prijs 5 € en α');
    await expect(
      page.getByRole('status').filter({ hasText: 'worden een vraagteken: α' }),
    ).toBeVisible();
  });
});

test.describe('annotaties: het resultaat in de PDF', () => {
  async function download(page: Page) {
    const file = await downloadVia(page, page.getByRole('button', { name: nl.pages.save }));
    return readFileSync((await file.path())!);
  }

  test('tekst, markering, rechthoek en lijn staan echt in de PDF, op de plek van het scherm', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Precies slepen op de pagina: desktop');
    await openEdit(page);
    await typeText(page, [100, 100], 'Hallo wereld');
    await chooseTool(page, nl.edit.highlight);
    await drag(page, [100, 150], [300, 190]);
    await chooseTool(page, nl.edit.rect);
    await page.getByLabel(nl.edit.strokeWidth).selectOption('4');
    await drag(page, [320, 100], [500, 180]);
    await chooseTool(page, nl.edit.line);
    await drag(page, [100, 230], [500, 260]);
    await expect(annotations(page)).toHaveCount(4);

    const result = await download(page);
    // Eerst: er is echt iets in de PDF veranderd, en het is nog steeds één pagina.
    expect((await PDFDocument.load(result)).getPageCount()).toBe(1);

    const png = await renderToPng(page, result);
    const seen = await probe(page, png, {
      points: [
        [200, 170], // midden van de markering
        [320, 140], // de linkerrand van de rechthoek
        [300, 245], // midden van de lijn
        [400, 140], // binnen de rechthoek: leeg
        [200, 280], // onder de lijn: leeg
      ],
      dark: [{ x: 100, y: 88, width: 110, height: 30 }],
    });
    expect(seen.size).toEqual({ width: 595, height: 842 });
    const [highlight, border, line, inside, empty] = seen.colors as [
      number[],
      number[],
      number[],
      number[],
      number[],
    ];
    // Een gele markering over lichtblauw: minder blauw, nog steeds licht.
    expect(highlight![2]).toBeLessThan(200);
    expect(highlight![0]).toBeGreaterThan(200);
    // De rand en de lijn zijn rood (duidelijk anders dan de achtergrond, met veel rood).
    expect(distance(border!, BACKGROUND)).toBeGreaterThan(60);
    expect(border![0]!).toBeGreaterThan(border![2]!);
    expect(distance(line!, BACKGROUND)).toBeGreaterThan(40);
    expect(line![0]!).toBeGreaterThan(line![2]!);
    // Een rechthoek is alleen een rand: binnenin blijft de achtergrond.
    expect(distance(inside!, BACKGROUND)).toBeLessThan(20);
    expect(distance(empty!, BACKGROUND)).toBeLessThan(20);
    // En de tekst staat waar hij hoort: veel donkere beeldpunten in het tekstgebied.
    expect(seen.dark[0]).toBeGreaterThan(30);
  });

  test('bij een in het bestand gedraaide pagina staan de annotaties ook op de plek van het scherm', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Precies slepen op de pagina: desktop');
    // Een pagina van 600 × 800 met /Rotate 90, en rechtsboven (zoals je hem ziet) een rood blok.
    const doc = await PDFDocument.create();
    const rotated = doc.addPage([600, 800]);
    rotated.setRotation(degrees(90));
    rotated.drawRectangle({ x: 0, y: 0, width: 800, height: 800, color: rgb(0.85, 0.9, 1) });
    rotated.drawRectangle({ x: 20, y: 20, width: 80, height: 80, color: rgb(0.8, 0, 0) });
    await openPage(page, '/#/edit', { lang: 'nl' });
    await page.locator('#pdf-file').setInputFiles({
      name: 'gedraaid.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    });
    await expect(pages(page).first()).toHaveAttribute('data-rendered', 'true', { timeout: 15_000 });

    // Op het scherm is de pagina 800 breed en 600 hoog. Markeer iets linksboven in beeld.
    const box = (await pages(page).first().boundingBox())!;
    const scale = box.width / 800;
    await chooseTool(page, nl.edit.highlight);
    const from = { x: box.x + 200 * scale, y: box.y + 100 * scale };
    const to = { x: box.x + 400 * scale, y: box.y + 160 * scale };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await expect(annotations(page)).toHaveCount(1);

    const png = await renderToPng(page, await download(page));
    const seen = await probe(page, png, {
      points: [
        [300, 130],
        [300, 300],
        [100, 100],
      ],
    });
    expect(seen.size).toEqual({ width: 800, height: 600 });
    // De markering (geel over lichtblauw) staat op dezelfde plek als op het scherm.
    const [marked, plain] = seen.colors as [number[], number[], number[]];
    expect(marked![2]).toBeLessThan(200);
    expect(distance(plain!, BACKGROUND)).toBeLessThan(20);
  });

  test('draai je de pagina bij Pagina’s, dan draaien de annotaties mee', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Precies slepen op de pagina: desktop');
    await openEdit(page);
    await chooseTool(page, nl.edit.highlight);
    await drag(page, [100, 150], [300, 190]);
    await expect(annotations(page)).toHaveCount(1);

    // Naar Pagina's (het document blijft open), een kwartslag rechtsom, en daar downloaden.
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.pages.title }).click();
    await page.getByRole('option').first().click();
    await page.getByRole('button', { name: nl.pages.rotateRight }).click();
    const file = await downloadVia(page, page.getByRole('button', { name: nl.pages.save }));
    const png = await renderToPng(page, readFileSync((await file.path())!));

    // Het midden van de markering was (200, 170). Een kwartslag rechtsom: (842 − 170, 200).
    const seen = await probe(page, png, {
      points: [
        [842 - 170, 200],
        [200, 170],
      ],
    });
    expect(seen.size).toEqual({ width: 842, height: 595 });
    const [marked, elsewhere] = seen.colors as [number[], number[]];
    expect(marked![2]).toBeLessThan(200);
    expect(distance(elsewhere!, BACKGROUND)).toBeLessThan(60);
  });

  test('annotaties gaan mee bij Samenvoegen en Splitsen', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Precies slepen op de pagina: desktop');
    await openEdit(page, 2);
    await chooseTool(page, nl.edit.highlight);
    await drag(page, [100, 150], [300, 190], 1);
    await expect(annotations(page)).toHaveCount(1);

    /** Hoe veel er op een pagina getekend wordt: de grootte van zijn inhoud. */
    const contentSize = async (bytes: Buffer, index: number) =>
      (await PDFDocument.load(bytes)).getPage(index).node.Contents()?.toString().length;

    // Bij Samenvoegen downloaden: alleen pagina 2 heeft de markering.
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.merge.title }).click();
    const merged = await downloadVia(page, page.getByRole('button', { name: nl.merge.download }));
    const result = readFileSync((await merged.path())!);
    expect((await PDFDocument.load(result)).getPageCount()).toBe(2);
    expect(await contentSize(result, 1)).not.toBe(await contentSize(result, 0));

    // Bij Splitsen (per pagina): deel 2 heeft de markering, deel 1 niet.
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.split.title }).click();
    const part = async (n: number) => {
      const file = await downloadVia(
        page,
        page.getByRole('button', { name: `Deel ${n} downloaden` }),
      );
      return readFileSync((await file.path())!);
    };
    const [one, two] = [await part(1), await part(2)];
    expect(await contentSize(two, 0)).not.toBe(await contentSize(one, 0));
  });

  test('een weggehaalde pagina neemt zijn annotaties niet mee', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Precies slepen op de pagina: desktop');
    await openEdit(page, 2);
    await chooseTool(page, nl.edit.highlight);
    await drag(page, [100, 150], [300, 190], 1);
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.pages.title }).click();
    await page.getByRole('option').nth(1).click();
    await page.getByRole('button', { name: nl.pages.remove }).click();
    const file = await downloadVia(page, page.getByRole('button', { name: nl.pages.save }));
    const result = readFileSync((await file.path())!);
    const doc = await PDFDocument.load(result);
    expect(doc.getPageCount()).toBe(1);
    // Terug bij Bewerken staat de annotatie er niet meer (de pagina is weg), en ongedaan maken
    // bij Pagina's brengt pagina én annotatie terug.
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.edit.title }).click();
    await expect(annotations(page)).toHaveCount(0);
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.pages.title }).click();
    await page.getByRole('button', { name: nl.pages.undo }).click();
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.edit.title }).click();
    await expect(annotations(page)).toHaveCount(1);
  });
});

test.describe('annotaties: andere taken', () => {
  test('Omzetten meldt dat annotaties niet in de afbeeldingen komen', async ({ page }) => {
    await openEdit(page);
    await page.keyboard.press('r');
    await pages(page).first().focus();
    await page.keyboard.press('Enter');
    await expect(annotations(page)).toHaveCount(1);
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.convert.title }).click();
    // Er staat al een PDF open: Omzetten begint bij "PDF naar afbeeldingen".
    await expect(page.getByText(nl.convert.noAnnotations)).toBeVisible();
  });

  test('Pagina’s toont annotaties als niet gedownload, tot je downloadt', async ({ page }) => {
    await openEdit(page);
    await page.keyboard.press('h');
    await pages(page).first().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('navigation').getByRole('link', { name: nl.tasks.pages.title }).click();
    await expect(page.getByText(nl.pages.unsaved)).toBeVisible();
    const file = await downloadVia(page, page.getByRole('button', { name: nl.pages.save }));
    expect((await file.path())!).toBeTruthy();
    await expect(page.getByText(nl.pages.unsaved)).toBeHidden();
  });
});

test.describe('annotaties: op een telefoon en toegankelijkheid', () => {
  test('op een telefoon is alles bereikbaar: gereedschappen, pagina en vaste downloadknop', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'Alleen voor de telefoonindeling');
    await openEdit(page);
    const toolbar = page.getByRole('toolbar', { name: nl.edit.toolbar });
    await expect(toolbar.getByRole('button', { name: nl.edit.text, exact: true })).toBeVisible();
    const save = page.getByRole('button', { name: nl.pages.save });
    const box = (await save.boundingBox())!;
    expect(box.y + box.height).toBeGreaterThan(page.viewportSize()!.height - 20);
    expect(box.height).toBeGreaterThanOrEqual(44);

    // Een annotatie met het toetsenbord plaatsen werkt ook hier (zonder precies te hoeven tikken).
    await page.keyboard.press('h');
    await pages(page).first().focus();
    await page.keyboard.press('Enter');
    await expect(annotations(page)).toHaveCount(1);
    // De pagina past op het scherm, zonder zijwaarts scrollen.
    const view = (await pages(page).first().boundingBox())!;
    expect(view.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
  });

  test('met een tik plaats je tekst en teken je een vak (aanraken)', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Alleen voor de telefoonindeling');
    await openEdit(page);
    // Eerst het gereedschap kiezen: dan verschijnen de opties en schuift de pagina op.
    await page.keyboard.press('r');
    await pages(page).first().scrollIntoViewIfNeeded();
    const box = (await pages(page).first().boundingBox())!;
    const y = Math.min(box.y + 120, page.viewportSize()!.height - 150);
    // Een vak met de aanraakgebaren van Playwright: touchscreen.tap plaatst niets (geen slepen),
    // dus slepen we met de muis zoals de browser dat op aanraken vertaalt.
    await page.mouse.move(box.x + 60, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, y + 50, { steps: 6 });
    await page.mouse.up();
    await expect(annotations(page)).toHaveCount(1);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`het scherm met annotaties is toegankelijk (${theme})`, async ({ page }) => {
      await openEdit(page, 2, theme);
      for (const key of ['t', 'h', 'r', 'l']) {
        await page.keyboard.press(key);
        await pages(page).first().focus();
        await page.keyboard.press('Enter');
        if (key === 't') {
          await page.keyboard.type('Voorbeeld');
          await page.keyboard.press('Escape');
        }
      }
      await expect(annotations(page)).toHaveCount(4);
      await page.getByRole('button', { name: nl.info }).click();
      const result = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(
        result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
      ).toEqual([]);
    });
  }
});
