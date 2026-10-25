/**
 * Het "pagina-plan": welke pagina's uit welke bestanden in welke volgorde en met welke
 * extra draaiing in het resultaat komen. Bewerken verandert alleen dit plan; de
 * originele bestanden blijven onaangeroerd tot je opslaat.
 */

export type Rotation = 0 | 90 | 180 | 270;

export type PageItem = {
  /** Vaste sleutel, ook als de pagina verplaatst of gedraaid wordt; uniek over alle bestanden. */
  key: number;
  /** Uit welk geopend bestand de pagina komt (zie `Source.id`). */
  doc: number;
  /** Paginanummer in dat bestand, vanaf 0. */
  source: number;
  /** Extra draaiing bovenop de draaiing die de pagina in het origineel al heeft. */
  rotation: Rotation;
};

/**
 * Alle pagina's van één bestand, in de originele volgorde. `firstKey` zorgt dat sleutels
 * uniek blijven als er meer bestanden bij komen.
 */
export function initialPages(pageCount: number, doc = 0, firstKey = 0): PageItem[] {
  return Array.from({ length: pageCount }, (_, i) => ({
    key: firstKey + i,
    doc,
    source: i,
    rotation: 0,
  }));
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

/**
 * Verplaatst de gekozen pagina's naar plek `target` (0 = vooraan, `pages.length` =
 * achteraan; de plek telt in de huidige volgorde, alsof de gekozen pagina's er nog staan).
 * Meerdere pagina's komen als één blok terecht, in hun onderlinge volgorde. Verandert er
 * niets, dan komt hetzelfde plan terug (en telt het niet als stap voor ongedaan maken).
 */
export function movePages(
  pages: PageItem[],
  keys: ReadonlySet<number>,
  target: number,
): PageItem[] {
  if (keys.size === 0) return pages;
  const clamped = Math.max(0, Math.min(target, pages.length));
  const moving = pages.filter((page) => keys.has(page.key));
  if (moving.length === 0) return pages;
  const rest = pages.filter((page) => !keys.has(page.key));
  const before = pages.slice(0, clamped).filter((page) => !keys.has(page.key)).length;
  const next = [...rest.slice(0, before), ...moving, ...rest.slice(before)];
  return next.every((page, i) => page === pages[i]) ? pages : next;
}

/**
 * Schuift de gekozen pagina's één plek naar voren (`-1`) of naar achteren (`1`), voor de
 * knoppen en Alt+pijltje. Verspreid gekozen pagina's worden daarbij één blok.
 */
export function movePagesBy(
  pages: PageItem[],
  keys: ReadonlySet<number>,
  step: -1 | 1,
): PageItem[] {
  const positions = pages.flatMap((page, i) => (keys.has(page.key) ? [i] : []));
  if (positions.length === 0) return pages;
  const first = positions[0]!;
  const last = positions.at(-1)!;
  return step < 0 ? movePages(pages, keys, first - 1) : movePages(pages, keys, last + 2);
}

/** De gekozen pagina's, in de huidige volgorde: de inhoud voor "uitpakken". */
export function pickPages(pages: PageItem[], keys: ReadonlySet<number>): PageItem[] {
  return pages.filter((page) => keys.has(page.key));
}

/* Bestanden in het plan */

/** De bestanden in het plan, in de volgorde van hun eerste pagina. */
export function docOrder(pages: readonly PageItem[]): number[] {
  return [...new Set(pages.map((page) => page.doc))];
}

/** De sleutels van alle pagina's uit één bestand. */
export function keysOfDoc(pages: readonly PageItem[], doc: number): Set<number> {
  return new Set(pages.filter((page) => page.doc === doc).map((page) => page.key));
}

/**
 * Haalt alle pagina's van een bestand uit het plan. Zou er dan niets overblijven, dan blijft
 * het plan ongewijzigd (een PDF zonder pagina's bestaat niet).
 */
export function removeDoc(pages: PageItem[], doc: number): PageItem[] {
  return removePages(pages, keysOfDoc(pages, doc));
}

/**
 * Zet alle pagina's van een bestand als blok vóór het vorige bestand (`-1`) of na het
 * volgende (`1`), in de volgorde van de bestandenlijst.
 */
export function moveDoc(pages: PageItem[], doc: number, step: -1 | 1): PageItem[] {
  const order = docOrder(pages);
  const index = order.indexOf(doc);
  const neighbour = order[index + step];
  if (index < 0 || neighbour === undefined) return pages;
  const keys = keysOfDoc(pages, doc);
  if (step < 0) {
    return movePages(
      pages,
      keys,
      pages.findIndex((page) => page.doc === neighbour),
    );
  }
  const last = pages.map((page) => page.doc).lastIndexOf(neighbour);
  return movePages(pages, keys, last + 1);
}

/**
 * Zet alle pagina's van een bestand als blok op plek `target` in de bestandenlijst (0 =
 * vooraan, het aantal bestanden = achteraan; de plek telt in de huidige volgorde, alsof het
 * bestand er nog staat), voor slepen. Het blok komt vóór de eerste pagina van het bestand
 * dat op die plek staat. Loslaten op de eigen plek verandert niets.
 */
export function moveDocTo(pages: PageItem[], doc: number, target: number): PageItem[] {
  const order = docOrder(pages);
  const index = order.indexOf(doc);
  if (index < 0) return pages;
  const clamped = Math.max(0, Math.min(target, order.length));
  if (clamped === index || clamped === index + 1) return pages;
  const keys = keysOfDoc(pages, doc);
  const before = order[clamped];
  return movePages(
    pages,
    keys,
    before === undefined ? pages.length : pages.findIndex((page) => page.doc === before),
  );
}

/**
 * Bepaalt welke pagina's van een bestand in het plan staan (`sources`: paginanummers in het
 * bestand, vanaf 0), voor het bereikveld en de vinkjes bij Samenvoegen. Pagina's die blijven,
 * houden hun plek en draaiing. Een nieuwe pagina komt direct na de pagina van hetzelfde bestand
 * met het hoogste lagere nummer (of vóór die met het laagste hogere), en anders op de plek waar
 * het bestand stond. De volgorde verander je bij Pagina's. Een lege keuze verandert niets: een
 * heel bestand weghalen gaat met `removeDoc`.
 */
export function setDocPages(
  pages: PageItem[],
  doc: number,
  sources: ReadonlySet<number>,
  newKey: () => number,
): PageItem[] {
  const firstIndex = pages.findIndex((page) => page.doc === doc);
  if (sources.size === 0 || firstIndex < 0) return pages;
  const present = new Set(pages.filter((page) => page.doc === doc).map((page) => page.source));
  const result = pages.filter((page) => page.doc !== doc || sources.has(page.source));
  const added = [...sources].filter((source) => !present.has(source)).sort((a, b) => a - b);
  if (added.length === 0 && result.length === pages.length) return pages;

  for (const source of added) {
    let at = -1;
    let lower = -1;
    let higher = Infinity;
    result.forEach((page, i) => {
      if (page.doc !== doc) return;
      if (page.source < source && page.source > lower) {
        lower = page.source;
        at = i + 1;
      }
    });
    if (at < 0) {
      result.forEach((page, i) => {
        if (page.doc === doc && page.source > source && page.source < higher) {
          higher = page.source;
          at = i;
        }
      });
    }
    // Van de oude pagina's is niets over: op de plek van het bestand (alles ervoor bleef staan).
    if (at < 0) at = firstIndex;
    result.splice(at, 0, { key: newKey(), doc, source, rotation: 0 });
  }
  return result;
}

/** Of twee plannen hetzelfde resultaat geven (zelfde pagina's, volgorde en draaiing). */
export function samePlan(a: readonly PageItem[], b: readonly PageItem[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (page, i) =>
        page.doc === b[i]!.doc && page.source === b[i]!.source && page.rotation === b[i]!.rotation,
    )
  );
}

/* Ongedaan maken en opnieuw */

/** De stappen van een bewerking, voor ongedaan maken en opnieuw. Voor het pagina-plan, maar ook voor annotaties. */
export type History<T = PageItem[]> = {
  past: T[];
  present: T;
  future: T[];
};

/** Zoveel stappen kun je terug; genoeg voor gewoon gebruik, en het geheugen blijft begrensd. */
export const HISTORY_LIMIT = 100;

export function startHistory<T = PageItem[]>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Een nieuwe stap. Een stap die niets verandert telt niet mee; "opnieuw" vervalt. */
export function record<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

export function undo<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future as [T, ...T[]];
  return { past: [...history.past, history.present], present: next, future: rest };
}
