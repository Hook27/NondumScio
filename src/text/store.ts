import { useEffect, useState } from 'preact/hooks';
import type { PageText } from '../compare/layout';
import type { DocInfo } from '../compare/profile';
import { readPdf } from '../compare/readPdf';
import type { Incoming } from '../compare/store';
import { closeVisual } from '../compare/visual';
import { setUnsavedWork } from '../lib/unsavedWarning';
import { ZipTooLargeError, zipWriter, type ZipWriter } from '../lib/zip';
import type { LoadErrorCode } from '../pdf/detect';
import { PdfLoadError } from '../pdf/loader';
import { downloadFile } from '../pdf/save';
import {
  DUTCH_CONTEXT,
  combineParts,
  combinedHead,
  combinedPart,
  docText,
  hasText,
  zipNames,
  type BatchContext,
  type BatchWords,
} from './batch';
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
  isSettingsFile,
  loadStored,
  saveStored,
  settingsFileName,
  toSettings,
  type Extra,
  type Settings,
} from './settings';
import { EMPTY_META, metaFromInfo, upgradeDate, type HeadTexts, type Meta } from './header';
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
  /** De gegevens van het document (metadata), zoals pdf.js ze geeft. */
  info: DocInfo;
};

export type TextSlot =
  | { status: 'empty' }
  | { status: 'reading'; name: string; done: number; total: number }
  | { status: 'error'; name: string; code: LoadErrorCode }
  /**
   * `incoming`: een andere PDF die nog gelezen wordt, of die niet gelezen kon worden. Deze PDF, de
   * vakken en de tekst blijven staan tot de nieuwe gelezen is, en bij een fout helemaal.
   */
  | { status: 'ready'; doc: TextDoc; incoming?: Incoming };

/** Wat er rechts staat: de pagina (om vakken te tekenen) of de tekst. */
export type TextView = 'preview' | 'result';

/** Passend in het vak: de hele pagina, of de breedte. */
export type Fit = 'page' | 'width';

/** De blokken links die je kunt in- en uitklappen. */
export type TextBlock = 'zones' | 'clean' | 'meta' | 'pages' | 'batch' | 'save';

/** Een PDF uit de batch die niet gelezen kon worden: hoe hij in de melding heet, en waarom. */
export type BatchFailure = { label: string; code: LoadErrorCode };

/** Waarom er na een batch niets gedownload is. */
export type BatchProblem = 'nothing' | 'nothingRead' | 'tooLarge' | 'downloadFailed';

/** De batch: nog niet gedaan, bezig (welke PDF, welke pagina), of klaar met wat er gebeurde. */
export type BatchStatus =
  | { status: 'idle' }
  | { status: 'running'; i: number; total: number; name: string; page: number; pages: number }
  | {
      status: 'done';
      combine: boolean;
      /** Het aantal gelezen PDF's (ook zonder tekst). */
      ok: number;
      failed: BatchFailure[];
      /** Gelezen PDF's zonder tekstlaag. */
      noText: string[];
      /** De naam van de download, of null als er niets gedownload is. */
      download: string | null;
      problem: BatchProblem | null;
    };

/** Hoeveel stappen terug "Ongedaan" kan, zoals in de extractor. */
export const UNDO_LIMIT = 60;

/**
 * De vakken van een moment: de standaardvakken en de eigen sets, voor Ongedaan. Alleen bij het laden
 * van instellingen ook de keuzes per overgang (die vervangt een bestand ook); bij een vak niet, zodat
 * Ongedaan dan een keuze van daarna laat staan.
 */
export type ZoneSnapshot = {
  zones: Zone[];
  pages: Record<number, Zone[]>;
  joins?: Record<number, Join>;
};

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
  /** De gegevens voor de documentkop: uit de PDF, aan te passen; ze horen bij de PDF. */
  meta: Meta;
  /** Eerdere vakken, voor Ongedaan (de laatste het eerst). */
  undo: ZoneSnapshot[];
  /** Opties uit een bestand die deze tool niet kent; ze gaan mee bij opslaan. */
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
  /**
   * De tekst zoals je hem in het resultaat hebt aangepast, of null (niet aangepast). Kopiëren en
   * downloaden nemen die mee; opnieuw extraheren zet hem terug, zoals in de extractor.
   */
  edited: string | null;
  /**
   * De aangepaste tekst zoals die het laatst is gedownload of gekopieerd. Wijkt `edited` daarvan
   * af, dan waarschuwt het sluiten van het tabblad (zie `lib/unsavedWarning.ts`).
   */
  keptText: string | null;
  /** Sinds het extraheren zijn de instellingen of de vakken veranderd. */
  stale: boolean;
  /** Welke blokken links open staan; blijft staan bij Wissen. */
  blocks: Record<TextBlock, boolean>;
  /** Batch in één bestand (of als zip). Wordt niet onthouden, zoals in de extractor. */
  batchCombine: boolean;
  /** De PDF's voor de batch, in de volgorde waarin ze verwerkt worden. Niet onthouden. */
  batchFiles: BatchFile[];
  batch: BatchStatus;
};

