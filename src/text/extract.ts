import { analyseRunning, pageText, type LayoutOptions, type PageText } from '../compare/layout';

/**
 * PDF → Platte tekst: de tekstlaag van alle pagina's als lopende tekst, met dezelfde opmaakregels
 * als PDF's vergelijken (`../compare/layout`). Overgenomen uit de losse pdf-tekst-extractor; de
 * leesvakken, koppen, tabellen, pagina-ankers en de rest komen in latere stappen.
 */

/** De instellingen: dezelfde als bij het opbouwen van de tekst voor het vergelijken. */
export type TextOptions = LayoutOptions;

/**
 * De standaard van de losse pdf-tekst-extractor, met twee bewuste afwijkingen, zoals bij PDF's
 * vergelijken: terugkerende kop- en voetteksten gaan eruit (die kende de extractor niet; daar
 * moest je er leesvakken voor tekenen), en de alinea-gevoeligheid is 1,3 in plaats van 1,6. Word
 * zet standaard 8 pt witruimte na een alinea, ongeveer 1,55 keer de regelafstand: bij 1,6 werd een
 * hele pagina één alinea.
 */
export const DEFAULT_TEXT_OPTIONS: TextOptions = {
  strip: true,
  columns: true,
  dehyphen: true,
  joinLines: true,
  gapFactor: 1.3,
};

/** Een pagina is gelezen, of had geen tekstlaag (een scan of alleen een afbeelding). */
export type PageStatus = 'read' | 'notext';

export type PageResult = { no: number; text: string; status: PageStatus };

export type Extraction = {
  /** De hele tekst: de pagina's na elkaar, met een witregel ertussen. */
  text: string;
  pages: PageResult[];
};

/** Minder tekens dan dit op een gelezen pagina: "nauwelijks tekst", zoals in de extractor. */
export const LOW_TEXT = 25;

/** De tekst van alle pagina's. Pagina's zonder tekst komen er niet in, ook geen witregel. */
export function extractText(pages: readonly PageText[], opts: TextOptions): Extraction {
  const running = opts.strip ? analyseRunning(pages) : null;
  const results = pages.map((page, index): PageResult =>
    page.items.length === 0
      ? { no: page.no, text: '', status: 'notext' }
      : { no: page.no, text: pageText(page, opts, running?.[index]), status: 'read' },
  );
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
  /** Gelezen pagina's met nauwelijks tekst. */
  low: number[];
};

export function quality(pages: readonly PageResult[]): Quality {
  const read = pages.filter((page) => page.status === 'read');
  const total = read.reduce((sum, page) => sum + page.text.trim().length, 0);
  return {
    read: read.length,
    average: read.length > 0 ? Math.round(total / read.length) : 0,
    noText: pages.filter((page) => page.status === 'notext').map((page) => page.no),
    low: read.filter((page) => page.text.trim().length < LOW_TEXT).map((page) => page.no),
  };
}

/** De naam van het tekstbestand, zoals in de extractor: "brief.pdf" → "brief_extract.txt". */
export function exportName(fileName: string): string {
  return `${fileName.replace(/\.pdf$/i, '') || 'pdf-tekst'}_extract.txt`;
}
