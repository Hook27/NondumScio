import { renderPageImage } from '../pdf/images';
import { closePdf, loadPdf } from '../pdf/loader';
import { linesFromWords } from './ocrLines';
import { linesFrom, type TextItem } from './recognize';

/** Hoeveel pagina's we lezen: in een brief staan datum, afzender en onderwerp bovenaan. */
const PAGES_TO_READ = 2;

/** Resolutie voor de tekstherkenning, zoals bij het zoeken in Redigeren. */
const OCR_DPI = 300;

/**
 * Leest de tekstlaag van de eerste pagina's van een PDF (bij een scan: de herkende tekst) als
 * regels. De PDF wordt daarna weer gesloten; het bestand zelf bewaart de tool voor het downloaden.
 */
export async function readLines(file: File): Promise<{ pageCount: number; lines: string[] }> {
  const { pdf, pageCount } = await loadPdf(new Uint8Array(await file.arrayBuffer()));
  try {
    const lines: string[] = [];
    for (let number = 1; number <= Math.min(pageCount, PAGES_TO_READ); number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      lines.push(...linesFrom(content.items as TextItem[]));
      page.cleanup();
    }
    return { pageCount, lines };
  } finally {
    closePdf(pdf);
  }
}

/** Leest scans zonder tekstlaag met tekstherkenning; één herkenner voor alle brieven. */
export type ScanReader = {
  /** De herkende tekst van de eerste pagina, als regels (leeg als er niets herkend werd). */
  read: (file: File) => Promise<string[]>;
  close: () => void;
};

/**
 * Opent de tekstherkenning (OCR) voor scans zonder tekstlaag. Alleen de eerste pagina wordt
 * herkend: daar staan datum, afzender en onderwerp, en elke pagina kost een paar seconden.
 * `onStatus` meldt hoever het laden is (de eerste keer duurt even).
 */
export async function openScanReader(onStatus?: (progress: number) => void): Promise<ScanReader> {
  const engine = await (await import('../pdf/ocr')).openOcr(onStatus);
  return {
    read: async (file) => {
      const { pdf } = await loadPdf(new Uint8Array(await file.arrayBuffer()));
      try {
        const { bytes } = await renderPageImage(pdf, 1, 0, {
          dpi: OCR_DPI,
          format: 'png',
          quality: 1,
        });
        return linesFromWords(await engine.recognize(bytes, OCR_DPI));
      } finally {
        closePdf(pdf);
      }
    },
    close: () => engine.close(),
  };
}

/** Het aantal pagina's van een PDF (voor een losse PDF bij het samenvoegen). */
export async function countPages(file: File): Promise<number> {
  const { pdf, pageCount } = await loadPdf(new Uint8Array(await file.arrayBuffer()));
  closePdf(pdf);
  return pageCount;
}
