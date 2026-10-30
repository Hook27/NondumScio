import { closePdf, loadPdf } from '../pdf/loader';
import { linesFrom, type TextItem } from './recognize';

/** Hoeveel pagina's we lezen: in een brief staan datum, afzender en onderwerp bovenaan. */
const PAGES_TO_READ = 2;

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
