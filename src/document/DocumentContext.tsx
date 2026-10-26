import { createContext, type ComponentChildren } from 'preact';
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Annotation } from '../annotations/model';
import { DEFAULT_REDACTION, type RedactionOptions } from '../pdf/redactOptions';
import {
  docOrder,
  initialPages,
  moveDoc,
  moveDocTo,
  record,
  redo as redoHistory,
  removeDoc,
  samePlan,
  setDocPages,
  startHistory,
  undo as undoHistory,
  type History,
  type PageItem,
} from '../pages/plan';
import { looksLikePdf, type LoadErrorCode } from '../pdf/detect';
import { PdfLoadError, closePdf, loadPdf, type LoadedPdf } from '../pdf/loader';

/** Een geopend bestand. Het blijft geladen tot je alles sluit (ook voor ongedaan maken). */
export type Source = {
  /** Uniek per geopend bestand, ook als twee bestanden dezelfde naam hebben. */
  id: number;
  name: string;
  size: number;
  /** Het bestand zelf: een `File` wijst naar de gegevens op je apparaat, dus geen extra geheugen. */
  file: File;
  pdf: PDFDocumentProxy;
  pageCount: number;
};

/** Een bestand dat niet geopend kon worden. */
export type FileError = { name: string; code: LoadErrorCode };

/**
 * Wat er open staat. Het blijft open als je van taak wisselt.
 * (Bewust niet `document` genoemd: die naam is van de browser.)
 */
export type DocState =
  | { status: 'empty' }
  | { status: 'loading'; name: string }
  | { status: 'ready'; sources: Source[] }
  | { status: 'error'; name: string; code: LoadErrorCode };

/**
 * Bladwijzers bij het opslaan: nieuwe per bestand (aan of uit, met eigen titels) en of de
 * bestaande bladwijzers meegaan als de pagina's in een nieuw document komen (meer bestanden).
 */
export type Bookmarks = { on: boolean; keep: boolean; titles: ReadonlyMap<number, string> };

const NO_BOOKMARKS: Bookmarks = { on: false, keep: true, titles: new Map() };

/** Hoe het blok met de bladwijzers van de geopende bestanden erbij staat: open, en welke delen uitgeklapt. */
export type OutlineView = { open: boolean; expanded: ReadonlySet<string> };

const CLOSED_OUTLINE: OutlineView = { open: false, expanded: new Set() };

type DocApi = {
  doc: DocState;
  /** Opent één of meer bestanden; wat er open stond, wordt gesloten. */
  open: (files: File | File[]) => Promise<void>;
  /** Voegt bestanden toe aan wat er open staat (achteraan in het pagina-plan). */
  add: (files: File[]) => Promise<void>;
  /** Bezig met toevoegen? */
  adding: boolean;
  /** Bestanden die bij het laatste openen of toevoegen niet lukten. */
  fileErrors: FileError[];
  close: () => void;
  /** Het pagina-plan (leeg als er niets open is). */
  pages: PageItem[];
  /** De bestanden met minstens één pagina in het plan, in de volgorde van hun eerste pagina. */
  activeSources: Source[];
  /** Een bestand opzoeken bij een pagina. */
  sourceOf: (page: PageItem) => Source | undefined;
  /** Alle pagina's van een bestand uit het plan halen (niet het laatste bestand). */
  removeSource: (id: number) => void;
  /** Een bestand als blok een plek omhoog (-1) of omlaag (1). */
  moveSource: (id: number, step: -1 | 1) => void;
  /** Een bestand als blok naar plek `target` in de bestandenlijst (slepen). */
  moveSourceTo: (id: number, target: number) => void;
  /** Welke pagina's van een bestand meedoen (paginanummers in het bestand, vanaf 0). */
  setSourcePages: (id: number, sources: ReadonlySet<number>) => void;
  /** Een bewerking vastleggen; kan ongedaan worden gemaakt. */
  edit: (next: PageItem[]) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Annotaties (tekst, markeringen, vormen) op de pagina's; ze horen bij `PageItem.key`. */
  annotations: Annotation[];
  /**
   * Een annotatie-bewerking vastleggen; kan ongedaan worden gemaakt. Met een `mergeKey` smelten
   * snelle opeenvolgende bewerkingen met dezelfde sleutel (bijvoorbeeld pijltjestoetsen) samen
   * tot één stap.
   */
  annotate: (change: (items: Annotation[]) => Annotation[], mergeKey?: string) => void;
  /** Een nieuw nummer voor een annotatie. */
  newAnnotationId: () => number;
  /** Hoe redactie wordt uitgevoerd (resolutie, documentgegevens), bij elke download met redactievakken. */
  redaction: RedactionOptions;
  setRedaction: (change: Partial<RedactionOptions>) => void;
  /** Gewijzigd sinds het openen of de laatste download. */
  unsaved: boolean;
  /**
   * Nieuwe bladwijzers bij samenvoegen: aan of uit (standaard uit), en eigen titels per
   * bestand. Zonder eigen titel geldt de bestandsnaam. Hoort niet bij ongedaan maken.
   */
  bookmarks: Bookmarks;
  setBookmarksOn: (on: boolean) => void;
  /** Bestaande bladwijzers meenemen (standaard aan). */
  setBookmarksKeep: (keep: boolean) => void;
  setBookmarkTitle: (id: number, title: string) => void;
  /**
   * Het blok met de bestaande bladwijzers (bij Pagina's, Bewerken en Redigeren): open of dicht,
   * en welke delen uitgeklapt. Blijft zo bij het wisselen van taak; begint dicht bij nieuwe bestanden.
   */
  outlineView: OutlineView;
  setOutlineView: (change: Partial<OutlineView>) => void;
  /** Na een geslaagde download: de huidige stand geldt als bewaard. */
  markSaved: () => void;
};

