import { useEffect, useState } from 'preact/hooks';
import { loadDb, saveDb, type RenameDb } from './database';
import type { DateCandidate } from './recognize';

/** Eén geopende PDF met wat erin herkend is en wat de gebruiker ervan maakt. */
export type RenameDoc = {
  id: number;
  file: File;
  include: boolean;
  /** Herkende tekst (regels), leeg als de PDF geen tekstlaag heeft. */
  lines: string[];
  dates: DateCandidate[];
  date: string;
  sender: string;
  subject: string;
  /** Afzender of onderwerp is herkend uit de database (tot je het veld zelf aanpast). */
  senderRec: boolean;
  subjectRec: boolean;
  manualName: boolean;
  customName: string;
  showText: boolean;
  error: boolean;
  /** Aantal pagina's (voor het samenvoegen); 0 als de PDF niet te lezen was. */
  pageCount: number;
};

/** Een al hernoemde PDF die je los toevoegt, alleen om mee samen te voegen. */
export type ExtraDoc = {
  id: number;
  file: File;
  /** JJMMDD uit de bestandsnaam, of leeg. */
  date: string;
  pageCount: number;
  error: boolean;
};

/** Wat de tool laat zien: de brieven om te hernoemen, ze samenvoegen, of de database. */
export type RenameView = 'rename' | 'merge' | 'database';

export type RenameState = {
  view: RenameView;
  docs: RenameDoc[];
  reading: boolean;
  showAll: boolean;
  /** De melding na het downloaden (of na opnieuw herkennen). */
  saved: string | null;
  /** Er is iets veranderd sinds het laatste downloaden. */
  changed: boolean;
  /** Samenvoegen: los toegevoegde, al hernoemde PDF's. */
  extras: ExtraDoc[];
  /** Samenvoegen: de eigen volgorde (ids) na schuiven, of `null` om op datum te sorteren. */
  mergeOrder: number[] | null;
  /** Samenvoegen: de PDF's (ids) die uitgezet zijn. */
  mergeSkip: ReadonlySet<number>;
  /** Samenvoegen: een bladwijzer per brief, met zijn nieuwe naam. */
  bookmarks: boolean;
};

const INITIAL: RenameState = {
  view: 'rename',
  docs: [],
  reading: false,
  showAll: true,
  saved: null,
  changed: false,
  extras: [],
  mergeOrder: null,
  mergeSkip: new Set(),
  bookmarks: true,
};

/** Wat Wissen leeg maakt: de brieven, de losse PDF's en wat je bij samenvoegen koos. */
export function clearRename(): void {
  setRenameState(() => ({
    docs: [],
    extras: [],
    mergeOrder: null,
    mergeSkip: new Set(),
    saved: null,
    changed: false,
  }));
}

let lastId = 0;

/** Een nieuw nummer voor een brief of losse PDF; uniek over beide. */
export function newId(): number {
  lastId += 1;
  return lastId;
}

/**
 * De stand van Slim hernoemen, buiten het scherm bewaard: wie naar een andere taak gaat en terugkomt,
 * vindt alles terug zoals het was (zolang de pagina open blijft). Los van de gewone taken.
 */
let state: RenameState = INITIAL;
const listeners = new Set<() => void>();

/*
 * De database met afzenders en onderwerpen. Die staat in de browser en blijft dus ook na het
 * sluiten; hij wordt pas gelezen als de tool hem nodig heeft. Elke wijziging wordt meteen bewaard.
 */
let db: RenameDb | null = null;

export function getRenameState(): RenameState {
  return state;
}

export function setRenameState(change: (current: RenameState) => Partial<RenameState>): void {
  state = { ...state, ...change(state) };
  syncWarning();
  notify();
}

function notify() {
  for (const listener of listeners) listener();
}

/** Opnieuw tekenen als de stand of de database verandert. */
function useRedraw() {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const redraw = () => setVersion((n) => n + 1);
    listeners.add(redraw);
    return () => {
      listeners.delete(redraw);
    };
  }, []);
}

/** De stand, en opnieuw tekenen als die verandert. */
export function useRenameState(): RenameState {
  useRedraw();
  return state;
}

/** Alleen voor tests: begin opnieuw. */
export function resetRenameState(): void {
  setRenameState(() => INITIAL);
  db = null;
}

export function getRenameDb(): RenameDb {
  return (db ??= loadDb());
}

export function setRenameDb(next: RenameDb): void {
  if (next === db) return;
  db = next;
  saveDb(next);
  notify();
}

/** De database, en opnieuw tekenen als die verandert. */
export function useRenameDb(): RenameDb {
  useRedraw();
  return getRenameDb();
}

/*
 * Sluit iemand het tabblad of herlaadt hij met resultaten die nog niet gedownload zijn, dan
 * waarschuwt de browser (zoals bij de gewone taken): die stand gaat dan wel verloren.
 */
const warn = (event: BeforeUnloadEvent) => {
  event.preventDefault();
  // Voor oudere browsers, die alleen naar returnValue kijken.
  event.returnValue = '';
};
let warning: Window | null = null;

function syncWarning() {
  const needed = state.changed && state.docs.length > 0;
  if (needed && !warning && typeof window !== 'undefined') {
    // Het doel onthouden: opruimen kan na het einde van een test vallen, als `window` al weg is.
    warning = window;
    warning.addEventListener('beforeunload', warn);
  } else if (!needed && warning) {
    warning.removeEventListener('beforeunload', warn);
    warning = null;
  }
}
