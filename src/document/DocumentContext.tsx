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
  /** Gewijzigd sinds het openen of de laatste download. */
  unsaved: boolean;
  /** Na een geslaagde download: de huidige stand geldt als bewaard. */
  markSaved: () => void;
};

const DocContext = createContext<DocApi | null>(null);

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
  // De bewerkingen horen bij wat er open staat en blijven bewaard als je van taak wisselt.
  const [history, setHistory] = useState<History>(() => startHistory([]));
  // Het plan dat het laatst is gedownload (of het begin), om "niet opgeslagen" te kunnen tonen.
  const [savedPages, setSavedPages] = useState<PageItem[] | null>(null);
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
      const results = await Promise.allSettled(
        files.map(async (file) => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (!looksLikePdf(bytes)) throw new PdfLoadError('not-pdf');
          return { file, result: await load(bytes) };
        }),
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
        setHistory(startHistory([]));
        setSavedPages(null);
        setDoc({ status: 'error', name: first.name, code: first.code });
        setFileErrors(errors.slice(1));
        return;
      }
      loaded.current = sources.map((source) => source.pdf);
      const start = pagesOf(sources);
      setHistory(startHistory(start));
      setSavedPages(start);
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
      setHistory((h) => record(h, [...h.present, ...extra]));
    },
    [doc.status, loadFiles, unload],
  );

  const close = useCallback(() => {
    latest.current += 1;
    release();
    setHistory(startHistory([]));
    setSavedPages(null);
    setFileErrors([]);
    setDoc({ status: 'empty' });
  }, [release]);

  const edit = useCallback((next: PageItem[]) => setHistory((h) => record(h, next)), []);
  const undo = useCallback(() => setHistory(undoHistory), []);
  const redo = useCallback(() => setHistory(redoHistory), []);
  const removeSource = useCallback(
    (id: number) => setHistory((h) => record(h, removeDoc(h.present, id))),
    [],
  );
  const moveSource = useCallback(
    (id: number, step: -1 | 1) => setHistory((h) => record(h, moveDoc(h.present, id, step))),
    [],
  );
  const setSourcePages = useCallback(
    (id: number, sources: ReadonlySet<number>) =>
      setHistory((h) =>
        record(
          h,
          setDocPages(h.present, id, sources, () => nextKey.current++),
        ),
      ),
    [],
  );
  const moveSourceTo = useCallback(
    (id: number, target: number) => setHistory((h) => record(h, moveDocTo(h.present, id, target))),
    [],
  );

  const markSaved = useCallback(() => setSavedPages(history.present), [history.present]);
  const unsaved =
    doc.status === 'ready' && savedPages !== null && !samePlan(history.present, savedPages);

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
    const activeSources = docOrder(history.present)
      .map((id) => byId.get(id))
      .filter((source): source is Source => source !== undefined);
    return {
      doc,
      open,
      add,
      adding,
      fileErrors,
      close,
      pages: history.present,
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
      unsaved,
      markSaved,
    };
  }, [
    doc,
    open,
    add,
    adding,
    fileErrors,
    close,
    history,
    removeSource,
    moveSource,
    moveSourceTo,
    setSourcePages,
    edit,
    undo,
    redo,
    unsaved,
    markSaved,
  ]);
  return <DocContext.Provider value={value}>{children}</DocContext.Provider>;
}

export function useDocument(): DocApi {
  const value = useContext(DocContext);
  if (!value) throw new Error('useDocument moet binnen een DocumentProvider worden gebruikt');
  return value;
}
