import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TEXT_OPTIONS, extractText, zoneItems, type Zone } from '../text/extract';
import { readPdf } from './readPdf';

// De echte pdf.js (de uitvoering voor Node), zodat ook de omrekening van pdf.js zelf getest wordt.
vi.mock('../pdf/loader', async (importOriginal) => {
  const original = await importOriginal<typeof import('../pdf/loader')>();
  const loadPdf = async (bytes: Uint8Array) => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      import.meta.url,
    ).href;
    const pdf = await pdfjs.getDocument({ data: bytes, verbosity: 0 }).promise;
    return { pdf, pageCount: pdf.numPages };
  };
  return {
    ...original,
    loadPdf,
    // Het echte inlezen van het bestand (met herkansing), en dan pdf.js voor Node.
    openPdfFile: async (file: File) => loadPdf(await original.readPdfBytes(file)),
    closePdf: (pdf: { loadingTask: { destroy: () => Promise<void> } }) =>
      void pdf.loadingTask.destroy(),
  };
});

const LINES = ['Eerste regel', 'Tweede regel', 'Derde regel'];
const W = 600;
const H = 800;

/**
 * Een pagina van 600 × 800 punten met "draai `rotation`°", waarop drie regels rechtop staan zoals
 * je ze ziet: links, vlak onder de bovenkant (60 punten van links, 80/120/160 van boven).
 */
async function rotatedPdf(rotation: 0 | 90 | 180 | 270) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([W, H]);
  page.setRotation(degrees(rotation));
  // Van wat je ziet (vanaf linksboven) terug naar de punten van de PDF zelf.
  const toPdf = (vx: number, vy: number): [number, number] =>
    rotation === 0
      ? [vx, H - vy]
      : rotation === 90
        ? [vy, vx]
        : rotation === 180
          ? [W - vx, vy]
          : [W - vy, H - vx];
  LINES.forEach((line, i) => {
    const [x, y] = toPdf(60, 80 + i * 40);
    page.drawText(line, { x, y, size: 20, font, rotate: degrees(rotation) });
  });
  return new File([(await doc.save()) as BlobPart], 'gedraaid.pdf', { type: 'application/pdf' });
}

/** Een pagina waarvan de zichtbare uitsnede rechtsboven begint (300 × 400 vanaf 300, 400). */
async function croppedPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([W, H]);
  page.setCropBox(300, 400, 300, 400);
  LINES.forEach((line, i) => {
    page.drawText(line, { x: 320, y: 760 - i * 40, size: 20, font });
  });
  return new File([(await doc.save()) as BlobPart], 'uitsnede.pdf', { type: 'application/pdf' });
}

const TOP: Zone = { x0: 0, y0: 0, x1: 1, y1: 0.5 };
const BOTTOM: Zone = { x0: 0, y0: 0.5, x1: 1, y1: 1 };

describe('readPdf: tekst staat waar je hem ziet', () => {
  it.each([0, 90, 180, 270] as const)(
    'een pagina met draai %i°: de regels in de goede volgorde, en in het vak waar ze staan',
    async (rotation) => {
      const { pages } = await readPdf(await rotatedPdf(rotation), undefined, { thumb: false });
      const [page] = pages;
      // De maat zoals je de pagina ziet.
      expect([page!.w, page!.h]).toEqual(rotation % 180 ? [H, W] : [W, H]);
      expect(zoneItems(page!, TOP).map((item) => item.str)).toEqual(LINES);
      expect(zoneItems(page!, BOTTOM)).toEqual([]);
      // Elke regel op zijn eigen hoogte, van boven naar beneden; links begint op 60 punten.
      expect(page!.items.map((item) => Math.round(item.x))).toEqual([60, 60, 60]);
      const tops = page!.items.map((item) => Math.round(page!.h - item.y));
      expect(tops).toEqual([80, 120, 160]);
      const { text } = extractText(pages, { ...DEFAULT_TEXT_OPTIONS, joinLines: false });
      expect(text).toMatch(/Eerste regel\s+Tweede regel\s+Derde regel/);
    },
  );

  it('een pagina waarvan de uitsnede niet linksonder begint', async () => {
    const { pages } = await readPdf(await croppedPdf(), undefined, { thumb: false });
    const [page] = pages;
    expect([page!.w, page!.h]).toEqual([300, 400]);
    expect(page!.items.map((item) => [Math.round(item.x), Math.round(item.y)])).toEqual([
      [20, 360],
      [20, 320],
      [20, 280],
    ]);
    expect(zoneItems(page!, TOP).map((item) => item.str)).toEqual(LINES);
  });
});
