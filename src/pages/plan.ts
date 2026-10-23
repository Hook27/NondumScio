/**
 * Het "pagina-plan": welke pagina's van het origineel in welke volgorde en met welke
 * extra draaiing in het resultaat komen. Bewerken verandert alleen dit plan; het
 * originele bestand blijft onaangeroerd tot je opslaat.
 */

export type Rotation = 0 | 90 | 180 | 270;

export type PageItem = {
  /** Vaste sleutel, ook als de pagina verplaatst of gedraaid wordt. */
  key: number;
  /** Paginanummer in het origineel, vanaf 0. */
  source: number;
  /** Extra draaiing bovenop de draaiing die de pagina in het origineel al heeft. */
  rotation: Rotation;
};

export function initialPages(pageCount: number): PageItem[] {
  return Array.from({ length: pageCount }, (_, i) => ({ key: i, source: i, rotation: 0 }));
}

/** Rekent een draaiing om naar 0, 90, 180 of 270 (ook voor negatieve waarden). */
export function normalizeRotation(degrees: number): Rotation {
  if (!Number.isInteger(degrees) || degrees % 90 !== 0) {
    throw new RangeError(`Draaiing moet een veelvoud van 90 zijn: ${degrees}`);
  }
  return (((degrees % 360) + 360) % 360) as Rotation;
}

/** Draait de gekozen pagina's met `delta` graden (90 = rechtsom, -90 = linksom). */
export function rotatePages(
  pages: PageItem[],
  keys: ReadonlySet<number>,
  delta: number,
): PageItem[] {
  if (keys.size === 0) return pages;
  return pages.map((page) =>
    keys.has(page.key) ? { ...page, rotation: normalizeRotation(page.rotation + delta) } : page,
  );
}

/**
 * Verwijdert de gekozen pagina's. Een PDF zonder pagina's bestaat niet; als alles
 * gekozen is, blijft het plan daarom ongewijzigd.
 */
export function removePages(pages: PageItem[], keys: ReadonlySet<number>): PageItem[] {
  const remaining = pages.filter((page) => !keys.has(page.key));
  return remaining.length === 0 ? pages : remaining;
}

export function canRemove(pages: PageItem[], keys: ReadonlySet<number>): boolean {
  return keys.size > 0 && pages.some((page) => !keys.has(page.key));
}

/** Of het plan afwijkt van het origineel (dan is er iets op te slaan). */
export function isChanged(pages: PageItem[], originalCount: number): boolean {
  return (
    pages.length !== originalCount ||
    pages.some((page, index) => page.source !== index || page.rotation !== 0)
  );
}

/** Of twee plannen hetzelfde resultaat geven (zelfde pagina's, volgorde en draaiing). */
export function samePlan(a: readonly PageItem[], b: readonly PageItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((page, i) => page.source === b[i]!.source && page.rotation === b[i]!.rotation)
  );
}

/* Ongedaan maken en opnieuw */

export type History = {
  past: PageItem[][];
  present: PageItem[];
  future: PageItem[][];
};

/** Zoveel stappen kun je terug; genoeg voor gewoon gebruik, en het geheugen blijft begrensd. */
export const HISTORY_LIMIT = 100;

export function startHistory(pages: PageItem[]): History {
  return { past: [], present: pages, future: [] };
}

/** Een nieuwe stap. Een stap die niets verandert telt niet mee; "opnieuw" vervalt. */
export function record(history: History, next: PageItem[]): History {
  if (next === history.present) return history;
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return { past: [...history.past, history.present], present: next, future: rest };
}
