import { useEffect, useState } from 'preact/hooks';
import type { PageText } from '../compare/layout';
import { readPdf } from '../compare/readPdf';
import { closeVisual } from '../compare/visual';
import type { LoadErrorCode } from '../pdf/detect';
import { PdfLoadError } from '../pdf/loader';
import {
  DEFAULT_TEXT_OPTIONS,
  extractText,
  hasOwnZones,
  type Extraction,
  type TextOptions,
  type Zone,
} from './extract';
import {
  fromSettings,
  loadStored,
  saveStored,
  settingsFileName,
  toSettings,
  type Extra,
  type Settings,
} from './settings';
import { printedPages, type ConcordanceTexts, type Join, type Printed } from './pages';

/** Een gelezen PDF. */
export type TextDoc = {
  file: File;
  pageCount: number;
  pages: PageText[];
  /** Een klein plaatje van de eerste pagina (een blob-adres), of null. */
  thumb: string | null;
  /** Het afgedrukte paginanummer per pagina (herkend bij het openen). */
  printed: Printed;
};

export type TextSlot =
  | { status: 'empty' }
  | { status: 'reading'; name: string; done: number; total: number }
  | { status: 'error'; name: string; code: LoadErrorCode }
  | { status: 'ready'; doc: TextDoc };

/** Wat er rechts staat: de pagina (om vakken te tekenen) of de tekst. */
export type TextView = 'preview' | 'result';

/** Passend in het vak: de hele pagina, of de breedte. */
export type Fit = 'page' | 'width';

/** De blokken links die je kunt in- en uitklappen. */
export type TextBlock = 'zones' | 'clean' | 'pages' | 'save';

/** Hoeveel stappen terug "Ongedaan" kan, zoals in de extractor. */
export const UNDO_LIMIT = 60;

/** De vakken van een moment: de standaardvakken en de eigen sets, voor Ongedaan. */
export type ZoneSnapshot = { zones: Zone[]; pages: Record<number, Zone[]> };

export type TextState = {
  slot: TextSlot;
  /** Er werd meer dan één PDF tegelijk gekozen; alleen de eerste telt. */
  tooMany: boolean;
  /** De instellingen voor de tekst; ze blijven staan bij Wissen. */
  options: TextOptions;
  /** Leesvakken gebruiken: alleen lezen wat in de vakken staat. */
  useZones: boolean;
  /** De standaardvakken, in leesvolgorde: voor elke pagina zonder eigen set. */
  zones: Zone[];
  /** Eigen vakken per pagina (paginanummer → vakken). */
  pages: Record<number, Zone[]>;
  /** Pagina's zonder vakken toch helemaal lezen. */
  readEmpty: boolean;
  /** De keuze per pagina-overgang: hoe pagina n aansluit op de vorige. */
  joins: Record<number, Join>;
  /** Eerdere vakken, voor Ongedaan (de laatste het eerst). */
  undo: ZoneSnapshot[];
  /** Wat de extractor ook bewaart maar hier (nog) niet gebruikt wordt. */
  extra: Extra;
  /** De instellingen van deze PDF zijn bij het openen uit de opslag teruggehaald. */
  restored: boolean;
  view: TextView;
  /** De pagina in het voorbeeld (vanaf 1). */
  page: number;
  fit: Fit;
  /** In procenten van passend. */
  zoom: number;
  /** De tekst na "Tekst extraheren". */
  result: Extraction | null;
  /** Sinds het extraheren zijn de instellingen of de vakken veranderd. */
  stale: boolean;
  /** Welke blokken links open staan; blijft staan bij Wissen. */
  blocks: Record<TextBlock, boolean>;
};

const EMPTY: TextSlot = { status: 'empty' };

const NO_EXTRA: Extra = { options: {} };

const INITIAL: TextState = {
  slot: EMPTY,
  tooMany: false,
  options: DEFAULT_TEXT_OPTIONS,
  useZones: false,
  zones: [],
  pages: {},
  readEmpty: false,
  joins: {},
  undo: [],
  extra: NO_EXTRA,
  restored: false,
  view: 'preview',
  page: 1,
  fit: 'page',
  zoom: 100,
  result: null,
  stale: false,
  blocks: { zones: true, clean: true, pages: true, save: false },
};

/**
 * De stand van PDF → Platte tekst, buiten het scherm bewaard: wie naar een andere taak gaat en
 * terugkomt, vindt alles terug zoals het was (zolang de pagina open blijft).
 */
let state: TextState = INITIAL;
const listeners = new Set<() => void>();

export function getTextState(): TextState {
  return state;
}

