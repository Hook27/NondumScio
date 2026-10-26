import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageItem } from '../pages/plan';
import { outputScale } from '../pdf/images';
import type { OcrEngine } from '../pdf/redact';
import type { Source } from '../document/DocumentContext';
import type { PageText } from './pageText';
import { SearchCancelled, type PageTextProvider } from './run';
import { ocrWordsToPageText, textItemsToPageText, type TextItemLike } from './textLayer';

/**
 * De tekst van pagina's ophalen met pdf.js en, voor gescande pagina's, tekstherkenning (alleen in
 * de browser). Wat al gelezen is blijft per bestand bewaard: een tweede zoekterm kost dan niets.
 */

/** De resolutie waarop gescande pagina's herkend worden. */
const OCR_DPI = 300;

type Cache = { text: Map<number, PageText>; ocr: Map<number, PageText> };
const caches = new WeakMap<PDFDocumentProxy, Cache>();

function cacheOf(pdf: PDFDocumentProxy): Cache {
  let cache = caches.get(pdf);
  if (!cache) {
    cache = { text: new Map(), ocr: new Map() };
    caches.set(pdf, cache);
  }
  return cache;
}

/** Wacht op `promise`, maar geeft op tijd op als er gestopt wordt. */
function unlessAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new SearchCancelled());
    if (signal.aborted) return stop();
    signal.addEventListener('abort', stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

/** De tekstlaag van een pagina, in de basisstand (met de draaiing die de pagina zelf heeft). */
async function readTextLayer(pdf: PDFDocumentProxy, pageIndex: number): Promise<PageText> {
  const page = await pdf.getPage(pageIndex + 1);
  try {
    const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const content = await page.getTextContent();
    const items = content.items.filter((item): item is typeof item & TextItemLike => 'str' in item);
    return textItemsToPageText(
      items,
      (x, y) => viewport.convertToViewportPoint(x, y) as [number, number],
      { width: viewport.width, height: viewport.height },
    );
  } finally {
    page.cleanup();
  }
}

/** Tekent een pagina (zonder vakken) en laat de tekst herkennen. */
async function recognizePage(
  pdf: PDFDocumentProxy,
  pageIndex: number,
  engine: OcrEngine,
  signal?: AbortSignal,
): Promise<PageText> {
  const page = await pdf.getPage(pageIndex + 1);
  try {
    const base = page.getViewport({ scale: 1, rotation: page.rotate });
    const { scale } = outputScale(base.width, base.height, OCR_DPI);
    const viewport = page.getViewport({ scale, rotation: page.rotate });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    // Het canvas kan flink wat geheugen vasthouden: meteen vrijgeven.
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('De afbeelding kon niet worden gemaakt');
    const png = new Uint8Array(await blob.arrayBuffer());
    const words = await unlessAborted(engine.recognize(png, Math.round(scale * 72)), signal);
    return ocrWordsToPageText(words, scale, { width: base.width, height: base.height });
  } finally {
    page.cleanup();
  }
}

export type OpenPageSource = PageTextProvider & {
  /** Sluit de tekstherkenning als die geopend is. */
  close: () => void;
};

/**
 * De bron van paginatekst voor een zoekopdracht. De tekstherkenning wordt pas geopend als er een
 * gescande pagina aan de beurt is (en `openOcr` is bij andere pagina's niet nodig).
 */
export function openPageSource({
  sourceOf,
  openOcr,
  signal,
}: {
  sourceOf: (page: PageItem) => Source | undefined;
  openOcr: () => Promise<OcrEngine>;
  signal?: AbortSignal;
}): OpenPageSource {
  let opening: Promise<OcrEngine> | undefined;
  const pdfOf = (page: PageItem) => {
    const source = sourceOf(page);
    if (!source) throw new Error('Het bestand van deze pagina is niet meer open');
    return source.pdf;
  };
  return {
    text: async (page) => {
      const pdf = pdfOf(page);
      const cache = cacheOf(pdf).text;
      const known = cache.get(page.source);
      if (known) return known;
      const text = await readTextLayer(pdf, page.source);
      cache.set(page.source, text);
      return text;
    },
    ocr: async (page) => {
      const pdf = pdfOf(page);
      const cache = cacheOf(pdf).ocr;
      const known = cache.get(page.source);
      if (known) return known;
      opening ??= openOcr();
      const engine = await unlessAborted(opening, signal);
      const text = await recognizePage(pdf, page.source, engine, signal);
      cache.set(page.source, text);
      return text;
    },
    // Ook als het openen nog bezig was toen er gestopt werd: daarna alsnog sluiten.
    close: () =>
      void opening?.then(
        (engine) => engine.close(),
        () => {},
      ),
  };
}
