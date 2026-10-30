import { useEffect, useState } from 'preact/hooks';
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
  manualName: boolean;
  customName: string;
  showText: boolean;
  error: boolean;
};

export type RenameState = {
  docs: RenameDoc[];
  reading: boolean;
  showAll: boolean;
  /** De melding na het downloaden. */
  saved: string | null;
  /** Er is iets veranderd sinds het laatste downloaden. */
  changed: boolean;
};

const INITIAL: RenameState = {
  docs: [],
  reading: false,
  showAll: true,
  saved: null,
  changed: false,
};

/**
 * De stand van Slim hernoemen, buiten het scherm bewaard: wie naar een andere taak gaat en terugkomt,
 * vindt alles terug zoals het was (zolang de pagina open blijft). Los van de gewone taken.
 */
let state: RenameState = INITIAL;
const listeners = new Set<() => void>();

export function getRenameState(): RenameState {
  return state;
}

export function setRenameState(change: (current: RenameState) => Partial<RenameState>): void {
  state = { ...state, ...change(state) };
  syncWarning();
  for (const listener of listeners) listener();
}

/** De stand, en opnieuw tekenen als die verandert. */
export function useRenameState(): RenameState {
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

/** Alleen voor tests: begin opnieuw. */
export function resetRenameState(): void {
  setRenameState(() => INITIAL);
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
