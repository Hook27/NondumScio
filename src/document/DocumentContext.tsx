import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { looksLikePdf, type LoadErrorCode } from '../pdf/detect';
import { PdfLoadError, closePdf, loadPdf, type LoadedPdf } from '../pdf/loader';

/** Het document dat open staat. Het blijft open als je van taak wisselt. */
export type DocumentState =
  | { status: 'empty' }
  | { status: 'loading'; name: string }
  | {
      status: 'ready';
      name: string;
      size: number;
      /** De originele bytes, voor latere bewerkingen. */
      bytes: Uint8Array;
      pdf: PDFDocumentProxy;
      pageCount: number;
    }
  | { status: 'error'; name: string; code: LoadErrorCode };

type DocumentApi = {
  document: DocumentState;
  open: (file: File) => Promise<void>;
  close: () => void;
};

const DocumentContext = createContext<DocumentApi | null>(null);

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
  const [document, setDocument] = useState<DocumentState>({ status: 'empty' });
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
      setDocument({ status: 'loading', name: file.name });

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
        setDocument({
          status: 'ready',
          name: file.name,
          size: file.size,
          bytes,
          pdf: loaded.pdf,
          pageCount: loaded.pageCount,
        });
      } catch (error) {
        if (request !== latest.current) return;
        release();
        const code = error instanceof PdfLoadError ? error.code : 'damaged';
        setDocument({ status: 'error', name: file.name, code });
      }
    },
    [load, unload, release],
  );

  const close = useCallback(() => {
    latest.current += 1;
    release();
    setDocument({ status: 'empty' });
  }, [release]);

  // Ruim het document op als de app verdwijnt.
  useEffect(() => release, [release]);

  const value = useMemo(() => ({ document, open, close }), [document, open, close]);
  return <DocumentContext.Provider value={value}>{children}</DocumentContext.Provider>;
}

export function useDocument(): DocumentApi {
  const value = useContext(DocumentContext);
  if (!value) throw new Error('useDocument moet binnen een DocumentProvider worden gebruikt');
  return value;
}