/** Een PDF in de lijst van de batch; `id` blijft hetzelfde als de volgorde verandert. */
export type BatchFile = { id: number; file: File };

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
  meta: EMPTY_META,
  undo: [],
  extra: NO_EXTRA,
  restored: false,
  view: 'preview',
  page: 1,
  fit: 'page',
  zoom: 100,
  result: null,
  edited: null,
  keptText: null,
  stale: false,
  // Zoals in de extractor: de documentkop en metadata dicht, de rest open (bewaren is nieuw).
  blocks: { zones: true, clean: true, meta: false, pages: true, batch: false, save: false },
  batchCombine: false,
  batchFiles: [],
  batch: { status: 'idle' },
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

/**
 * Is er een aangepaste tekst die nog niet gedownload of gekopieerd is? Die is weg bij een andere
 * PDF, Wissen, opnieuw extraheren of het sluiten van het tabblad; daarom eerst een vraag.
 */
export const textAtRisk = ({ edited, result, keptText }: TextState = state): boolean =>
  edited !== null && result !== null && edited !== result.text && edited !== keptText;

function setState(change: Partial<TextState>) {
  state = { ...state, ...change };
  setUnsavedWork('text', textAtRisk(state));
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
  meta: s.meta,
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
    meta: EMPTY_META,
    undo: [],
    extra: NO_EXTRA,
    restored: false,
    view: 'preview',
    page: 1,
    fit: 'page',
    zoom: 100,
    result: null,
    edited: null,
    stale: false,
    ...extra,
  });
}

/** Het nummer van de laatste keer lezen, zodat een PDF die nog gelezen wordt een later gekozen PDF niet overschrijft. */
let lastRead = 0;

