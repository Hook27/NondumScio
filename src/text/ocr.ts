import type { PageText, Piece } from '../compare/layout';
import { renderPage } from '../compare/visual';
import { outputScale } from '../pdf/images';
import type { OcrWord } from '../pdf/ocrText';
import type { OcrEngine } from '../pdf/redact';

/**
 * Tekstherkenning (OCR) voor PDF → Platte tekst: een pagina zonder tekstlaag (een scan) tekenen,
 * laten herkennen, en de herkende woorden als gewone tekststukjes teruggeven. Dan gelden voor een
 * scan dezelfde opmaakregels als voor een tekstlaag: regels, kolommen, alinea's, afgebroken
 * woorden, kop en voet, ankers en de leesvakken. Alles gebeurt in de browser (zie `pdf/ocr.ts`).
 */

/** De resolutie waarop een pagina herkend wordt, zoals bij Redigeren en Slim hernoemen. */
export const OCR_DPI = 300;

/**
 * De herkende woorden als tekststukjes. De woorden staan in beeldpunten van een afbeelding van de
 * pagina met `scale` beeldpunten per punt, gemeten vanaf linksboven; een tekststukje staat in
 * punten vanaf linksonder (zie `Piece`). Hoogte en plek komen van de regel waarin de herkenning
 * het woord zag (de onderkant van de regel als plek, de hoogte van de regel als lettergrootte):
 * met die van het woord zelf zou een woord met een staart ("zijn", "jong") lager staan dan de rest
 * van de regel, en een eigen regel worden, en zou "Pagina 1" groter lijken dan de lopende tekst.
 * Zonder regel die van het woord. Achter elk woord een spatie: herkende woorden zijn altijd losse
 * woorden, ook als ze dicht op elkaar staan.
 */
export function ocrPieces(words: readonly OcrWord[], scale: number, pageHeight: number): Piece[] {
  return words
    .filter((word) => word.text.trim() !== '')
    .map((word) => {
      const { y0, y1 } = word.line ?? word;
      return {
        str: `${word.text.trim()} `,
        x: word.x0 / scale,
        y: pageHeight - y1 / scale,
        fh: (y1 - y0) / scale,
        w: (word.x1 - word.x0) / scale,
      };
    });
}

/** Wacht op `promise`, maar geeft meteen op als er gestopt wordt. */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(signal.reason);
    if (signal.aborted) return stop();
    signal.addEventListener('abort', stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/**
 * Herkent de tekst van één pagina van `file` (met dezelfde geopende PDF als het voorbeeld). De
 * pagina wordt getekend zoals je hem ziet (met draaiing en uitsnede), dus de herkende woorden
 * passen op de maat van `page`. Met `signal` gestopt: dan wordt de belofte afgewezen.
 */
export async function recognizePage(
  file: File,
  page: PageText,
  engine: OcrEngine,
  signal: AbortSignal,
): Promise<PageText> {
  const { scale } = outputScale(page.w, page.h, OCR_DPI);
  // De breedte wordt afgerond; dat scheelt hooguit een halve beeldpunt.
  const canvas = await renderPage(file, page.no, Math.max(1, Math.round(page.w * scale)), signal);
  if (!canvas) throw new Error('Deze pagina bestaat niet');
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  // Het canvas kan flink wat geheugen vasthouden: meteen vrijgeven.
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('De afbeelding kon niet worden gemaakt');
  const png = new Uint8Array(await blob.arrayBuffer());
  // Herkennen kan seconden duren en is niet af te breken: bij Stoppen niet meer op wachten.
  const words = await unlessAborted(engine.recognize(png, Math.round(scale * 72)), signal);
  const items = ocrPieces(words, scale, page.h);
  return { ...page, items, chars: items.reduce((n, item) => n + item.str.trim().length, 0) };
}
