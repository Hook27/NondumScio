import { useEffect, useState } from 'preact/hooks';
import { closeVisual } from '../compare/visual';
import {
  addFiles,
  addFolder,
  nextAfter,
  sortFolders,
  toggle,
  type Choice,
  type Decision,
  type TriageFile,
} from './triage';

/** Beoordelen (één PDF tegelijk) of het overzicht met de lijsten. */
export type TriageView = 'review' | 'overview';

/** Passend maken: de hele pagina of de breedte. */
export type Fit = 'page' | 'width';

/** Wat er bij de laatste keer toevoegen is overgeslagen. */
export type Skipped = { notPdf: number; duplicate: number };

/**
 * Voor wie het venster "Verplaatsen naar" open is: de PDF van nu (toets M), één PDF in het
 * overzicht, of alle PDF's die nog niet beoordeeld zijn.
 */
export type FolderTarget =
  { kind: 'current' } | { kind: 'file'; id: number } | { kind: 'undecided' };

export type TriageState = {
  files: TriageFile[];
  /** Het bestand dat je bekijkt; -1 zonder bestanden. */
  cur: number;
  view: TriageView;
  fit: Fit;
  /** Procent van passend (100 = passend). */
  zoom: number;
  /** Het aantal pagina's per bestand (op id), zodra de PDF gelezen is. */
  pageCounts: Record<number, number>;
  skipped: Skipped | null;
  nextId: number;
  /** De mappen die je gekozen hebt om naar te verplaatsen, in de volgorde van kiezen. */
  folders: string[];
  /** Het venster "Verplaatsen naar", als het open is. */
  asking: FolderTarget | null;
};

const INITIAL: TriageState = {
  files: [],
  cur: -1,
  view: 'review',
  // Zoals pdf-triage.html: de pagina op de breedte van het vak. Op een klein scherm is "hele
  // pagina" te klein om te lezen.
  fit: 'width',
  zoom: 100,
  pageCounts: {},
  skipped: null,
  nextId: 1,
  folders: [],
  asking: null,
};

/** Na een besluit zo lang wachten voor het volgende bestand verschijnt: dan zie je het besluit nog even. */
export const ADVANCE_MS = 200;

/**
 * De stand van Archief / Triage, buiten het scherm bewaard: wie naar een andere taak gaat en
 * terugkomt, vindt de lijst en de besluiten terug (zolang de pagina open blijft).
 */
let state: TriageState = INITIAL;
const listeners = new Set<() => void>();
/** Het wachten op het volgende bestand na een besluit. */
let advance: ReturnType<typeof setTimeout> | null = null;

export function getTriageState(): TriageState {
  return state;
}

function setState(change: Partial<TriageState>) {
  state = { ...state, ...change };
  for (const listener of listeners) listener();
}

