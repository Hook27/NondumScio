import { useEffect, useState } from 'preact/hooks';
import { closeVisual } from '../compare/visual';
import {
  folderAt,
  mayRead,
  pathText,
  pickRoot,
  rememberRoot,
  rememberedRoot,
  scanPdfs,
  type FolderHandle,
} from './folders';
import {
  addFiles,
  addFolder,
  labelOf,
  nextAfter,
  sameFolder,
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
 * overzicht, of alle PDF's die nog niet beoordeeld zijn. Bij Map opruimen kies je in hetzelfde
 * soort venster ook de bronmap.
 */
export type FolderTarget =
  { kind: 'current' } | { kind: 'file'; id: number } | { kind: 'undecided' } | { kind: 'source' };

/** De werkwijze: een lijst maken van gekozen PDF's, of een map op de computer opruimen. */
export type TriageMode = 'list' | 'folder';

/** De hoofdmap bij Map opruimen; `ready` = we mogen erin lezen (anders eerst om toestemming vragen). */
export type RootFolder = { handle: FolderHandle; name: string; ready: boolean };

/** Het inlezen van de bronmap. */
export type ScanState =
  | { status: 'idle' }
  | { status: 'reading'; found: number }
  | { status: 'done'; found: number }
  | { status: 'error' };

/** Waarom het kiezen van de hoofdmap niet lukte: geweigerd door de browser, of geen toestemming. */
export type RootProblem = 'refused' | 'noAccess' | null;

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
  mode: TriageMode;
  root: RootFolder | null;
  rootProblem: RootProblem;
  /** De bronmap: het pad vanaf de hoofdmap (leeg = de hoofdmap zelf); null = nog niet gekozen. */
  source: string[] | null;
  /** Ook de submappen inlezen. */
  recursive: boolean;
  scan: ScanState;
  /** Nieuwe mappen (pad vanaf de hoofdmap); die worden pas aangemaakt bij Uitvoeren. */
  newFolders: string[];
  /** De laatst gekozen doelmap: het mapvenster begint daarboven, zoals in DocumentTriage. */
  lastMove: string[] | null;
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
  mode: 'list',
  root: null,
  rootProblem: null,
  source: null,
  recursive: false,
  scan: { status: 'idle' },
  newFolders: [],
  lastMove: null,
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
  const folder = sortFolders(state.folders, state.mode === 'folder')[n - 1];
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
  if (!target || target.kind === 'source' || name === null) return false;
  setState({ folders, asking: null });
  applyMove(target, name);
  return true;
}

/**
 * Bij Map opruimen: de doelmap uit het mapvenster (pad vanaf de hoofdmap; leeg = de hoofdmap zelf).
 * Daarna begint het mapvenster de volgende keer daarboven.
 */
export function chooseFolderPath(path: readonly string[]): void {
  const target = state.asking;
  if (!target || target.kind === 'source') return;
  const name = pathText(path);
  const folders = state.folders.some((folder) => sameFolder(folder, name))
    ? state.folders
    : [...state.folders, name];
  const existing = folders.find((folder) => sameFolder(folder, name))!;
  setState({ folders, asking: null, lastMove: [...path] });
  applyMove(target, existing);
}

