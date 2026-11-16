import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfLoadError, loadPdf } from './loader';

/**
 * Een nep-pdf.js: `getDocument` geeft een laadtaak die lukt of mislukt, met `destroy`. Zo zien we
 * of een mislukte opening zijn worker opruimt (pdf.js doet dat zelf niet).
 */
const pdfjs = vi.hoisted(() => ({
  outcome: 'ok' as 'ok' | 'broken' | 'password',
  destroy: [] as Array<ReturnType<typeof vi.fn>>,
}));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => {
    const destroy = vi.fn(() => Promise.resolve());
    pdfjs.destroy.push(destroy);
    const promise =
      pdfjs.outcome === 'ok'
        ? Promise.resolve({ numPages: 3 })
        : Promise.reject(
            Object.assign(new Error('mislukt'), {
              name: pdfjs.outcome === 'password' ? 'PasswordException' : 'InvalidPDFException',
            }),
          );
    return { promise, destroy };
  },
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.mjs' }));

const bytes = () => new TextEncoder().encode('%PDF-1.7 inhoud');

beforeEach(() => {
  pdfjs.destroy = [];
  // De tests draaien zonder browser; loadPdf vraagt alleen het adres van de pagina.
  vi.stubGlobal('document', { baseURI: 'http://localhost/' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('een PDF openen: geen worker achterlaten', () => {
  it('een kapotte PDF: de laadtaak (en daarmee de worker) wordt opgeruimd', async () => {
    pdfjs.outcome = 'broken';
    await expect(loadPdf(bytes())).rejects.toBeInstanceOf(PdfLoadError);
    expect(pdfjs.destroy).toHaveLength(1);
    expect(pdfjs.destroy[0]).toHaveBeenCalledTimes(1);
  });

  it('een beveiligde PDF: ook opgeruimd, en de melding blijft "beveiligd"', async () => {
    pdfjs.outcome = 'password';
    const error = await loadPdf(bytes()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfLoadError);
    expect((error as PdfLoadError).code).toBe('password');
    expect(pdfjs.destroy[0]).toHaveBeenCalledTimes(1);
  });

  it('een goede PDF blijft open', async () => {
    pdfjs.outcome = 'ok';
    const loaded = await loadPdf(bytes());
    expect(loaded.pageCount).toBe(3);
    expect(pdfjs.destroy[0]).not.toHaveBeenCalled();
  });
});
