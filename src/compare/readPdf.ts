import type { PDFDocumentProxy } from 'pdfjs-dist';
import { fingerprintOf } from '../lib/fingerprint';
import { renderPageImage } from '../pdf/images';
import { closePdf, loadPdf, readPdfBytes } from '../pdf/loader';
import { piecesFrom, type PageText, type RawTextItem } from './layout';
import type { DocInfo } from './profile';

/** Resolutie van het plaatje van de eerste pagina (klein, alleen om te herkennen). */
const THUMB_DPI = 24;

/**
 * Leest de tekstlaag van alle pagina's van een PDF, met de maat van elke pagina, de gegevens van
 * het document (metadata) en een klein plaatje van de eerste pagina. `onProgress` meldt hoeveel
 * pagina's er gelezen zijn. De PDF wordt daarna weer gesloten; het bestand zelf bewaart de tool.
 * Met `thumb: false` geen plaatje (bijvoorbeeld bij een batch van PDF → Platte tekst). Met
 * `fingerprint: true` ook een vingerafdruk van de inhoud (zie `lib/fingerprint.ts`), om te weten of
 * het dezelfde PDF is als eerder; null als dat niet kan. Met `keepOpen: true` blijft de PDF open en
 * komt hij mee terug (`pdf`), zodat het voorbeeld het bestand niet opnieuw hoeft te lezen (zie
 * `shareVisual`); wie hem krijgt, sluit hem ook. Mislukt het lezen, dan gaat hij altijd dicht.
 */
export async function readPdf(
  file: File,
  onProgress?: (done: number, total: number) => void,
  {
    thumb: withThumb = true,
    fingerprint: withFingerprint = false,
    keepOpen = false,
  }: { thumb?: boolean; fingerprint?: boolean; keepOpen?: boolean } = {},
): Promise<{
  pageCount: number;
  pages: PageText[];
  info: DocInfo;
  thumb: Uint8Array | null;
  fingerprint: string | null;
  /** De nog geopende PDF, alleen met `keepOpen`. */
  pdf: PDFDocumentProxy | null;
}> {
  const bytes = await readPdfBytes(file);
  // Vóór het openen: pdf.js neemt de bytes daarna over (en ze kunnen dan leeg zijn).
  const fingerprint = withFingerprint ? await fingerprintOf(bytes) : null;
  const { pdf, pageCount } = await loadPdf(bytes);
  let kept = false;
  try {
    const pages: PageText[] = [];
    for (let no = 1; no <= pageCount; no += 1) {
      const page = await pdf.getPage(no);
      const viewport = page.getViewport({ scale: 1 });
      const { width, height } = viewport;
      const content = await page.getTextContent();
      // De plek van de tekst zoals je de pagina ziet: met haar draaiing en uitsnede (zoals bij
      // Redigeren, `search/source.ts`), en dan in punten vanaf linksonder. Een gewone pagina (geen
      // draaiing, uitsnede vanaf linksonder) blijft precies zoals hij was.
      const plain =
        page.rotate % 360 === 0 && viewport.viewBox[0] === 0 && viewport.viewBox[1] === 0;
      const toPage = plain
        ? undefined
        : (x: number, y: number): [number, number] => {
            const [vx, vy] = viewport.convertToViewportPoint(x, y) as [number, number];
            return [vx, height - vy];
          };
      pages.push({
        no,
        w: width,
        h: height,
        ...piecesFrom(content.items as RawTextItem[], toPage),
      });
      page.cleanup();
      onProgress?.(no, pageCount);
    }
    // Zonder gegevens of plaatje werkt het vergelijken net zo goed.
    const info = await pdf
      .getMetadata()
      .then((metadata) => metadata.info as DocInfo)
      .catch(() => ({}));
    const thumb = withThumb
      ? await renderPageImage(pdf, 1, 0, { dpi: THUMB_DPI, format: 'png', quality: 1 })
          .then((image) => image.bytes)
          .catch(() => null)
      : null;
    kept = keepOpen;
    return { pageCount, pages, info, thumb, fingerprint, pdf: keepOpen ? pdf : null };
  } finally {
    if (!kept) closePdf(pdf);
  }
}
