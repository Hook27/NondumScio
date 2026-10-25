import type { PDFFont, PDFPage } from 'pdf-lib';
import type { PixelRect } from './paint';

/**
 * De tekstlaag van OCR: herkende woorden worden als onzichtbare tekst op de afbeelding van een
 * geredigeerde pagina gezet. Het zwartmaken is dan al gebeurd, dus wat onder een vak stond,
 * kan er niet in terechtkomen; de controles hieronder bewaken dat ook.
 */

type PdfLib = typeof import('pdf-lib');

/** Een herkend woord, met de plek in beeldpunten (linksboven begonnen). */
export type OcrWord = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/** Een woord dat voor meer dan dit deel in een zwart vak ligt, of waarvan het midden erin ligt, valt weg. */
const MAX_COVERED = 0.25;

/** Laat de woorden weg die in of tegen een zwart vak liggen: OCR "ziet" in het zwart soms rommel. */
export function wordsOutside(words: readonly OcrWord[], rects: readonly PixelRect[]): OcrWord[] {
  return words.filter((word) => {
    const area = Math.max(1, (word.x1 - word.x0) * (word.y1 - word.y0));
    const centerX = (word.x0 + word.x1) / 2;
    const centerY = (word.y0 + word.y1) / 2;
    return rects.every((rect) => {
      if (centerX >= rect.x0 && centerX <= rect.x1 && centerY >= rect.y0 && centerY <= rect.y1) {
        return false;
      }
      const overlapX = Math.min(word.x1, rect.x1) - Math.max(word.x0, rect.x0);
      const overlapY = Math.min(word.y1, rect.y1) - Math.max(word.y0, rect.y0);
      return overlapX <= 0 || overlapY <= 0 || (overlapX * overlapY) / area <= MAX_COVERED;
    });
  });
}

/** Het lettertype kan niet alle tekens aan (Helvetica, WinAnsi): wat niet past, laten we weg. */
export function encodable(text: string, font: Pick<PDFFont, 'getCharacterSet'>): string {
  const allowed = new Set(font.getCharacterSet());
  return [...text].filter((char) => allowed.has(char.codePointAt(0)!)).join('');
}

/** De tekst zoals een lezer hem teruggeeft, zonder witruimte: voor het vergelijken. */
export const squash = (text: string) => text.replace(/\s+/g, '');

export type TextLayer = {
  /** De woorden die erin zijn gezet (zonder tekens die het lettertype niet kent). */
  words: string[];
  /** De plek van elk woord in punten (linksboven begonnen), voor de controle achteraf. */
  boxes: { x0: number; y0: number; x1: number; y1: number }[];
};

/**
 * Zet de woorden als onzichtbare tekst (weergavemodus 3) op de pagina. `factor` is het aantal punten
 * per beeldpunt van de afbeelding. Elk woord krijgt zijn eigen plek en breedte, zodat selecteren en
 * zoeken netjes op de afbeelding aansluiten.
 */
export function addTextLayer(
  lib: PdfLib,
  page: PDFPage,
  font: PDFFont,
  words: readonly OcrWord[],
  factor: number,
): TextLayer {
  const {
    TextRenderingMode,
    beginText,
    endText,
    popGraphicsState,
    pushGraphicsState,
    setCharacterSqueeze,
    setFontAndSize,
    setTextMatrix,
    setTextRenderingMode,
    showText,
  } = lib;
  const layer: TextLayer = { words: [], boxes: [] };
  const fontKey = page.node.newFontDictionary(font.name, font.ref);
  const height = page.getHeight();
  const operators = [
    pushGraphicsState(),
    beginText(),
    setTextRenderingMode(TextRenderingMode.Invisible),
  ];

  for (const word of words) {
    const text = encodable(word.text.trim(), font);
    if (text === '') continue;
    const size = Math.max(1, (word.y1 - word.y0) * factor * 0.85);
    const width = (word.x1 - word.x0) * factor;
    const natural = font.widthOfTextAtSize(text, size);
    const squeeze = natural > 0 ? Math.min(400, Math.max(10, (width / natural) * 100)) : 100;
    operators.push(
      setFontAndSize(fontKey, size),
      setCharacterSqueeze(squeeze),
      // De basislijn ligt iets boven de onderkant van het woord (de staartjes van g en p).
      setTextMatrix(1, 0, 0, 1, word.x0 * factor, height - word.y1 * factor + size * 0.2),
      showText(font.encodeText(text)),
    );
    layer.words.push(text);
    layer.boxes.push({
      x0: word.x0 * factor,
      y0: word.y0 * factor,
      x1: word.x1 * factor,
      y1: word.y1 * factor,
    });
  }
  operators.push(endText(), popGraphicsState());
  if (layer.words.length > 0) page.pushOperators(...operators);
  return layer;
}
