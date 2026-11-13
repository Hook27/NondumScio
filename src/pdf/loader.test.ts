import { describe, expect, it, vi } from 'vitest';
import { flakyFile } from '../lib/testFiles';
import { PdfLoadError, loadPdf, openPdfFile, readPdfBytes } from './loader';

// pdf.js kan niet geladen worden, zoals bij een tabblad dat openstond tijdens een uitrol: het oude
// bestand bestaat dan niet meer.
vi.mock('pdfjs-dist', () => {
  throw new Error('Failed to fetch dynamically imported module');
});
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.mjs' }));

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'gelukt',
    (error: unknown) => (error instanceof PdfLoadError ? error.code : String(error)),
  );

describe('een PDF openen: eerlijke meldingen', () => {
  it('een bestand dat niet van de schijf te lezen is, heet niet "beschadigd"', async () => {
    expect(await codeOf(readPdfBytes(flakyFile('a.pdf', 2).file))).toBe('unreadable');
    expect(await codeOf(openPdfFile(flakyFile('a.pdf', 2).file))).toBe('unreadable');
  });

  it('lukt het lezen bij de tweede poging, dan gaat het gewoon verder', async () => {
    const bytes = await readPdfBytes(flakyFile('a.pdf', 1).file);
    expect(new TextDecoder().decode(bytes)).toBe('%PDF-1.7 inhoud');
  });

  it('geen PDF blijft "geen PDF"', async () => {
    const { file } = flakyFile('foto.jpg', 0, 'JFIF');
    expect(await codeOf(openPdfFile(file))).toBe('not-pdf');
  });

  it('kan de app pdf.js niet laden, dan een eigen melding (herladen), niet "beschadigd"', async () => {
    expect(await codeOf(loadPdf(new TextEncoder().encode('%PDF-1.7 inhoud')))).toBe('app');
  });
});