/** De stand, en opnieuw tekenen als die verandert. */
export function useTriageState(): TriageState {
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

function stopAdvance() {
  if (advance !== null) clearTimeout(advance);
  advance = null;
}

/** Voegt PDF's toe; zonder bestand open wordt de eerste nieuwe geopend, zoals in pdf-triage.html. */
export function addTriageFiles(files: readonly File[]): void {
  const result = addFiles(state.files, files, state.nextId);
  setState({
    files: result.list,
    nextId: result.nextId,
    skipped:
      result.notPdf + result.duplicate > 0
        ? { notPdf: result.notPdf, duplicate: result.duplicate }
        : null,
  });
  if (state.cur === -1 && state.files.length > 0) select(0);
}

/**
 * Naar een bestand in de lijst (en naar Beoordelen). De PDF van het vorige bestand gaat dicht:
 * bij een lange lijst blijven ze anders allemaal open.
 */
export function select(index: number): void {
  if (index < 0 || index >= state.files.length) return;
  stopAdvance();
  const before = state.files[state.cur];
  if (before && index !== state.cur) closeVisual(before.file);
  setState({ cur: index, view: 'review' });
}

/** Naar het vorige (-1) of volgende (1) bestand. */
export function navigate(dir: -1 | 1): void {
  select(state.cur + dir);
}

/**
 * Bewaren, verplaatsen of verwijderen voor het bestand van nu; nog eens dezelfde keuze haalt het
 * besluit weg. Na een besluit volgt na `ADVANCE_MS` het volgende nog niet beoordeelde bestand.
 */
export function decide(choice: Choice): void {
  const current = state.files[state.cur];
  if (!current) return;
  stopAdvance();
  const decision = toggle(current.decision, choice);
  const files = state.files.map((entry, i) => (i === state.cur ? { ...entry, decision } : entry));
  setState({ files });
  if (decision === null) return;
  const next = nextAfter(files, state.cur);
  if (next === null) return;
  advance = setTimeout(() => {
    advance = null;
    select(next);
  }, ADVANCE_MS);
}

/** Verplaatsen naar de map met dit nummer (1–9) in de lijst op naam; zonder die map niets. */
export function moveToNumber(n: number): void {
  const folder = sortFolders(state.folders)[n - 1];
  if (folder !== undefined) decide({ move: folder });
}

/** Een besluit voor één PDF in het overzicht; daar ga je niet vanzelf verder. */
export function setDecision(id: number, decision: Decision): void {
  stopAdvance();
  setState({
    files: state.files.map((entry) => (entry.id === id ? { ...entry, decision } : entry)),
  });
}

/** Het venster "Verplaatsen naar" openen of sluiten. */
export function askFolder(target: FolderTarget | null): void {
  setState({ asking: target });
}

/**
 * De map uit het venster "Verplaatsen naar": een nieuwe naam komt bij de gekozen mappen (een naam
 * die er al staat, ook met andere hoofdletters, is dezelfde map). Dan verplaatsen, voor wie het
 * venster open was: de PDF van nu (en verder naar de volgende), één PDF, of alle PDF's die nog niet
 * beoordeeld zijn. Geeft false bij een lege naam; het venster blijft dan open.
 */
export function chooseFolder(typed: string): boolean {
  const target = state.asking;
  const { folders, name } = addFolder(state.folders, typed);
  if (!target || name === null) return false;
  setState({ folders, asking: null });
  const move = { move: name };
  if (target.kind === 'current') {
    // Altijd naar deze map, ook als hij al gekozen was: nog eens kiezen haalt het hier niet weg.
    const current = state.files[state.cur];
    if (current && current.decision !== null && toggle(current.decision, move) === null)
      return true;
    decide(move);
  } else if (target.kind === 'file') {
    setDecision(target.id, move);
  } else {
    setState({
      files: state.files.map((entry) =>
        entry.decision === null ? { ...entry, decision: move } : entry,
      ),
    });
  }
  return true;
}

/** Het aantal pagina's van een bestand, zodra de PDF gelezen is. */
export function setPageCount(id: number, count: number): void {
  if (state.pageCounts[id] === count) return;
  setState({ pageCounts: { ...state.pageCounts, [id]: count } });
}

/** Naar een pagina van het bestand van nu (binnen de PDF); elk bestand onthoudt zijn pagina. */
export function setPage(page: number): void {
  const current = state.files[state.cur];
  if (!current) return;
  const total = state.pageCounts[current.id] ?? 1;
  const next = Math.max(1, Math.min(total, Math.round(page)));
  if (next === current.page) return;
  setState({
    files: state.files.map((entry, i) => (i === state.cur ? { ...entry, page: next } : entry)),
  });
}

/** Passend maken: de hele pagina of de breedte. */
export function setFit(fit: Fit): void {
  setState({ fit, zoom: 100 });
}

export function setZoom(zoom: number): void {
  setState({ zoom });
}

export function setView(view: TriageView): void {
  stopAdvance();
  setState({ view });
}

/** Alles wissen: de lijst en de besluiten. Zoom en passend blijven. */
export function clearTriage(): void {
  stopAdvance();
  const current = state.files[state.cur];
  if (current) closeVisual(current.file);
  setState({
    files: [],
    cur: -1,
    view: 'review',
    pageCounts: {},
    skipped: null,
    folders: [],
    asking: null,
  });
}

/** Terug naar het begin (voor de tests). */
export function resetTriageState(): void {
  clearTriage();
  state = INITIAL;
}
