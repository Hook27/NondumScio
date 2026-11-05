import { useEffect, useState } from 'preact/hooks';
import type { PageText } from '../compare/layout';
import { readPdf } from '../compare/readPdf';
import type { LoadErrorCode } from '../pdf/detect';
import { PdfLoadError } from '../pdf/loader';
import { DEFAULT_TEXT_OPTIONS, extractText, type Extraction, type TextOptions } from './extract';

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

export type TextState = {
  slot: TextSlot;
  /** De tekst, zodra de PDF gelezen is; opnieuw opgebouwd bij elke andere instelling. */
  result: Extraction | null;
  /** Er werd meer dan één PDF tegelijk gekozen; alleen de eerste telt. */
  tooMany: boolean;
  /** De instellingen; ze blijven staan bij Wissen. */
  options: TextOptions;
};

const EMPTY: TextSlot = { status: 'empty' };

const INITIAL: TextState = {
  slot: EMPTY,
  result: null,
  tooMany: false,
  options: DEFAULT_TEXT_OPTIONS,
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

/** Het plaatje van een document niet langer vasthouden. */
function release(slot: TextSlot) {
  if (slot.status === 'ready' && slot.doc.thumb) URL.revokeObjectURL(slot.doc.thumb);
}

/** Zet het document neer en bouwt de tekst op als het gelezen is. */
function setSlot(slot: TextSlot, extra: Partial<TextState> = {}) {
  const options = extra.options ?? state.options;
  const result = slot.status === 'ready' ? extractText(slot.doc.pages, options) : null;
  setState({ slot, result, ...extra });
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
    put({ status: 'ready', doc: { file, pageCount, pages, thumb: url } });
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

/** De PDF weghalen; wat nog gelezen wordt, komt er niet meer bij. De instellingen blijven. */
export function clearText(): void {
  lastRead++;
  release(state.slot);
  setSlot(EMPTY, { tooMany: false });
}

/** Een instelling veranderen; de tekst wordt meteen opnieuw opgebouwd. */
export function setOptions(change: Partial<TextOptions>): void {
  setSlot(state.slot, { options: { ...state.options, ...change } });
}

/** Alleen voor tests: begin opnieuw. */
export function resetTextState(): void {
  clearText();
  state = INITIAL;
}