function setState(change: Partial<TextState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

/** De stand, en opnieuw tekenen als die verandert. */
export function useTextState(): TextState {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const redraw = () => setVersion((n) => n + 1);
    listeners.add(redraw);
    return () => {
      listeners.delete(redraw);
    };
  }, []);
  return state;
}

/** Wat er van de stand bewaard wordt. */
const settingsOf = (s: TextState): Settings => ({
  options: s.options,
  useZones: s.useZones,
  zones: s.zones,
  pages: s.pages,
  readEmpty: s.readEmpty,
  joins: s.joins,
  extra: s.extra,
});

/**
 * Iets aan de instellingen of vakken veranderen: de tekst is dan niet meer bij, en de instellingen
 * van deze PDF worden onthouden (op bestandsnaam), zoals in de extractor.
 */
function change(next: Partial<TextState>) {
  setState({ ...next, stale: state.result !== null });
  if (state.slot.status === 'ready') saveStored(state.slot.doc.file.name, settingsOf(state));
}

/** Het plaatje niet langer vasthouden, en de PDF sluiten als die voor het voorbeeld open was. */
function release(slot: TextSlot) {
  if (slot.status !== 'ready') return;
  if (slot.doc.thumb) URL.revokeObjectURL(slot.doc.thumb);
  closeVisual(slot.doc.file);
}

/** Een andere PDF (of geen): leeg begin, met de pagina passend in het vak, zoals in de extractor. */
function setSlot(slot: TextSlot, extra: Partial<TextState> = {}) {
  setState({
    slot,
    zones: [],
    pages: {},
    joins: {},
    undo: [],
    extra: NO_EXTRA,
    restored: false,
    view: 'preview',
    page: 1,
    fit: 'page',
    zoom: 100,
    result: null,
    stale: false,
    ...extra,
  });
}

/** Het nummer van de laatste keer lezen, zodat een PDF die nog gelezen wordt een later gekozen PDF niet overschrijft. */
let lastRead = 0;

