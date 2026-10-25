import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';
import { baseSize, baseToPdf } from '../annotations/geometry';
import {
  BASELINE,
  HIGHLIGHT_OPACITY,
  LINE_HEIGHT,
  drawableText,
  type Annotation,
} from '../annotations/model';
import { normalizeRotation } from '../pages/plan';

type PdfLib = typeof import('pdf-lib');

/** Het standaardlettertype (Helvetica), per document één keer ingebed en alleen als het nodig is. */
export type FontCache = { helvetica?: PDFFont };

/** Een kleur als "#rrggbb" in de kleurwaarden (0 tot 1) die pdf-lib verwacht. */
function colorOf(lib: PdfLib, hex: string) {
  const value = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '000000';
  const channel = (i: number) => parseInt(value.slice(i, i + 2), 16) / 255;
  return lib.rgb(channel(0), channel(2), channel(4));
}

/**
 * Tekent annotaties in de pagina zelf, bovenop de bestaande inhoud. De annotaties staan in
 * de basisstand van de pagina (zie `annotations/model`); een matrix zet dat om naar de
 * PDF-coördinaten van deze pagina, ook als de pagina in het bestand zelf gedraaid is of een
 * uitsnede (CropBox) heeft. Roep dit aan vóórdat de extra draaiing uit het pagina-plan is
 * ingesteld, want die komt er daarna overheen en draait de annotaties dus netjes mee.
 */
export async function drawAnnotations(
  lib: PdfLib,
  doc: PDFDocument,
  page: PDFPage,
  items: readonly Annotation[],
  fonts: FontCache,
): Promise<void> {
  if (items.every((item) => item.kind === 'redact')) return;
  const rotate = normalizeRotation(page.getRotation().angle);
  const box = page.getCropBox();
  const { height } = baseSize(rotate, box);
  const [a, b, c, d, e, f] = baseToPdf(rotate, box);

  // Het lettertype eerst, want inbedden is asynchroon.
  if (items.some((item) => item.kind === 'text')) {
    fonts.helvetica ??= await doc.embedFont(lib.StandardFonts.Helvetica);
  }

  page.pushOperators(lib.pushGraphicsState(), lib.concatTransformationMatrix(a, b, c, d, e, f));
  // Vanaf hier tekenen we in de basisstand met y omhoog; onze plekken hebben y omlaag.
  const up = (y: number) => height - y;

  for (const item of items) {
    // Een redactievak is een opdracht voor het opslaan (de pagina wordt een afbeelding), geen tekening.
    if (item.kind === 'redact') continue;
    const color = colorOf(lib, item.color);
    if (item.kind === 'text') {
      const lines = drawableText(item.text).split('\n');
      lines.forEach((line, i) => {
        if (line === '') return;
        page.drawText(line, {
          x: item.x,
          y: up(item.y + (BASELINE + i * LINE_HEIGHT) * item.size),
          size: item.size,
          font: fonts.helvetica!,
          color,
        });
      });
    } else if (item.kind === 'line') {
      page.drawLine({
        start: { x: item.x1, y: up(item.y1) },
        end: { x: item.x2, y: up(item.y2) },
        thickness: item.strokeWidth,
        color,
        lineCap: lib.LineCapStyle.Round,
      });
    } else if (item.kind === 'highlight') {
      page.drawRectangle({
        x: item.x,
        y: up(item.y + item.height),
        width: item.width,
        height: item.height,
        color,
        opacity: HIGHLIGHT_OPACITY,
      });
    } else {
      // Een rechthoek: alleen een rand, geen vulling.
      page.drawRectangle({
        x: item.x,
        y: up(item.y + item.height),
        width: item.width,
        height: item.height,
        borderColor: color,
        borderWidth: item.strokeWidth,
      });
    }
  }
  page.pushOperators(lib.popGraphicsState());
}
