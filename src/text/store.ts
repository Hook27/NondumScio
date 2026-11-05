import { useEffect, useState } from 'preact/hooks';
import type { PageText } from '../compare/layout';
import { readPdf } from '../compare/readPdf';
import { closeVisual } from '../compare/visual';
import type { LoadErrorCode } from '../pdf/detect';
import { PdfLoadError } from '../pdf/loader';
import {
  DEFAULT_TEXT_OPTIONS,
  extractText,
  type Extraction,
  type TextOptions,
  type Zone,
} from './extract';

/** Een gelezen PDF. */
export type TextDoc = {
  file: File;
  pageCount: number;
  pages: PageText[];
  /** Een klein plaatje van de eerste pagina (een blob-adres), of null. */
  thumb: string | null;
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

/** Hoeveel stappen terug "Ongedaan" kan, zoals in de extractor. */
export const UNDO_LIMIT = 60;

export type TextState = {
  slot: TextSlot;
  /** Er werd meer dan één PDF tegelijk gekozen; alleen de eerste telt. */
  tooMany: boolean;
  /** De instellingen voor de tekst; ze blijven staan bij Wissen. */
  options: TextOptions;
  /** Leesvakken gebruiken: alleen lezen wat in de vakken staat. */
  useZones: boolean;
  /** De leesvakken, in leesvolgorde; ze gelden voor alle pagina's. */
  zones: Zone[];
  /** Eerdere vakken, voor Ongedaan (de laatste het eerst). */
  undo: Zone[][];
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
};

const EMPTY: TextSlot = { status: 'empty' };

const INITIAL: TextState = {
  slot: EMPTY,
  tooMany: false,
  options: DEFAULT_TEXT_OPTIONS,
  useZones: false,
  zones: [],
  undo: [],
  view: 'preview',
  page: 1,
  fit: 'page',
  zoom: 100,
  result: null,
  stale: false,
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
    undo: [],
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
    // Alleen de PDF: de vakken en het voorbeeld zijn net bij het begin van het lezen leeggemaakt.
    release(state.slot);
    setState({ slot: { status: 'ready', doc: { file, pageCount, pages, thumb: url } } });
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
 * blijven; "Leesvakken gebruiken" gaat uit, zoals bij Reset in de extractor.
 */
export function clearText(): void {
  lastRead++;
  release(state.slot);
  setSlot(EMPTY, { tooMany: false, useZones: false });
}

/** Na het extraheren: is wat je nu instelt anders dan waarmee de tekst gemaakt is? */
const staleAfter = () => ({ stale: state.result !== null });

/** Een instelling veranderen. De tekst verandert pas bij opnieuw extraheren. */
export function setOptions(change: Partial<TextOptions>): void {
  setState({ options: { ...state.options, ...change }, ...staleAfter() });
}

/** Leesvakken aan of uit; aan zet het voorbeeld voor, om ze te kunnen tekenen. */
export function setUseZones(useZones: boolean): void {
  setState({ useZones, ...(useZones ? { view: 'preview' as const } : {}), ...staleAfter() });
}

/** Nieuwe vakken; de vorige kunnen terug met Ongedaan. */
export function setZones(zones: Zone[]): void {
  setState({
    zones,
    undo: [...state.undo, state.zones].slice(-UNDO_LIMIT),
    ...staleAfter(),
  });
}

/** Eén vak weghalen (de andere schuiven een nummer op). */
export function removeZone(index: number): void {
  setZones(state.zones.filter((_, i) => i !== index));
}

/** Alle vakken weghalen. */
export function clearZones(): void {
  if (state.zones.length > 0) setZones([]);
}

/** De vorige vakken terug. Alleen als de leesvakken aan staan, zoals in de extractor. */
export function undoZones(): void {
  if (!state.useZones || state.undo.length === 0) return;
  setState({
    zones: state.undo[state.undo.length - 1]!,
    undo: state.undo.slice(0, -1),
    ...staleAfter(),
  });
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

/** De tekst maken met de instellingen en vakken van nu, en de tekst tonen. */
export function extract(): void {
  if (state.slot.status !== 'ready') return;
  setState({
    result: extractText(state.slot.doc.pages, state.options, state.useZones ? state.zones : null),
    view: 'result',
    stale: false,
  });
}

/** Alleen voor tests: begin opnieuw. */
export function resetTextState(): void {
  clearText();
  state = INITIAL;
}