async function load(file: File) {
  const token = ++lastRead;
  const current = () => lastRead === token;
  const put = (slot: TextSlot) => {
    if (!current()) return;
    release(state.slot);
    setSlot(slot);
  };
  put({ status: 'reading', name: file.name, done: 0, total: 0 });
  try {
    const { pageCount, pages, thumb } = await readPdf(file, (done, total) => {
      if (current()) setState({ slot: { status: 'reading', name: file.name, done, total } });
    });
    const url = thumb
      ? URL.createObjectURL(new Blob([thumb as BlobPart], { type: 'image/png' }))
      : null;
    if (!current()) {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    // Eerder onthouden instellingen voor deze PDF terughalen, zoals in de extractor.
    const stored = fromSettings(loadStored(file.name), settingsOf(state));
    setState({
      slot: {
        status: 'ready',
        doc: { file, pageCount, pages, thumb: url, printed: printedPages(pages) },
      },
      ...(stored ? { ...stored, restored: true } : {}),
    });
  } catch (error) {
    put({
      status: 'error',
      name: file.name,
      code: error instanceof PdfLoadError ? error.code : 'damaged',
    });
  }
}

/** Opent de gekozen PDF; bij meer dan één alleen de eerste. */
export function openFiles(files: readonly File[]): Promise<void> {
  const [first] = files;
  setState({ tooMany: files.length > 1 });
  return first ? load(first) : Promise.resolve();
}

/**
 * De PDF en de vakken weghalen; wat nog gelezen wordt, komt er niet meer bij. De instellingen
 * blijven, en wat er voor deze PDF onthouden is ook; "Leesvakken gebruiken" gaat uit.
 */
export function clearText(): void {
  lastRead++;
  release(state.slot);
  setSlot(EMPTY, { tooMany: false, useZones: false });
}

/** Een instelling veranderen. De tekst verandert pas bij opnieuw extraheren. */
export function setOptions(next: Partial<TextOptions>): void {
  change({ options: { ...state.options, ...next } });
}

/** Leesvakken aan of uit; aan zet het voorbeeld voor, om ze te kunnen tekenen. */
export function setUseZones(useZones: boolean): void {
  change({ useZones, ...(useZones ? { view: 'preview' as const } : {}) });
}

/** Hoe een pagina aansluit op de vorige: automatisch, aaneen of gescheiden. */
export function setJoin(page: number, join: Join): void {
  const joins = { ...state.joins };
  if (join === 'auto') delete joins[page];
  else joins[page] = join;
  change({ joins });
}

/** Pagina's zonder vakken toch helemaal lezen (of overslaan). */
export function setReadEmpty(readEmpty: boolean): void {
  change({ readEmpty });
}

/** Heeft de pagina in het voorbeeld eigen vakken? */
export const ownPage = (s: TextState = state): boolean => hasOwnZones(s, s.page);

/** De vakken die je op de pagina in het voorbeeld ziet en bewerkt: de eigen set of de standaard. */
export const editingZones = (s: TextState = state): Zone[] =>
  ownPage(s) ? s.pages[s.page]! : s.zones;

/** De vakken veranderen; wat er was, kan terug met Ongedaan. */
function changeZones(next: ZoneSnapshot) {
  change({
    ...next,
    undo: [...state.undo, { zones: state.zones, pages: state.pages }].slice(-UNDO_LIMIT),
  });
}

/** Nieuwe vakken voor de set die je nu bewerkt: de eigen set van deze pagina, of de standaard. */
export function setZones(zones: Zone[]): void {
  changeZones(
    ownPage()
      ? { zones: state.zones, pages: { ...state.pages, [state.page]: zones } }
      : { zones, pages: state.pages },
  );
}

/** Eén vak weghalen (de andere schuiven een nummer op). */
export function removeZone(index: number): void {
  setZones(editingZones().filter((_, i) => i !== index));
}

/** Alle vakken weghalen uit de set die je nu bewerkt. */
export function clearZones(): void {
  if (editingZones().length > 0) setZones([]);
}

/**
 * Deze pagina eigen vakken geven (beginnend met een kopie van wat er nu geldt), of de eigen set
 * weghalen zodat de standaardvakken weer gelden.
 */
export function setOwnPage(own: boolean): void {
  if (own === ownPage()) return;
  const pages = { ...state.pages };
  if (own) pages[state.page] = editingZones().map((zone) => ({ ...zone }));
  else delete pages[state.page];
  changeZones({ zones: state.zones, pages });
}

/** Elke pagina die nog geen eigen vakken heeft, krijgt een kopie van de standaardvakken. */
export function ownAllPages(): void {
  if (state.slot.status !== 'ready') return;
  const pages = { ...state.pages };
  for (let no = 1; no <= state.slot.doc.pageCount; no++)
    if (!hasOwnZones(state, no)) pages[no] = state.zones.map((zone) => ({ ...zone }));
  changeZones({ zones: state.zones, pages });
}

/** De vorige vakken terug. Alleen als de leesvakken aan staan, zoals in de extractor. */
export function undoZones(): void {
  if (!state.useZones || state.undo.length === 0) return;
  const previous = state.undo[state.undo.length - 1]!;
  change({ ...previous, undo: state.undo.slice(0, -1) });
}

/** Instellingen uit een bestand toepassen (en onthouden). Geeft false als het geen instellingen zijn. */
export function importSettings(raw: unknown): boolean {
  const next = fromSettings(raw, settingsOf(state));
  if (!next) return false;
  change({
    ...next,
    undo: [...state.undo, { zones: state.zones, pages: state.pages }].slice(-UNDO_LIMIT),
  });
  return true;
}

/** De instellingen van nu, om als bestand op te slaan (in het formaat van de extractor). */
export function exportSettings(): { name: string; json: string } | null {
  if (state.slot.status !== 'ready') return null;
  const pdf = state.slot.doc.file.name;
  return {
    name: settingsFileName(pdf),
    json: JSON.stringify(toSettings(pdf, settingsOf(state)), null, 2),
  };
}

/** Een blok links open- of dichtklappen. */
export function setBlock(block: TextBlock, open: boolean): void {
  if (state.blocks[block] !== open) setState({ blocks: { ...state.blocks, [block]: open } });
}

export function setView(view: TextView): void {
  setState({ view });
}

/** Naar een pagina van het voorbeeld (binnen het document). */
export function setPage(page: number): void {
  const total = state.slot.status === 'ready' ? state.slot.doc.pageCount : 1;
  const next = Math.max(1, Math.min(total, Math.round(page)));
  if (next !== state.page) setState({ page: next });
}

/** Passend maken: de hele pagina of de breedte. */
export function setFit(fit: Fit): void {
  setState({ fit, zoom: 100 });
}

export function setZoom(zoom: number): void {
  setState({ zoom });
}

/**
 * De tekst maken met de instellingen en vakken van nu, en de tekst tonen. `texts` zijn de woorden
 * van de paginaconcordantie, in de taal van de app.
 */
export function extract(texts?: ConcordanceTexts): void {
  if (state.slot.status !== 'ready') return;
  const setup = state.useZones
    ? { zones: state.zones, pages: state.pages, readEmpty: state.readEmpty }
    : null;
  setState({
    result: extractText(state.slot.doc.pages, state.options, setup, {
      printed: state.slot.doc.printed,
      joins: state.joins,
      ...(texts ? { texts } : {}),
    }),
    view: 'result',
    stale: false,
  });
}

/** Alleen voor tests: begin opnieuw. */
export function resetTextState(): void {
  clearText();
  state = INITIAL;
}