/** Verplaatsen naar `name` voor wie het venster open was. */
function applyMove(target: Exclude<FolderTarget, { kind: 'source' }>, name: string): void {
  const move = { move: name };
  if (target.kind === 'current') {
    // Altijd naar deze map, ook als hij al gekozen was: nog eens kiezen haalt het hier niet weg.
    const current = state.files[state.cur];
    if (current && current.decision !== null && toggle(current.decision, move) === null) return;
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
}

/**
 * Een nieuwe map in het mapvenster (pad vanaf de hoofdmap; het venster kijkt zelf of hij er al
 * is). Hij wordt nog niet aangemaakt: dat gebeurt pas bij Uitvoeren, zodat er tot dan niets op je
 * computer verandert.
 */
export function addNewFolder(path: readonly string[]): void {
  setState({ newFolders: [...state.newFolders, pathText(path)] });
}

/** Naar de andere werkwijze: de lijst en de besluiten gaan weg (de vraag stelt het scherm). */
export function setMode(mode: TriageMode): void {
  if (mode === state.mode) return;
  // Bij Map opruimen haalt het scherm daarna een eerder gekozen hoofdmap terug.
  clearTriage();
  setState({ mode });
}

/** Een eerder gekozen hoofdmap terughalen; zonder toestemming moet je eerst klikken ("Verder met …"). */
export async function loadRememberedRoot(): Promise<void> {
  const handle = await rememberedRoot();
  if (!handle || state.root) return;
  const ready = await mayRead(handle, false).catch(() => false);
  if (state.root) return;
  setState({ root: { handle, name: handle.name, ready }, rootProblem: null });
}

/** "Verder met …": om toestemming vragen voor de onthouden hoofdmap (alleen na een klik). */
export async function resumeRoot(): Promise<void> {
  const root = state.root;
  if (!root) return;
  const ready = await mayRead(root.handle, true).catch(() => false);
  if (state.root !== root) return;
  setState({ root: { ...root, ready }, rootProblem: ready ? null : 'noAccess' });
}

/**
 * Een hoofdmap aanwijzen in het Windows-venster. Annuleren laat alles zoals het was; een andere
 * hoofdmap begint opnieuw (zonder bronmap en lijst).
 */
export async function chooseRoot(): Promise<void> {
  let handle: FolderHandle | null;
  try {
    handle = await pickRoot();
  } catch {
    setState({ rootProblem: 'refused' });
    return;
  }
  if (!handle) return;
  const ready = await mayRead(handle, true).catch(() => false);
  clearTriage();
  setState({ root: { handle, name: handle.name, ready }, rootProblem: ready ? null : 'noAccess' });
  if (ready) void rememberRoot(handle);
}

/** De bronmap kiezen (pad vanaf de hoofdmap) en inlezen. */
export function setSource(path: readonly string[]): void {
  setState({ source: [...path], asking: null });
  void scanSource();
}

/** Ook de submappen inlezen, of niet; met een bronmap meteen opnieuw inlezen. */
export function setRecursive(recursive: boolean): void {
  setState({ recursive });
  if (state.source) void scanSource();
}

/** Het nummer van de laatste keer inlezen, zodat een oudere keer een nieuwere niet overschrijft. */
let lastScan = 0;

/**
 * De bronmap inlezen. Een PDF die er de vorige keer ook was (zelfde pad), houdt zijn besluit en
 * pagina; zo kun je Submappen aan- en uitzetten zonder opnieuw te beginnen.
 */
export async function scanSource(): Promise<void> {
  const { root, source } = state;
  if (!root?.ready || !source) return;
  const token = ++lastScan;
  const current = () => token === lastScan;
  stopAdvance();
  setState({ scan: { status: 'reading', found: 0 } });
  try {
    const folder = await folderAt(root.handle, source);
    if (!folder) throw new Error('Map niet gevonden');
    const found = await scanPdfs(folder, state.recursive, (n) => {
      if (current()) setState({ scan: { status: 'reading', found: n } });
    });
    if (!current()) return;
    const before = new Map(state.files.map((entry) => [labelOf(entry), entry]));
    let id = state.nextId;
    const files: TriageFile[] = found.map(({ file, handle, dirs }) => {
      const entry: TriageFile = {
        id: id++,
        file,
        name: file.name,
        decision: null,
        page: 1,
        dirs,
        handle,
      };
      const old = before.get(labelOf(entry));
      return old ? { ...entry, decision: old.decision, page: old.page } : entry;
    });
    // Bij de PDF van nu blijven als die er nog is; anders de eerste.
    const previous = state.files[state.cur];
    const stay = previous ? files.findIndex((entry) => labelOf(entry) === labelOf(previous)) : -1;
    if (previous) closeVisual(previous.file);
    setState({
      files,
      nextId: id,
      cur: stay !== -1 ? stay : files.length > 0 ? 0 : -1,
      pageCounts: {},
      scan: { status: 'done', found: files.length },
    });
  } catch {
    if (current()) setState({ scan: { status: 'error' } });
  }
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
    source: null,
    scan: { status: 'idle' },
    newFolders: [],
    lastMove: null,
  });
  lastScan++;
}

/** Terug naar het begin (voor de tests). */
export function resetTriageState(): void {
  clearTriage();
  state = INITIAL;
}
