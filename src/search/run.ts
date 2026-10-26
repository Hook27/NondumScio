import type { Annotation } from '../annotations/model';
import { annotationsOf, redactionsOf } from '../annotations/model';
import type { PageItem } from '../pages/plan';
import { boxesFor, visibleCount, type Box, type PageText } from './pageText';
import { findHits, type Hit, type SearchSpec } from './patterns';

/**
 * Zoeken over de pagina's van het plan. De tekst komt van een `PageTextProvider` (de tekstlaag van
 * de PDF of tekstherkenning), zodat dit zonder browser te testen is. Een treffer is nog geen
 * redactievak: de gebruiker controleert eerst, en alleen wat hij laat staan wordt een vak.
 */

/** Zoveel treffers worden hooguit getoond; meer is niet meer na te lopen. */
export const MAX_CANDIDATES = 500;

/** Een pagina met minder zichtbare tekens dan dit geldt als gescand (geen bruikbare tekstlaag). */
export const MIN_TEXT_CHARS = 20;

/** Een vak telt als afgedekt als zoveel van zijn oppervlak al in een redactievak ligt. */
const COVERED = 0.8;

/** Een treffer: waar hij staat (één vak per regel) en wat eromheen staat, om hem te herkennen. */
export type Candidate = {
  id: number;
  /** De pagina, als `PageItem.key`. */
  page: number;
  boxes: Box[];
  text: string;
  before: string;
  after: string;
  kind: Hit['kind'];
  /** Gevonden met tekstherkenning in plaats van in de tekstlaag. */
  viaOcr: boolean;
  /** Wordt een vak bij "Zet vakken". */
  checked: boolean;
};

export type SearchResult = {
  candidates: Candidate[];
  /** Treffers die al in een bestaand redactievak liggen en dus niet getoond worden. */
  covered: number;
  /** Pagina's zonder tekst die zijn overgeslagen omdat tekstherkenning uit stond. */
  skipped: number;
  /** Pagina's die met tekstherkenning zijn doorzocht. */
  recognized: number;
  /** Er waren meer treffers dan `MAX_CANDIDATES`. */
  capped: boolean;
};

/** De tekst van pagina's, uit de tekstlaag of met tekstherkenning. */
export type PageTextProvider = {
  text: (page: PageItem) => Promise<PageText>;
  ocr: (page: PageItem) => Promise<PageText>;
};

/** Het zoeken is gestopt. */
export class SearchCancelled extends Error {
  constructor() {
    super('Zoeken is gestopt');
    this.name = 'SearchCancelled';
  }
}

/** Een pagina zonder bruikbare tekst, zoals een scan. */
export const isScanned = (text: PageText) => visibleCount(text) < MIN_TEXT_CHARS;

/** Tekens eromheen die bij een treffer getoond worden. */
const CONTEXT = 24;

const flat = (chars: readonly string[]) => chars.join('').replace(/\s+/g, ' ');

/** Wat er vóór een treffer staat; een woord dat doormidden is geknipt, valt weg (met … ervoor). */
function contextBefore(chars: readonly string[], start: number): string {
  const from = Math.max(0, start - CONTEXT);
  const text = flat(chars.slice(from, start));
  if (from > 0 && !/\s/.test(chars[from - 1]!)) return `…${text.replace(/^\S+/, '')}`;
  return text.trimStart();
}

/** Wat er na een treffer staat; een woord dat doormidden is geknipt, valt weg (met … erachter). */
function contextAfter(chars: readonly string[], end: number): string {
  const to = end + CONTEXT;
  const text = flat(chars.slice(end, to));
  if (to < chars.length && !/\s/.test(chars[to]!)) return `${text.replace(/\S+$/, '')}…`;
  return text.trimEnd();
}

/** Of een treffer helemaal in bestaande redactievakken ligt. */
function isCovered(boxes: readonly Box[], existing: readonly Box[]): boolean {
  return boxes.every((box) =>
    existing.some((other) => {
      const width = Math.min(box.x + box.width, other.x + other.width) - Math.max(box.x, other.x);
      const height =
        Math.min(box.y + box.height, other.y + other.height) - Math.max(box.y, other.y);
      return width > 0 && height > 0 && (width * height) / (box.width * box.height) >= COVERED;
    }),
  );
}

export async function runSearch({
  pages,
  annotations,
  spec,
  ocr,
  provider,
  newId,
  onProgress,
  signal,
}: {
  pages: readonly PageItem[];
  annotations: readonly Annotation[];
  spec: SearchSpec;
  /** Pagina's zonder tekst met tekstherkenning doorzoeken. */
  ocr: boolean;
  provider: PageTextProvider;
  newId: () => number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}): Promise<SearchResult> {
  const result: SearchResult = {
    candidates: [],
    covered: 0,
    skipped: 0,
    recognized: 0,
    capped: false,
  };
  let lastYield = Date.now();

  for (let index = 0; index < pages.length; index += 1) {
    if (signal?.aborted) throw new SearchCancelled();
    const page = pages[index]!;
    let text = await provider.text(page);
    let viaOcr = false;
    if (isScanned(text)) {
      if (!ocr) {
        result.skipped += 1;
        onProgress?.(index + 1, pages.length);
        continue;
      }
      text = await provider.ocr(page);
      viaOcr = true;
      result.recognized += 1;
    }
    if (signal?.aborted) throw new SearchCancelled();

    const existing = redactionsOf(annotationsOf(annotations, page.key));
    for (const hit of findHits(text.chars, spec)) {
      const boxes = boxesFor(text, hit.start, hit.end);
      if (boxes.length === 0) continue;
      if (isCovered(boxes, existing)) {
        result.covered += 1;
        continue;
      }
      if (result.candidates.length >= MAX_CANDIDATES) {
        result.capped = true;
        break;
      }
      result.candidates.push({
        id: newId(),
        page: page.key,
        boxes,
        text: flat(text.chars.slice(hit.start, hit.end)).trim(),
        before: contextBefore(text.chars, hit.start),
        after: contextAfter(text.chars, hit.end),
        kind: hit.kind,
        viaOcr,
        checked: true,
      });
    }
    onProgress?.(index + 1, pages.length);
    if (result.capped) break;

    // De browser krijgt af en toe even lucht, zodat de pagina blijft reageren.
    if (Date.now() - lastYield > 50) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastYield = Date.now();
    }
  }
  return result;
}
