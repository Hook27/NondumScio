import type { OcrWord } from '../pdf/ocrText';

/**
 * Zet de woorden die de tekstherkenning (OCR) op een pagina vond in leesbare regels: van boven
 * naar beneden, en binnen een regel van links naar rechts. Woorden die op dezelfde hoogte staan
 * (ook in twee kolommen naast elkaar) komen in één regel, net als bij de tekstlaag (`linesFrom`),
 * zodat de herkenning van datum, afzender en onderwerp er op dezelfde manier op werkt.
 *
 * Een woord hoort bij een regel als zijn midden binnen de hoogte van de regel valt én het midden
 * van de regel binnen de hoogte van het woord: zo trekt een uitschieter (een hoog logo, een woord
 * met staarten) geen regel eronder mee.
 */
export function linesFromWords(words: readonly OcrWord[]): string[] {
  const middle = (top: number, bottom: number) => (top + bottom) / 2;
  const rows: { top: number; bottom: number; words: OcrWord[] }[] = [];
  const sorted = words
    .filter((word) => word.text.trim() !== '')
    .sort((a, b) => middle(a.y0, a.y1) - middle(b.y0, b.y1));
  for (const word of sorted) {
    const center = middle(word.y0, word.y1);
    const row = rows.find((r) => {
      const rowCenter = middle(r.top, r.bottom);
      return center >= r.top && center <= r.bottom && rowCenter >= word.y0 && rowCenter <= word.y1;
    });
    if (row) {
      row.words.push(word);
      row.top = Math.min(row.top, word.y0);
      row.bottom = Math.max(row.bottom, word.y1);
    } else {
      rows.push({ top: word.y0, bottom: word.y1, words: [word] });
    }
  }
  return rows
    .sort((a, b) => a.top - b.top)
    .map((row) =>
      row.words
        .sort((a, b) => a.x0 - b.x0)
        .map((word) => word.text.trim())
        .join(' ')
        .replace(/\s+/g, ' '),
    );
}