async function load(file: File) {
  const token = ++lastRead;
  const current = () => lastRead === token;
  const put = (slot: TextSlot, extra?: Partial<TextState>) => {
    if (!current()) return;
    release(state.slot);
    setSlot(slot, extra);
  };
  /**
   * Hoe het lezen gaat, of dat het mislukte. Staat er al een PDF, dan blijft die staan, met de
   * vakken en de tekst, en komt dit eronder; anders staat het in het vak zelf.
   */
  const pending = (incoming: Incoming) => {
    if (!current()) return;
    if (state.slot.status === 'ready') setState({ slot: { ...state.slot, incoming } });
    else put(incoming);
  };
  pending({ status: 'reading', name: file.name, done: 0, total: 0 });
  try {
    const { pageCount, pages, info, thumb } = await readPdf(file, (done, total) =>
      pending({ status: 'reading', name: file.name, done, total }),
    );
    const url = thumb
      ? URL.createObjectURL(new Blob([thumb as BlobPart], { type: 'image/png' }))
      : null;
    if (!current()) {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    // De gegevens uit de PDF in de velden; eerder onthouden instellingen voor deze PDF (met de
    // velden zoals ze toen waren) gaan voor, zoals in de extractor. Een onthouden datum in de vorm
    // van eerder ("4 juni 2018") wordt ISO. De onbekende opties van de vorige PDF gaan niet mee
    // (vakken en overgangen vervangt `fromSettings` altijd); de instellingen van nu wel.
    const meta = metaFromInfo(info);
    const stored = fromSettings(loadStored(file.name), {
      ...settingsOf(state),
      extra: NO_EXTRA,
      meta,
    });
    if (stored)
      stored.meta = { ...stored.meta, date: upgradeDate(stored.meta.date, info.CreationDate) };
    put(
      {
        status: 'ready',
        doc: { file, pageCount, pages, thumb: url, printed: printedPages(pages), info },
      },
      { meta, ...(stored ? { ...stored, restored: true } : {}) },
    );
  } catch (error) {
    pending({
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

/** Een veld van de documentkop aanpassen (titel, auteur, onderwerp of datum). */
export function setMeta(next: Partial<Meta>): void {
  change({ meta: { ...state.meta, ...next } });
}

/**
 * De instellingen terug naar de standaard, zoals Reset in de extractor (zonder "Instellingen
 * behouden"): alle vinkjes en de alinea-gevoeligheid, en pagina's zonder vakken overslaan. De
 * vakken, de velden van de documentkop en de batch blijven staan; voor deze PDF wordt het onthouden.
 */
export function resetOptions(): void {
  change({ options: DEFAULT_TEXT_OPTIONS, readEmpty: false });
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

/**
 * Instellingen uit een bestand toepassen (en onthouden); de vakken en keuzes per overgang van
 * daarvoor kunnen terug met Ongedaan. Geeft false (en verandert niets) als het geen instellingen zijn.
 */
export function importSettings(raw: unknown): boolean {
  if (!isSettingsFile(raw)) return false;
  const next = fromSettings(raw, settingsOf(state));
  if (!next) return false;
  // Ook in een bestand van de extractor ("4 juni 2018"): de datum van de PDF wordt ISO.
  if (state.slot.status === 'ready')
    next.meta = {
      ...next.meta,
      date: upgradeDate(next.meta.date, state.slot.doc.info.CreationDate),
    };
  change({
    ...next,
    undo: [...state.undo, { zones: state.zones, pages: state.pages, joins: state.joins }].slice(
      -UNDO_LIMIT,
    ),
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

/** De woorden in de tekst, in de taal van de app: de paginaconcordantie, de kop en de conventies. */
export type OutputTexts = { concordance: ConcordanceTexts; head: HeadTexts };

/**
 * De tekst maken met de instellingen, vakken en gegevens van nu, en de tekst tonen. Zonder `texts`
 * in het Nederlands, zoals in de extractor.
 */
export function extract(texts?: OutputTexts): void {
  if (state.slot.status !== 'ready') return;
  const setup = state.useZones
    ? { zones: state.zones, pages: state.pages, readEmpty: state.readEmpty }
    : null;
  setState({
    result: extractText(state.slot.doc.pages, state.options, setup, {
      printed: state.slot.doc.printed,
      joins: state.joins,
      name: state.slot.doc.file.name,
      meta: state.meta,
      ...(texts ? { texts: texts.concordance, head: texts.head } : {}),
    }),
    edited: null,
    view: 'result',
    stale: false,
  });
}

/** De (aangepaste) tekst is gedownload of gekopieerd: daarmee is hij bewaard. */
export function markTextKept(text: string): void {
  setState({ keptText: text });
}

/** De tekst in het resultaat aanpassen (alleen in het scherm; niet onthouden). */
export function setEdited(edited: string): void {
  setState({ edited });
}

/** De woorden van een batch, in de taal van de app: die van de tekst, en die om elk document. */
export type BatchTexts = OutputTexts & { batch: BatchWords };

/** Batch in één bestand of als zip. Hoort niet bij een PDF en wordt niet onthouden. */
export function setBatchCombine(batchCombine: boolean): void {
  setState({ batchCombine });
}

/** Het volgende nummer voor een PDF in de lijst van de batch. */
let nextBatchId = 1;

/**
 * De lijst van de batch veranderen. De melding van de vorige batch hoort dan niet meer bij de
 * lijst en verdwijnt; tijdens het verwerken blijft de voortgang staan.
 */
function changeBatchFiles(batchFiles: BatchFile[]) {
  setState({
    batchFiles,
    ...(state.batch.status === 'running' ? {} : { batch: { status: 'idle' as const } }),
  });
}

/** PDF's onderaan de lijst van de batch zetten (ook dezelfde PDF nog eens). */
export function addBatchFiles(files: readonly File[]): void {
  if (files.length === 0) return;
  changeBatchFiles([...state.batchFiles, ...files.map((file) => ({ id: nextBatchId++, file }))]);
}

/** Een PDF uit de lijst halen. Niet tijdens het verwerken. */
export function removeBatchFile(id: number): void {
  if (state.batch.status === 'running') return;
  changeBatchFiles(state.batchFiles.filter((entry) => entry.id !== id));
}

/** Een PDF een plek omhoog (-1) of omlaag (1). Niet tijdens het verwerken. */
export function moveBatchFile(id: number, step: -1 | 1): void {
  const from = state.batchFiles.findIndex((entry) => entry.id === id);
  moveBatchFileTo(id, step < 0 ? from - 1 : from + 2);
}

/**
 * Een PDF naar een andere plek, zoals bij slepen: `target` is de plek vóór het onderdeel met dat
 * nummer (0 = bovenaan, het aantal = onderaan). Niet tijdens het verwerken.
 */
export function moveBatchFileTo(id: number, target: number): void {
  if (state.batch.status === 'running') return;
  const list = [...state.batchFiles];
  const from = list.findIndex((entry) => entry.id === id);
  if (from < 0) return;
  const to = Math.max(0, Math.min(list.length - 1, target > from ? target - 1 : target));
  if (to === from) return;
  const [entry] = list.splice(from, 1);
  list.splice(to, 0, entry!);
  changeBatchFiles(list);
}

/** De lijst leegmaken. Niet tijdens het verwerken. */
export function clearBatchFiles(): void {
  if (state.batch.status === 'running' || state.batchFiles.length === 0) return;
  changeBatchFiles([]);
}

const encode = (text: string) => new TextEncoder().encode(text);

/**
 * De PDF's van de lijst achter elkaar, in de volgorde van de lijst, met de instellingen van nu en
 * zonder leesvakken, zoals in de extractor. Eén PDF tegelijk wordt gelezen en meteen verwerkt.
 * Daarna één download: een zip met per PDF een .txt, of één .txt met alles. Is er niets bruikbaars
 * (geen tekst, of niets gelezen), dan geen download, alleen de melding. De open PDF, de vakken en
 * het resultaat blijven ongemoeid, en de lijst blijft staan.
 */
export async function runBatch(texts?: BatchTexts): Promise<void> {
  const files = state.batchFiles.map((entry) => entry.file);
  if (state.batch.status === 'running' || files.length === 0) return;
  const opts = state.options;
  const combine = state.batchCombine;
  const ctx: BatchContext = texts
    ? { concordance: texts.concordance, head: texts.head, words: texts.batch }
    : DUTCH_CONTEXT;
  const names = zipNames(files.map((file) => file.name));
  const label = (i: number) => (combine ? files[i]!.name : names[i]!.label);
  const failed: BatchFailure[] = [];
  const noText: string[] = [];
  const parts: string[] = [];
  let ok = 0;
  let usable = false;
  let zip: ZipWriter | null = null;
  let download: string | null = null;
  let problem: BatchProblem | null = null;
  const progress = (i: number, page: number, pages: number) =>
    setState({
      batch: {
        status: 'running',
        i: i + 1,
        total: files.length,
        name: files[i]!.name,
        page,
        pages,
      },
    });
  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      progress(i, 0, 0);
      let doc;
      try {
        const read = await readPdf(file, (done, total) => progress(i, done, total), {
          thumb: false,
        });
        doc = { name: file.name, pages: read.pages, info: read.info };
      } catch (error) {
        failed.push({
          label: label(i),
          code: error instanceof PdfLoadError ? error.code : 'damaged',
        });
        continue;
      }
      ok++;
      if (hasText(doc)) usable = true;
      else noText.push(label(i));
      if (combine) parts.push(combinedPart(i + 1, doc, opts, ctx));
      else {
        zip ??= await zipWriter();
        zip.add(names[i]!.file, encode(docText(doc, opts, ctx)));
      }
    }
    if (!usable) problem = ok === 0 ? 'nothingRead' : 'nothing';
    else if (combine) {
      download = 'batch_extract.txt';
      const text = combineParts(combinedHead(opts, ctx), parts);
      downloadFile(encode(text), download, 'text/plain;charset=utf-8');
    } else {
      download = 'batch_extract.zip';
      downloadFile(zip!.finish(), download, 'application/zip');
    }
  } catch (error) {
    download = null;
    problem = error instanceof ZipTooLargeError ? 'tooLarge' : 'downloadFailed';
  }
  setState({ batch: { status: 'done', combine, ok, failed, noText, download, problem } });
}

/** Alleen voor tests: begin opnieuw. */
export function resetTextState(): void {
  clearText();
  state = INITIAL;
}
