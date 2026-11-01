import { renderPageImage } from '../pdf/images';
import { closePdf, loadPdf } from '../pdf/loader';
import { piecesFrom, type PageText, type RawTextItem } from './layout';
import type { DocInfo } from './profile';

/** Resolutie van het plaatje van de eerste pagina (klein, alleen om te herkennen). */
const THUMB_DPI = 24;

/**
 * Leest de tekstlaag van alle pagina's van een PDF, met de maat van elke pagina, de gegevens van
 * het document (metadata) en een klein plaatje van de eerste pagina. `onProgress` meldt hoeveel
 * pagina's er gelezen zijn. De PDF wordt daarna weer gesloten; het bestand zelf bewaart de tool.
 */
export async function readPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<{ pageCount: number; pages: PageText[]; info: DocInfo; thumb: Uint8Array | null }> {
  const { pdf, pageCount } = await loadPdf(new Uint8Array(await file.arrayBuffer()));
  try {
    const pages: PageText[] = [];
    for (let no = 1; no <= pageCount; no += 1) {
      const page = await pdf.getPage(no);
      const { width, height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({ no, w: width, h: height, ...piecesFrom(content.items as RawTextItem[]) });
      page.cleanup();
      onProgress?.(no, pageCount);
    }
    // Zonder gegevens of plaatje werkt het vergelijken net zo goed.
    const info = await pdf
      .getMetadata()
      .then((metadata) => metadata.info as DocInfo)
      .catch(() => ({}));
    const thumb = await renderPageImage(pdf, 1, 0, { dpi: THUMB_DPI, format: 'png', quality: 1 })
      .then((image) => image.bytes)
      .catch(() => null);
    return { pageCount, pages, info, thumb };
  } finally {
    closePdf(pdf);
  }
}
