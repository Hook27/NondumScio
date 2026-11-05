import {
  analyseRunning,
  layoutBlock,
  pageText,
  type LayoutOptions,
  type PageText,
  type Piece,
} from '../compare/layout';

/**
 * PDF → Platte tekst: de tekstlaag van een PDF als lopende tekst, met dezelfde opmaakregels als
 * PDF's vergelijken (`../compare/layout`). Overgenomen uit de losse pdf-tekst-extractor: met
 * leesvakken wordt alleen gelezen wat in de vakken staat, vak voor vak; zonder vakken de hele
 * pagina. Koppen, tabellen, pagina-ankers en de rest komen in latere stappen.
 */

/** De instellingen: dezelfde als bij het opbouwen van de tekst voor het vergelijken. */
export type TextOptions = LayoutOptions;

/**
 * De standaard van de losse pdf-tekst-extractor, met twee bewuste afwijkingen, zoals bij PDF's
 * vergelijken: zonder leesvakken gaan terugkerende kop- en voetteksten eruit (die kende de
 * extractor niet; daar moest je er leesvakken voor tekenen), en de alinea-gevoeligheid is 1,3 in
 * plaats van 1,6. Word zet standaard 8 pt witruimte na een alinea, ongeveer 1,55 keer de
 * regelafstand: bij 1,6 werd een hele pagina één alinea.
 */
export const DEFAULT_TEXT_OPTIONS: TextOptions = {
  strip: true,
  columns: true,
  dehyphen: true,
  joinLines: true,
  gapFactor: 1.3,
};

/**
 * Een leesvak: een rechthoek als deel van de pagina (0 tot 1), gemeten vanaf linksboven, zoals je
 * hem op het voorbeeld ziet. Zo past hij bij elke zoom en op elke pagina.
 */
export type Zone = { x0: number; y0: number; x1: number; y1: number };

/**
 * Een pagina is gelezen, had geen tekstlaag (een scan of alleen een afbeelding), of is
 * overgeslagen (leesvakken aan, maar geen vak voor deze pagina).
 */
export type PageStatus = 'read' | 'notext' | 'skipped';

export type PageResult = { no: number; text: string; status: PageStatus };

export type Extraction = {
  /** De hele tekst: de pagina's na elkaar, met een witregel ertussen. */
  text: string;
  pages: PageResult[];
};

/** Minder tekens dan dit op een gelezen pagina: "nauwelijks tekst", zoals in de extractor. */
export const LOW_TEXT = 25;

/**
 * De tekststukjes in een vak: een stukje telt mee als zijn midden in het vak ligt. De tekst staat
 * in punten vanaf linksonder, het vak als deel van de pagina vanaf linksboven.
 */
export function zoneItems(page: PageText, zone: Zone): Piece[] {
  const x0 = zone.x0 * page.w;
  const x1 = zone.x1 * page.w;
  const top = page.h - zone.y0 * page.h;
  const bottom = page.h - zone.y1 * page.h;
  return page.items.filter((item) => {
    const cx = item.x + item.w / 2;
    const cy = item.y + item.fh / 2;
    return cx >= x0 && cx <= x1 && cy <= top && cy >= bottom;
  });
}

/**
 * De tekst van één pagina met leesvakken: elk vak apart, in de volgorde van de vakken, met een
 * witregel ertussen. Binnen een vak geen kolommen (een vak is al één kolom) en geen kop- en
 * voetteksten weglaten (wat buiten de vakken staat, vervalt al).
 */
function zonesText(page: PageText, zones: readonly Zone[], opts: TextOptions): string {
  return zones
    .map((zone) => layoutBlock(zoneItems(page, zone), opts, false).trim())
    .filter((text) => text !== '')
    .join('\n\n');
}

