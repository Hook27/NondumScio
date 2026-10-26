import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PageItem } from '../pages/plan';

/**
 * De bladwijzers (de "outline") van een geopend bestand: inlezen met pdf.js en koppelen aan het
 * pagina-plan, zodat je ziet op welke plek in het resultaat een bladwijzer uitkomt, of dat zijn
 * pagina is weggehaald. Alleen om te tonen en te springen: wat er gedownload wordt, verandert niet.
 */

export type OutlineEntry = {
  /** Uniek binnen het bestand: de plek in de boom ("0", "1.2"). */
  id: string;
  title: string;
  /** De pagina in het bestand (vanaf 0), of `null` als de bladwijzer nergens in het bestand heen wijst. */
  page: number | null;
  children: OutlineEntry[];
};

/** Wat er van een geopende PDF nodig is. */
export type OutlineSource = Pick<
  PDFDocumentProxy,
  'getOutline' | 'getDestination' | 'getPageIndex'
>;

type OutlineNode = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number];

/** De pagina waar een bestemming naartoe wijst: een benoemde bestemming of een lijst [pagina, …]. */
async function pageOf(pdf: OutlineSource, dest: OutlineNode['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || explicit.length === 0) return null;
    const target: unknown = explicit[0];
    // Meestal een verwijzing naar de pagina; sommige makers zetten er het paginanummer in.
    if (typeof target === 'number') return Number.isInteger(target) && target >= 0 ? target : null;
    if (target && typeof target === 'object' && 'num' in target) {
      return await pdf.getPageIndex(target as Parameters<OutlineSource['getPageIndex']>[0]);
    }
    return null;
  } catch {
    return null;
  }
}

async function readNodes(
  pdf: OutlineSource,
  nodes: readonly OutlineNode[],
  prefix: string,
): Promise<OutlineEntry[]> {
  return Promise.all(
    nodes.map(async (node, index) => {
      const id = prefix === '' ? String(index) : `${prefix}.${index}`;
      return {
        id,
        title: (node.title ?? '').replace(/\s+/g, ' ').trim(),
        page: node.dest ? await pageOf(pdf, node.dest) : null,
        children: await readNodes(pdf, node.items ?? [], id),
      };
    }),
  );
}

/** Leest de bladwijzers van een bestand. Een bestand zonder bladwijzers (of een fout) geeft een lege lijst. */
export async function readOutline(pdf: OutlineSource): Promise<OutlineEntry[]> {
  if (typeof pdf.getOutline !== 'function') return [];
  try {
    return await readNodes(pdf, (await pdf.getOutline()) ?? [], '');
  } catch {
    return [];
  }
}

const cache = new WeakMap<object, Promise<OutlineEntry[]>>();
const known = new WeakMap<object, OutlineEntry[]>();

/** Zoals `readOutline`, maar per bestand maar één keer: wisselen tussen taken kost dan niets. */
export function loadOutline(pdf: OutlineSource): Promise<OutlineEntry[]> {
  let outline = cache.get(pdf);
  if (!outline) {
    outline = readOutline(pdf).then((entries) => {
      known.set(pdf, entries);
      return entries;
    });
    cache.set(pdf, outline);
  }
  return outline;
}

/** De bladwijzers als ze al gelezen zijn (meteen, zonder wachten), anders `undefined`. */
export function knownOutline(pdf: OutlineSource): OutlineEntry[] | undefined {
  return known.get(pdf);
}

/** Waar een bladwijzer in het resultaat uitkomt. */
export type Target =
  | { kind: 'page'; position: number }
  | { kind: 'removed' }
  /** De bladwijzer wijst niet naar een pagina, bijvoorbeeld naar een website. */
  | { kind: 'none' };

export type PlacedEntry = {
  id: string;
  title: string;
  target: Target;
  children: PlacedEntry[];
};

/**
 * Koppelt de bladwijzers van bestand `doc` aan het pagina-plan. Staat een pagina er meer dan eens
 * in, dan geldt de eerste plek.
 */
export function placeOutline(
  entries: readonly OutlineEntry[],
  doc: number,
  pages: readonly PageItem[],
): PlacedEntry[] {
  const positions = new Map<number, number>();
  pages.forEach((page, index) => {
    if (page.doc === doc && !positions.has(page.source)) positions.set(page.source, index);
  });
  const place = (items: readonly OutlineEntry[]): PlacedEntry[] =>
    items.map((entry) => {
      const position = entry.page === null ? undefined : positions.get(entry.page);
      const target: Target =
        entry.page === null
          ? { kind: 'none' }
          : position === undefined
            ? { kind: 'removed' }
            : { kind: 'page', position };
      return { id: entry.id, title: entry.title, target, children: place(entry.children) };
    });
  return place(entries);
}

/** Het aantal bladwijzers in een boom, ook de onderliggende; met `where` alleen die waarvoor dat geldt. */
export function countEntries<T extends { children: T[] }>(
  entries: readonly T[],
  where: (entry: T) => boolean = () => true,
): number {
  return entries.reduce(
    (total, entry) => total + (where(entry) ? 1 : 0) + countEntries(entry.children, where),
    0,
  );
}
