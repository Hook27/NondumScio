import {
  analyseRunning,
  layoutBlock,
  pageText,
  type LayoutOptions,
  type PageText,
  type Piece,
} from '../compare/layout';
import { DUTCH_HEAD, EMPTY_META, withHead, type HeadTexts, type Meta } from './header';
import { DUTCH_CONCORDANCE, assemble, printedPages, type Assembly } from './pages';

/**
 * PDF → Platte tekst: de tekstlaag van een PDF als lopende tekst, met dezelfde opmaakregels als
 * PDF's vergelijken (`../compare/layout`). Overgenomen uit de losse pdf-tekst-extractor: met
 * leesvakken wordt alleen gelezen wat in de vakken staat, vak voor vak; zonder vakken de hele
 * pagina; met pagina-ankers en doorlopende zinnen over de pagina-overgang (`./pages`), en
 * bovenaan eventueel een conventieblok en een documentkop (`./header`).
 */

/**
 * De instellingen: dezelfde als bij het opbouwen van de tekst voor het vergelijken, met hier altijd
 * ook opsommingen en koppen, de kopmarkering en tabellen (de vergelijker laat die weg).
 */
export type TextOptions = Required<LayoutOptions> & {
  /** Elke pagina begint met {p#}, met een paginaconcordantie onderaan. */
  anchors: boolean;
  /** Een zin die over de pagina-overgang doorloopt weer aan elkaar zetten. */
  crossPage: boolean;
  /** Bovenaan een documentkop: bestandsnaam, titel, auteur, onderwerp en datum. */
  header: boolean;
  /** Bovenaan een korte uitleg van de markeringen ({p#}, {H}). */
  conventions: boolean;
};

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
  // Zoals in de extractor: opsommingen en koppen aan, {H} en tabellen uit.
  structure: true,
  headingMarker: false,
  tables: false,
  // Zoals in de extractor: pagina-ankers en doorlopende zinnen aan.
  anchors: true,
  crossPage: true,
  // Zoals in de extractor: geen documentkop en geen conventieblok.
  header: false,
  conventions: false,
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
  /** De hele tekst: eventueel het conventieblok en de kop, dan de pagina's na elkaar. */
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

/** De leesvakken van een document: standaardvakken, eigen vakken per pagina, en lege pagina's. */
export type ZoneSetup = {
  /** De standaardvakken, voor elke pagina zonder eigen set. */
  zones: readonly Zone[];
  /** Eigen vakken per pagina (paginanummer → vakken). Een lege eigen set slaat de pagina over. */
  pages: Readonly<Record<number, readonly Zone[]>>;
  /** Een pagina zonder vakken toch helemaal lezen (anders wordt hij overgeslagen). */
  readEmpty: boolean;
};

/** Heeft deze pagina eigen vakken (ook als die set leeg is)? */
export const hasOwnZones = (setup: Pick<ZoneSetup, 'pages'>, no: number): boolean =>
  Object.prototype.hasOwnProperty.call(setup.pages, no);

/** De vakken die op een pagina gelden: de eigen set, anders de standaardvakken. */
export const zonesFor = (setup: Pick<ZoneSetup, 'zones' | 'pages'>, no: number): readonly Zone[] =>
  hasOwnZones(setup, no) ? setup.pages[no]! : setup.zones;

/**
 * Wat er naast de pagina's nodig is om de tekst samen te stellen: de afgedrukte paginanummers, de
 * keuzes per overgang en de woorden van de concordantie (`./pages`), en voor de documentkop de
 * naam van het bestand, de gegevens van de PDF en de woorden van de kop (`./header`).
 */
export type Assemble = Assembly & { name: string; meta: Meta; head: HeadTexts };

/**
 * De tekst van alle pagina's. `setup` is null als de leesvakken uit staan: dan de hele pagina,
 * met kolommen en zonder terugkerende kop- en voetteksten (als die instellingen aan staan). Met
 * leesvakken: per pagina de vakken die daar gelden. Een pagina zonder vakken wordt overgeslagen,
 * of met `readEmpty` helemaal gelezen (met kolommen, zonder kop/voet weglaten), zoals in de
 * extractor. Pagina's zonder tekst komen er niet in, ook geen witregel.
 */
export function extractText(
  pages: readonly PageText[],
  opts: TextOptions,
  setup: ZoneSetup | null = null,
  assembly: Partial<Assemble> = {},
): Extraction {
  const running = setup === null && opts.strip ? analyseRunning(pages) : null;
  const results = pages.map((page, index): PageResult => {
    if (page.items.length === 0) return { no: page.no, text: '', status: 'notext' };
    if (setup === null)
      return { no: page.no, text: pageText(page, opts, running?.[index]), status: 'read' };
    const zones = zonesFor(setup, page.no);
    if (zones.length > 0)
      return { no: page.no, text: zonesText(page, zones, opts), status: 'read' };
    if (!setup.readEmpty) return { no: page.no, text: '', status: 'skipped' };
    return { no: page.no, text: layoutBlock(page.items, opts, opts.columns), status: 'read' };
  });
  const body = assemble(results, opts, {
    printed: assembly.printed ?? printedPages(pages),
    joins: assembly.joins ?? {},
    texts: assembly.texts ?? DUTCH_CONCORDANCE,
  });
  const text = withHead(body, opts, {
    name: assembly.name ?? '',
    meta: assembly.meta ?? EMPTY_META,
    texts: assembly.head ?? DUTCH_HEAD,
  });
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