/**
 * De tekst van alle pagina's. `zones` is null als de leesvakken uit staan: dan de hele pagina,
 * met kolommen en zonder terugkerende kop- en voetteksten (als die instellingen aan staan). Staan
 * de leesvakken aan maar is er geen vak, dan wordt de pagina overgeslagen, zoals in de extractor.
 * Pagina's zonder tekst komen er niet in, ook geen witregel.
 */
export function extractText(
  pages: readonly PageText[],
  opts: TextOptions,
  zones: readonly Zone[] | null = null,
): Extraction {
  const running = zones === null && opts.strip ? analyseRunning(pages) : null;
  const results = pages.map((page, index): PageResult => {
    if (page.items.length === 0) return { no: page.no, text: '', status: 'notext' };
    if (zones === null)
      return { no: page.no, text: pageText(page, opts, running?.[index]), status: 'read' };
    if (zones.length === 0) return { no: page.no, text: '', status: 'skipped' };
    return { no: page.no, text: zonesText(page, zones, opts), status: 'read' };
  });
  const text = results
    .map((result) => result.text.trim())
    .filter((t) => t !== '')
    .join('\n\n');
  return { text, pages: results };
}

/** Wat opvalt aan de gelezen tekst: om te zien of de PDF wel een bruikbare tekstlaag heeft. */
export type Quality = {
  /** Het aantal gelezen pagina's (met een tekstlaag). */
  read: number;
  /** Gemiddeld aantal tekens per gelezen pagina, afgerond. */
  average: number;
  /** Pagina's zonder tekstlaag. */
  noText: number[];
  /** Overgeslagen pagina's (geen leesvak). */
  skipped: number[];
  /** Gelezen pagina's met nauwelijks tekst. */
  low: number[];
};

export function quality(pages: readonly PageResult[]): Quality {
  const read = pages.filter((page) => page.status === 'read');
  const total = read.reduce((sum, page) => sum + page.text.trim().length, 0);
  const numbers = (status: PageStatus) =>
    pages.filter((page) => page.status === status).map((page) => page.no);
  return {
    read: read.length,
    average: read.length > 0 ? Math.round(total / read.length) : 0,
    noText: numbers('notext'),
    skipped: numbers('skipped'),
    low: read.filter((page) => page.text.trim().length < LOW_TEXT).map((page) => page.no),
  };
}

/** Een vak binnen de pagina, met de kleinste waarden links en boven. */
export function clampZone(zone: Zone): Zone {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    x0: clamp(Math.min(zone.x0, zone.x1)),
    y0: clamp(Math.min(zone.y0, zone.y1)),
    x1: clamp(Math.max(zone.x0, zone.x1)),
    y1: clamp(Math.max(zone.y0, zone.y1)),
  };
}

/** Welke kant of hoek van een vak je versleept: n(oord), z = s, o = e, w, of een hoek. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** Een vak met een versleepte kant of hoek naar (`x`, `y`), als deel van de pagina. */
export function resizeZone(zone: Zone, handle: Handle, x: number, y: number): Zone {
  const next = { ...zone };
  if (handle.includes('w')) next.x0 = x;
  if (handle.includes('e')) next.x1 = x;
  if (handle.includes('n')) next.y0 = y;
  if (handle.includes('s')) next.y1 = y;
  return clampZone(next);
}

/** Een vak verschoven over (`dx`, `dy`), zonder dat het buiten de pagina komt. */
export function moveZone(zone: Zone, dx: number, dy: number): Zone {
  const w = zone.x1 - zone.x0;
  const h = zone.y1 - zone.y0;
  const x0 = Math.max(0, Math.min(1 - w, zone.x0 + dx));
  const y0 = Math.max(0, Math.min(1 - h, zone.y0 + dy));
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

/** De naam van het tekstbestand, zoals in de extractor: "brief.pdf" → "brief_extract.txt". */
export function exportName(fileName: string): string {
  return `${fileName.replace(/\.pdf$/i, '') || 'pdf-tekst'}_extract.txt`;
}
