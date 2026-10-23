import type { PDFDocumentProxy } from 'pdfjs-dist';
import { classifyLoadError, looksLikePdf, type LoadErrorCode } from './detect';

/** Een geopende PDF. De bytes blijven bewaard voor latere bewerkingen. */
export type LoadedPdf = {
  pdf: PDFDocumentProxy;
  pageCount: number;
};

export class PdfLoadError extends Error {
  constructor(readonly code: LoadErrorCode) {
    super(`PDF kon niet worden geopend: ${code}`);
    this.name = 'PdfLoadError';
  }
}

/**
 * pdf.js is groot; we laden het pas als er echt een PDF geopend wordt, zodat de
 * startpagina snel blijft. Het tekenwerk gebeurt in een aparte "worker", zodat de
 * pagina niet hapert bij grote bestanden.
 */
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function pdfjs() {
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return pdfjsPromise;
}

/**
 * Waar pdf.js zijn hulpbestanden vindt (meegeleverd in /pdfjs/, zie
 * scripts/copy-pdfjs-assets.ts). Ten opzichte van de pagina, zodat het ook werkt in een
 * submap zoals een PR-voorbeeld. Zonder deze bestanden blijven bijvoorbeeld gescande
 * pagina's (JBIG2, JPEG 2000) leeg.
 */
export function pdfjsAssetOptions(baseUrl: string) {
  const dir = (name: string) => new URL(`pdfjs/${name}/`, baseUrl).href;
  return {
    wasmUrl: dir('wasm'),
    cMapUrl: dir('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: dir('standard_fonts'),
    iccUrl: dir('iccs'),
  };
}

/** Opent een PDF uit bytes. Alles gebeurt in de browser; er gaat niets over het netwerk. */
export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  if (!looksLikePdf(bytes)) throw new PdfLoadError('not-pdf');

  const lib = await pdfjs();
  try {
    // pdf.js neemt de bytes over (en maakt ze onbruikbaar); geef daarom een kopie mee.
    const pdf = await lib.getDocument({
      data: bytes.slice(),
      ...pdfjsAssetOptions(document.baseURI),
    }).promise;
    return { pdf, pageCount: pdf.numPages };
  } catch (error) {
    throw new PdfLoadError(classifyLoadError(error));
  }
}

/** Sluit een PDF en geeft het geheugen en de worker vrij. */
export function closePdf(pdf: PDFDocumentProxy): void {
  void pdf.loadingTask.destroy();
}
