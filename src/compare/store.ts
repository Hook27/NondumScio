import { useEffect, useState } from 'preact/hooks';
import { PdfLoadError } from '../pdf/loader';
import type { LoadErrorCode } from '../pdf/detect';
import { DEFAULT_OPTIONS, compareTexts, type CompareOptions, type TextComparison } from './diff';
import type { PageText } from './layout';
import type { DocInfo } from './profile';
import { readPdf } from './readPdf';

/** Welk document: A (het origineel) of B (de nieuwe versie). */
export type Side = 'a' | 'b';

/** Wat je vergelijkt: de tekst of het documentprofiel. */
export type CompareTab = 'text' | 'profile';

/** Hoe de verschillen te zien zijn: A en B naast elkaar, of onder elkaar in één kolom. */
export type CompareView = 'split' | 'unified';

/** Een gelezen PDF. */
export type CompareDoc = {
  file: File;
  pageCount: number;
  pages: PageText[];
  /** De gegevens uit het document (titel, auteur, datums…). */
  info: DocInfo;
  /** Een klein plaatje van de eerste pagina (een blob-adres), of null. */
  thumb: string | null;
};

export type Slot =
  | { status: 'empty' }
  | { status: 'reading'; name: string; done: number; total: number }
  | { status: 'error'; name: string; code: LoadErrorCode }
  | { status: 'ready'; doc: CompareDoc };

export type CompareState = {
  a: Slot;
  b: Slot;
  /** De vergelijking van de tekst, zodra A en B er allebei zijn. */
  result: TextComparison | null;
  /** Ingeklapte ongewijzigde stukken die je hebt opengeklikt (nummers van rijen). */
  expanded: ReadonlySet<number>;
  /** Er werden meer dan twee PDF's tegelijk gekozen; alleen de eerste twee tellen. */
  tooMany: boolean;
  /** De instellingen voor het vergelijken; ze blijven staan bij Wissen. */
  options: CompareOptions;
  /** Ongewijzigde stukken inklappen. */
  onlyDiff: boolean;
  /** Naast elkaar of onder elkaar; blijft staan bij Wissen, zoals de instellingen. */
  view: CompareView;
  /** Tekst of profiel; na Wissen weer de tekst, zoals in de losse pdf-vergelijker. */
  tab: CompareTab;
};

const EMPTY: Slot = { status: 'empty' };

const INITIAL: CompareState = {
  a: EMPTY,
  b: EMPTY,
  result: null,
  expanded: new Set(),
  tooMany: false,
  options: DEFAULT_OPTIONS,
  onlyDiff: true,
  view: 'split',
  tab: 'text',
};

/**
 * De stand van PDF's vergelijken, buiten het scherm bewaard: wie naar een andere taak gaat en
 * terugkomt, vindt alles terug zoals het was (zolang de pagina open blijft).
 */
let state: CompareState = INITIAL;
const listeners = new Set<() => void>();

export function getCompareState(): CompareState {
  return state;
}

function setState(change: Partial<CompareState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

/** De stand, en opnieuw tekenen als die verandert. */
export function useCompareState(): CompareState {
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

/** Het plaatje van een document niet langer vasthouden. */
function release(slot: Slot) {
  if (slot.status === 'ready' && slot.doc.thumb) URL.revokeObjectURL(slot.doc.thumb);
}

/** Zet de documenten neer en vergelijkt opnieuw als ze er allebei zijn. */
function setSlots(a: Slot, b: Slot, extra: Partial<CompareState> = {}) {
  const options = extra.options ?? state.options;
  const result =
    a.status === 'ready' && b.status === 'ready'
      ? compareTexts(a.doc.pages, b.doc.pages, options)
      : null;
  setState({ a, b, result, expanded: new Set(), ...extra });
}

/**
 * Per kant het nummer van de laatste keer lezen, zodat een PDF die nog gelezen wordt een later
 * gekozen PDF niet overschrijft. Eén teller voor beide kanten: elk nummer is uniek.
 */
const reads: Record<Side, number> = { a: 0, b: 0 };
let lastRead = 0;

async function load(side: Side, file: File) {
  const token = ++lastRead;
  reads[side] = token;
  const current = () => reads[side] === token;
  const put = (slot: Slot) => {
    if (!current()) return;
    release(state[side]);
    setSlots(side === 'a' ? slot : state.a, side === 'b' ? slot : state.b);
  };
  put({ status: 'reading', name: file.name, done: 0, total: 0 });
  try {
    const { pageCount, pages, info, thumb } = await readPdf(file, (done, total) => {
      // Alleen de voortgang: de vergelijking hoeft daarvoor niet opnieuw.
      if (current()) setState({ [side]: { status: 'reading', name: file.name, done, total } });
    });
    const url = thumb
      ? URL.createObjectURL(new Blob([thumb as BlobPart], { type: 'image/png' }))
      : null;
    if (!current()) {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    put({ status: 'ready', doc: { file, pageCount, pages, info, thumb: url } });
  } catch (error) {
    put({
      status: 'error',
      name: file.name,
      code: error instanceof PdfLoadError ? error.code : 'damaged',
    });
  }
}

/**
 * Opent gekozen PDF's. Eén bestand komt op de gekozen kant; twee tegelijk worden A en B, in de
 * volgorde waarin ze binnenkomen (met Omwisselen zet je ze andersom). Meer dan twee: alleen de
 * eerste twee.
 */
export function openFiles(side: Side, files: readonly File[]): Promise<void> {
  const [first, second] = files;
  setState({ tooMany: files.length > 2 });
  if (!first) return Promise.resolve();
  if (!second) return load(side, first);
  return Promise.all([load('a', first), load('b', second)]).then(() => undefined);
}

/** Wordt er nog een PDF gelezen? */
export const isReading = (current: CompareState) =>
  current.a.status === 'reading' || current.b.status === 'reading';

/** A en B omwisselen (niet tijdens het lezen; de knop staat dan uit). */
export function swapSides(): void {
  if (isReading(state)) return;
  setSlots(state.b, state.a);
}

/** Beide documenten weghalen; wat nog gelezen wordt, komt er niet meer bij. */
export function clearCompare(): void {
  reads.a = ++lastRead;
  reads.b = ++lastRead;
  release(state.a);
  release(state.b);
  setSlots(EMPTY, EMPTY, { tooMany: false, tab: 'text' });
}

/** Een instelling veranderen; er wordt meteen opnieuw vergeleken. */
export function setOptions(change: Partial<CompareOptions>): void {
  setSlots(state.a, state.b, { options: { ...state.options, ...change } });
}

/** Ongewijzigde stukken wel of niet inklappen (wat je had opengeklikt, klapt weer in). */
export function setOnlyDiff(onlyDiff: boolean): void {
  setState({ onlyDiff, expanded: new Set() });
}

/** De tekst of het documentprofiel vergelijken. */
export function setTab(tab: CompareTab): void {
  setState({ tab });
}

/** De verschillen naast elkaar of onder elkaar tonen. */
export function setView(view: CompareView): void {
  setState({ view });
}

/** Ingeklapte stukken (rijen `from` tot en met `to`) openklikken. */
export function expandRows(from: number, to: number): void {
  const expanded = new Set(state.expanded);
  for (let i = from; i <= to; i++) expanded.add(i);
  setState({ expanded });
}

/** Alleen voor tests: begin opnieuw. */
export function resetCompareState(): void {
  clearCompare();
  state = INITIAL;
}
