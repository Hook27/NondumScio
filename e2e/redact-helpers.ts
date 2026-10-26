import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { downloadVia, messages, openPage } from './helpers';

/** Hulpfuncties voor de tests van Redigeren (redact.spec.ts) en Zoeken (redact-search.spec.ts). */

const nl = messages.nl;

export const PAGE_WIDTH = 595;

export const pages = (page: Page) => page.locator('.annotate-page');

/** Opent Redigeren met een PDF en wacht tot de eerste pagina getekend is. */
export async function openRedactWith(
  page: Page,
  pdf: Buffer,
  theme: 'light' | 'dark' = 'light',
  name = 'rapport.pdf',
) {
  await openPage(page, '/#/redact', { lang: 'nl', theme });
  await page.locator('#pdf-file').setInputFiles({ name, mimeType: 'application/pdf', buffer: pdf });
  await expect(pages(page).first()).toHaveAttribute('data-rendered', 'true', { timeout: 15_000 });
}

export async function pointOn(page: Page, index: number, x: number, y: number, width = PAGE_WIDTH) {
  const box = (await pages(page).nth(index).boundingBox())!;
  const scale = box.width / width;
  return { x: box.x + x * scale, y: box.y + y * scale };
}

export async function drag(
  page: Page,
  from: [number, number],
  to: [number, number],
  pageIndex = 0,
  width = PAGE_WIDTH,
) {
  if (pageIndex > 0) {
    await pages(page)
      .nth(pageIndex)
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
  }
  const a = await pointOn(page, pageIndex, ...from, width);
  const b = await pointOn(page, pageIndex, ...to, width);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

export const download = async (page: Page) => {
  const file = await downloadVia(page, page.getByRole('button', { name: nl.pages.save }));
  return readFileSync((await file.path())!);
};

/** De tekst per pagina, met pdf.js zoals een andere lezer dat zou doen. */
export async function textOf(bytes: Buffer): Promise<string[]> {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const result: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    result.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  await pdf.loadingTask.destroy();
  return result;
}

/** Alles wat een bestand verraadt: ruwe bytes, uitgepakte stromen en de tekst van elk object. */
async function everything(bytes: Buffer): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const parts = [bytes.toString('latin1')];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    parts.push(String(object));
    if (object instanceof PDFRawStream) {
      try {
        parts.push(Buffer.from(decodePDFRawStream(object).decode()).toString('latin1'));
      } catch {
        // Binair: de ruwe bytes zijn al meegenomen.
      }
    }
  }
  return parts.join('\n');
}

const hex = (text: string) =>
  [...text].map((char) => char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');

/** Of ergens in het bestand het geheim staat: als gewone tekst, als hex of als UTF-16. */
export async function leaks(bytes: Buffer, secret: string): Promise<boolean> {
  const all = (await everything(bytes)).toUpperCase();
  const utf16 = [...secret]
    .map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'))
    .join('');
  return all.includes(secret.toUpperCase()) || all.includes(hex(secret)) || all.includes(utf16);
}

/** Rendert de eerste (of enige) pagina met de omzetter van de app op 72 dpi en leest pixels. */
export async function pixels(page: Page, pdf: Buffer, points: [number, number][]) {
  await openPage(page, '/#/convert', { lang: 'nl' });
  await page.getByRole('button', { name: nl.convert.toImages }).click();
  await page.locator('#pdf-file').setInputFiles({
    name: 'resultaat.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  });
  await page.getByLabel(nl.convert.dpi72).check();
  const file = await downloadVia(
    page,
    page.getByRole('button', { name: /afbeelding(en)? downloaden/i }),
  );
  const path = (await file.path())!;
  const bytes = file.suggestedFilename().endsWith('.zip')
    ? Buffer.from(Object.values(unzipSync(new Uint8Array(readFileSync(path))))[0]!)
    : readFileSync(path);
  return page.evaluate(
    async ({ base64, points }) => {
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
      };
    },
    { base64: bytes.toString('base64'), points },
  );
}

export const isBlack = (color: number[]) => color.every((value) => value < 12);
