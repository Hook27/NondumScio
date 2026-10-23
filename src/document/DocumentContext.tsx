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
import { looksLikePdf, type LoadErrorCode } from '../pdf/detect';
import {
  initialPages,
  isChanged,
  record,
  samePlan,
  redo as redoHistory,
  startHistory,
  undo as undoHistory,
  type History,
  type PageItem,
} from '../pages/plan';
import { PdfLoadError, closePdf, loadPdf, type LoadedPdf } from '../pdf/loader';

/**
 * Het document dat open staat. Het blijft open als je van taak wisselt.
 * (Bewust niet `document` genoemd: die naam is van de browser.)
 */
export type DocState =
  | { status: 'empty' }
  | { status: 'loading'; name: string }
  | {
      status: 'ready';
      /** Uniek per geopend document, ook als twee bestanden dezelfde naam hebben. */
      id: number;
      name: string;
      size: number;
      /**
       * Het bestand zelf, voor latere bewerkingen. Een `File` wijst naar de gegevens op je
       * apparaat; zo staat de PDF niet nog een keer in het geheugen naast de kopie van pdf.js.
       */
      file: File;
      pdf: PDFDocumentProxy;
      pageCount: number;
    }
  | { status: 'error'; name: string; code: LoadErrorCode };

type DocApi = {
  doc: DocState;
  open: (file: File) => Promise<void>;
  close: () => void;
  /** Het pagina-plan van het geopende document (leeg als er niets open is). */
  pages: PageItem[];
  /** Of het plan afwijkt van het origineel. */
  changed: boolean;
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
  // De bewerkingen horen bij het document en blijven bewaard als je van taak wisselt.
  const [history, setHistory] = useState<History>(() => startHistory([]));
  // Het plan dat het laatst is gedownload (of het begin), om "niet opgeslagen" te kunnen tonen.
  const [savedPages, setSavedPages] = useState<PageItem[] | null>(null);
  // Elk openverzoek krijgt een nummer; een trager, ouder verzoek mag een nieuwer niet overschrijven.
  const latest = useRef(0);
  const current = useRef<PDFDocumentProxy | null>(null);

  const release = useCallback(() => {
    if (current.current) unload(current.current);
    current.current = null;
  }, [unload]);

  const open = useCallback(
    async (file: File) => {
      const request = ++latest.current;
      setDoc({ status: 'loading', name: file.name });

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!looksLikePdf(bytes)) throw new PdfLoadError('not-pdf');
        const loaded = await load(bytes);
        if (request !== latest.current) {
          unload(loaded.pdf);
          return;
        }
        release();
        current.current = loaded.pdf;
        const start = initialPages(loaded.pageCount);
        setHistory(startHistory(start));
        setSavedPages(start);
        setDoc({
          status: 'ready',
          id: request,
          name: file.name,
          size: file.size,
          file,
          pdf: loaded.pdf,
          pageCount: loaded.pageCount,
        });
      } catch (error) {
        if (request !== latest.current) return;
        release();
        const code = error instanceof PdfLoadError ? error.code : 'damaged';
        setHistory(startHistory([]));
        setDoc({ status: 'error', name: file.name, code });
      }
    },
    [load, unload, release],
  );

  const close = useCallback(() => {
    latest.current += 1;
    release();
    setHistory(startHistory([]));
    setDoc({ status: 'empty' });
  }, [release]);

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

  const edit = useCallback((next: PageItem[]) => setHistory((h) => record(h, next)), []);
  const undo = useCallback(() => setHistory(undoHistory), []);
  const redo = useCallback(() => setHistory(redoHistory), []);

  // Ruim het document op als de app verdwijnt.
  useEffect(() => release, [release]);

  const value = useMemo(
    () => ({
      doc,
      open,
      close,
      pages: history.present,
      changed: doc.status === 'ready' && isChanged(history.present, doc.pageCount),
      edit,
      undo,
      redo,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      unsaved,
      markSaved,
    }),
    [doc, open, close, history, edit, undo, redo, unsaved, markSaved],
  );
  return <DocContext.Provider value={value}>{children}</DocContext.Provider>;
}

export function useDocument(): DocApi {
  const value = useContext(DocContext);
  if (!value) throw new Error('useDocument moet binnen een DocumentProvider worden gebruikt');
  return value;
}
