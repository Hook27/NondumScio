import type { Size } from '../annotations/geometry';
import type { OcrWord } from '../pdf/ocrText';
import { buildPageText, makeRun, type PageText, type Run } from './pageText';

/**
 * De tekst van een pagina uit de PDF zelf (de tekstlaag, via pdf.js) of uit tekstherkenning,
 * als `PageText` met de plek van elk stuk in de basisstand van de pagina.
 */

/** Wat we nodig hebben van een tekstfragment van pdf.js. */
export type TextItemLike = {
  str: string;
  /** De matrix [a, b, c, d, e, f] van het fragment: de richting van de tekst en waar hij begint. */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
};

/** Het stuk van de letter onder de basislijn en de hoogte van de hele letter, in lettergroottes (Helvetica). */
const DESCENT = 0.212;
const EM_HEIGHT = 0.905 + 0.212;

/**
 * Zet de tekstfragmenten van een pagina om. `toBase` rekent een plek in de PDF (punten, y omhoog)
 * om naar de basisstand van de pagina (y omlaag, met de draaiing die de pagina zelf heeft).
 */
export function textItemsToPageText(
  items: readonly TextItemLike[],
  toBase: (x: number, y: number) => [number, number],
  size: Size,
): PageText {
  const entries: { run: Run; after: '' | ' ' | '\n' }[] = [];
  for (const item of items) {
    if (item.str === '') {
      // Een leeg fragment met een regeleinde sluit het vorige af.
      const last = entries[entries.length - 1];
      if (item.hasEOL && last) last.after = '\n';
      continue;
    }
    const [a, b, c, d, e, f] = item.transform as [number, number, number, number, number, number];
    const alongLength = Math.hypot(a, b) || 1;
    const upLength = Math.hypot(c, d);
    const ux = a / alongLength;
    const uy = b / alongLength;
    // Staat de letter niet "rechtop" ten opzichte van de regel (c en d zijn 0), dan loodrecht.
    const vx = upLength > 0 ? c / upLength : -uy;
    const vy = upLength > 0 ? d / upLength : ux;
    const height = item.height || upLength || alongLength;
    const length = item.width > 0 ? item.width : [...item.str].length * height * 0.5;

    const x0 = e - vx * DESCENT * height;
    const y0 = f - vy * DESCENT * height;
    const from = toBase(x0, y0);
    const right = toBase(x0 + ux * length, y0 + uy * length);
    const top = toBase(x0 + vx * EM_HEIGHT * height, y0 + vy * EM_HEIGHT * height);
    entries.push({
      run: makeRun(
        item.str,
        { x: from[0], y: from[1] },
        { x: right[0] - from[0], y: right[1] - from[1] },
        { x: top[0] - from[0], y: top[1] - from[1] },
      ),
      after: item.hasEOL ? '\n' : '',
    });
  }
  return buildPageText(entries, size);
}

/**
 * Zet de woorden van tekstherkenning om. De woorden staan in beeldpunten van een afbeelding van de
 * pagina met `scale` beeldpunten per punt (en de draaiing van de pagina zelf).
 */
export function ocrWordsToPageText(words: readonly OcrWord[], scale: number, size: Size): PageText {
  const kept = words.filter((word) => word.text.trim() !== '');
  const entries = kept.map((word, index) => {
    const next = kept[index + 1];
    const height = word.y1 - word.y0;
    // Het volgende woord staat op dezelfde regel als het ernaast begint en ongeveer even hoog ligt.
    let after: '' | ' ' | '\n' = '\n';
    if (next) {
      const shared = Math.min(word.y1, next.y1) - Math.max(word.y0, next.y0);
      const smaller = Math.min(height, next.y1 - next.y0);
      if (next.x0 >= word.x0 && shared >= 0.5 * smaller) after = ' ';
    }
    return {
      run: makeRun(
        word.text.trim(),
        { x: word.x0 / scale, y: word.y1 / scale },
        { x: (word.x1 - word.x0) / scale, y: 0 },
        { x: 0, y: -height / scale },
      ),
      after,
    };
  });
  return buildPageText(entries, size);
}
