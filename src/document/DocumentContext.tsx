import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { looksLikePdf, type LoadErrorCode } from '../pdf/detect';
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
        setDoc({ status: 'error', name: file.name, code });
      }
    },
    [load, unload, release],
  );

  const close = useCallback(() => {
    latest.current += 1;
    release();
    setDoc({ status: 'empty' });
  }, [release]);

  // Ruim het document op als de app verdwijnt.
  useEffect(() => release, [release]);

  const value = useMemo(() => ({ doc, open, close }), [doc, open, close]);
  return <DocContext.Provider value={value}>{children}</DocContext.Provider>;
}

export function useDocument(): DocApi {
  const value = useContext(DocContext);
  if (!value) throw new Error('useDocument moet binnen een DocumentProvider worden gebruikt');
  return value;
}