const DocContext = createContext<DocApi | null>(null);

/** Wat een stap in de ongedaan-maken-reeks vasthoudt: de pagina's en de annotaties. */
type Snapshot = { pages: PageItem[]; annotations: Annotation[] };
const EMPTY: Snapshot = { pages: [], annotations: [] };

/** Een nieuwe stap met andere pagina's; dezelfde lijst teruggeven verandert niets. */
function withPages(history: History<Snapshot>, pages: PageItem[]): History<Snapshot> {
  if (pages === history.present.pages) return history;
  return record(history, { ...history.present, pages });
}

export function DocumentProvider({
  children,
  load = loadPdf,
  unload = closePdf,
}: {
  children: ComponentChildren;
  /** Alleen voor tests: vervang de echte PDF-lezer. */
  load?: (bytes: Uint8Array) => Promise<LoadedPdf>;
  /** Alleen voor tests: vervang het sluiten. */
  unload?: (pdf: PDFDocumentProxy) => void;
}) {
  const [doc, setDoc] = useState<DocState>({ status: 'empty' });
  const [fileErrors, setFileErrors] = useState<FileError[]>([]);
  const [adding, setAdding] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmarks>(NO_BOOKMARKS);
  const [outlineView, setOutlineViewState] = useState<OutlineView>(CLOSED_OUTLINE);
  const [redaction, setRedactionState] = useState<RedactionOptions>(DEFAULT_REDACTION);
  // De bewerkingen (pagina's en annotaties) horen bij wat er open staat en blijven bewaard als
  // je van taak wisselt. Alles samen één ongedaan-maken-reeks: je laatste stap, waar je die ook deed.
  const [history, setHistory] = useState<History<Snapshot>>(() => startHistory(EMPTY));
  // De stand die het laatst is gedownload (of het begin), om "niet opgeslagen" te kunnen tonen.
  const [saved, setSaved] = useState<Snapshot | null>(null);
  const nextAnnotation = useRef(1);
  const lastMerge = useRef<{ key: string; time: number; present: Snapshot } | null>(null);
  // Elk openverzoek krijgt een nummer; een trager, ouder verzoek mag een nieuwer niet overschrijven.
  const latest = useRef(0);
  const loaded = useRef<PDFDocumentProxy[]>([]);
  // Doorlopende nummers voor bestanden en paginasleutels.
  const nextSource = useRef(1);
  const nextKey = useRef(0);

  const release = useCallback(() => {
    for (const pdf of loaded.current) unload(pdf);
    loaded.current = [];
  }, [unload]);

  /**
   * Opent bestanden tegelijk (sneller dan na elkaar) en geeft, in de volgorde van de
   * bestanden, wat lukte en wat niet.
   */
  const loadFiles = useCallback(
    async (files: File[]) => {
      const openFile = async (file: File) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!looksLikePdf(bytes)) throw new PdfLoadError('not-pdf');
        return load(bytes);
      };
      // Een eenmalige storing (bijvoorbeeld pdf.js dat onder zware belasting niet op tijd
      // opstart) mag een goed bestand niet als beschadigd laten melden: dan nog één keer
      // proberen, met verse bytes (pdf.js neemt de vorige over). Geen PDF of een wachtwoord
      // verandert niet bij opnieuw proberen.
      const openWithRetry = async (file: File) => {
        try {
          return await openFile(file);
        } catch (error) {
          if (error instanceof PdfLoadError && error.code !== 'damaged') throw error;
          return openFile(file);
        }
      };
      const results = await Promise.allSettled(
        files.map(async (file) => ({ file, result: await openWithRetry(file) })),
      );
      const sources: Source[] = [];
      const errors: FileError[] = [];
      results.forEach((outcome, i) => {
        const file = files[i]!;
        if (outcome.status === 'fulfilled') {
          sources.push({
            id: nextSource.current++,
            name: file.name,
            size: file.size,
            file,
            pdf: outcome.value.result.pdf,
            pageCount: outcome.value.result.pageCount,
          });
        } else {
          const error = outcome.reason as unknown;
          errors.push({
            name: file.name,
            code: error instanceof PdfLoadError ? error.code : 'damaged',
          });
        }
      });
      return { sources, errors };
    },
    [load],
  );

  /** De pagina's van nieuwe bestanden, met sleutels die doortellen. */
  const pagesOf = (sources: Source[]) =>
    sources.flatMap((source) => {
      const pages = initialPages(source.pageCount, source.id, nextKey.current);
      nextKey.current += source.pageCount;
      return pages;
    });

  const open = useCallback(
    async (input: File | File[]) => {
      const files = Array.isArray(input) ? input : [input];
      if (files.length === 0) return;
      const request = ++latest.current;
      setDoc({ status: 'loading', name: files[0]!.name });
      setFileErrors([]);

      const { sources, errors } = await loadFiles(files);
      if (request !== latest.current) {
        for (const source of sources) unload(source.pdf);
        return;
      }
      release();
      if (sources.length === 0) {
        const first = errors[0]!;
        setHistory(startHistory(EMPTY));
        setSaved(null);
        setDoc({ status: 'error', name: first.name, code: first.code });
        setFileErrors(errors.slice(1));
        return;
      }
      loaded.current = sources.map((source) => source.pdf);
      const start: Snapshot = { pages: pagesOf(sources), annotations: [] };
      lastMerge.current = null;
      setHistory(startHistory(start));
      setSaved(start);
      setBookmarks(NO_BOOKMARKS);
      setOutlineViewState(CLOSED_OUTLINE);
      setDoc({ status: 'ready', sources });
      setFileErrors(errors);
    },
    // pagesOf gebruikt alleen refs.
    [loadFiles, release, unload],
  );

  const add = useCallback(
    async (files: File[]) => {
      if (doc.status !== 'ready' || files.length === 0) return;
      const request = latest.current;
      setAdding(true);
      setFileErrors([]);
      const { sources, errors } = await loadFiles(files);
      setAdding(false);
      if (request !== latest.current) {
        for (const source of sources) unload(source.pdf);
        return;
      }
      setFileErrors(errors);
      if (sources.length === 0) return;
      loaded.current.push(...sources.map((source) => source.pdf));
      const extra = pagesOf(sources);
      setDoc((current) =>
        current.status === 'ready'
          ? { status: 'ready', sources: [...current.sources, ...sources] }
          : current,
      );
      setHistory((h) => withPages(h, [...h.present.pages, ...extra]));
    },
    [doc.status, loadFiles, unload],
  );

  const close = useCallback(() => {
    latest.current += 1;
    release();
    setHistory(startHistory(EMPTY));
    setSaved(null);
    lastMerge.current = null;
    setFileErrors([]);
    setBookmarks(NO_BOOKMARKS);
    setOutlineViewState(CLOSED_OUTLINE);
    setDoc({ status: 'empty' });
  }, [release]);

  const setRedaction = useCallback(
    (change: Partial<RedactionOptions>) =>
      setRedactionState((current) => ({ ...current, ...change })),
    [],
  );
  const setBookmarksOn = useCallback(
    (on: boolean) => setBookmarks((current) => ({ ...current, on })),
    [],
  );
  const setOutlineView = useCallback(
    (change: Partial<OutlineView>) => setOutlineViewState((current) => ({ ...current, ...change })),
    [],
  );
  const setBookmarksKeep = useCallback(
    (keep: boolean) => setBookmarks((current) => ({ ...current, keep })),
    [],
  );
  const setBookmarkTitle = useCallback(
    (id: number, title: string) =>
      setBookmarks((current) => ({ ...current, titles: new Map(current.titles).set(id, title) })),
    [],
  );

  const annotate = useCallback(
    (change: (items: Annotation[]) => Annotation[], mergeKey?: string) =>
      setHistory((h) => {
        const next = change(h.present.annotations);
        if (next === h.present.annotations) return h;
        const now = Date.now();
        const last = lastMerge.current;
        const snapshot = { ...h.present, annotations: next };
        // Snelle opeenvolgende wijzigingen met dezelfde sleutel smelten samen, zolang er
        // ondertussen niets anders is gebeurd: de vorige stap blijft het terugkeerpunt.
        const merge =
          mergeKey !== undefined &&
          last?.key === mergeKey &&
          last.present === h.present &&
          now - last.time < 800 &&
          h.past.length > 0;
        lastMerge.current =
          mergeKey === undefined ? null : { key: mergeKey, time: now, present: snapshot };
        if (merge) return { past: h.past, present: snapshot, future: [] };
        return record(h, snapshot);
      }),
    [],
  );
  const newAnnotationId = useCallback(() => nextAnnotation.current++, []);

  const edit = useCallback((next: PageItem[]) => setHistory((h) => withPages(h, next)), []);
  const undo = useCallback(() => setHistory(undoHistory), []);
  const redo = useCallback(() => setHistory(redoHistory), []);
  const removeSource = useCallback(
    (id: number) => setHistory((h) => withPages(h, removeDoc(h.present.pages, id))),
    [],
  );
  const moveSource = useCallback(
    (id: number, step: -1 | 1) =>
      setHistory((h) => withPages(h, moveDoc(h.present.pages, id, step))),
    [],
  );
  const setSourcePages = useCallback(
    (id: number, sources: ReadonlySet<number>) =>
      setHistory((h) =>
        withPages(
          h,
          setDocPages(h.present.pages, id, sources, () => nextKey.current++),
        ),
      ),
    [],
  );
  const moveSourceTo = useCallback(
    (id: number, target: number) =>
      setHistory((h) => withPages(h, moveDocTo(h.present.pages, id, target))),
    [],
  );

  const markSaved = useCallback(() => setSaved(history.present), [history.present]);
  const unsaved =
    doc.status === 'ready' &&
    saved !== null &&
    (!samePlan(history.present.pages, saved.pages) ||
      history.present.annotations !== saved.annotations);

  // Wie de pagina sluit met niet-gedownloade wijzigingen, krijgt een waarschuwing van de browser.
  // Bewust direct bij het tekenen (layout-effect): zo staat de waarschuwing aan op het
  // moment dat "Gewijzigd" in beeld komt, ook als iemand meteen daarna het tabblad sluit.
  useLayoutEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Voor oudere browsers, die alleen naar returnValue kijken.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);

  // Ruim alles op als de app verdwijnt.
  useEffect(() => release, [release]);

  const value = useMemo(() => {
    const sources = doc.status === 'ready' ? doc.sources : [];
    const byId = new Map(sources.map((source) => [source.id, source]));
    const activeSources = docOrder(history.present.pages)
      .map((id) => byId.get(id))
      .filter((source): source is Source => source !== undefined);
    return {
      doc,
      open,
      add,
      adding,
      fileErrors,
      close,
      pages: history.present.pages,
      activeSources,
      sourceOf: (page: PageItem) => byId.get(page.doc),
      removeSource,
      moveSource,
      moveSourceTo,
      setSourcePages,
      edit,
      undo,
      redo,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      annotations: history.present.annotations,
      annotate,
      newAnnotationId,
      redaction,
      setRedaction,
      unsaved,
      markSaved,
      bookmarks,
      setBookmarksOn,
      setBookmarksKeep,
      setBookmarkTitle,
      outlineView,
      setOutlineView,
    };
  }, [
    doc,
    open,
    add,
    adding,
    fileErrors,
    close,
    history,
    annotate,
    newAnnotationId,
    removeSource,
    moveSource,
    moveSourceTo,
    setSourcePages,
    edit,
    undo,
    redo,
    redaction,
    setRedaction,
    unsaved,
    markSaved,
    bookmarks,
    setBookmarksOn,
    setBookmarksKeep,
    setBookmarkTitle,
    outlineView,
    setOutlineView,
  ]);
  return <DocContext.Provider value={value}>{children}</DocContext.Provider>;
}

export function useDocument(): DocApi {
  const value = useContext(DocContext);
  if (!value) throw new Error('useDocument moet binnen een DocumentProvider worden gebruikt');
  return value;
}
