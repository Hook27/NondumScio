import { describe, expect, it } from 'vitest';
import { readPdf } from '../compare/readPdf';
import { pageSize } from '../compare/visual';
import { flakyFile } from '../lib/testFiles';
import { countPages, readLines } from '../rename/readText';
import { PdfLoadError } from './loader';
import { PdfSaveError, readSources } from './save';

/** Een bestand dat steeds weigert, zoals een PDF die na het kiezen is verplaatst. */
const gone = () => flakyFile('weg.pdf', Infinity).file;

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'gelukt',
    (error: unknown) =>
      error instanceof PdfLoadError || error instanceof PdfSaveError ? error.code : String(error),
  );

describe('elke plek die een gekozen bestand leest, meldt "niet te lezen" (niet "beschadigd")', () => {
  it.each([
    ['Vergelijken en Platte tekst: de tekst', () => readPdf(gone())],
    ['Vergelijken en Triage: het beeld', () => pageSize(gone(), 1)],
    ['Slim hernoemen: de tekst', () => readLines(gone())],
    ['Slim hernoemen: het aantal pagina’s', () => countPages(gone())],
  ])('%s', async (_, read) => {
    expect(await codeOf(read())).toBe('unreadable');
  });

  it('opslaan (alle basistaken): het bestand is intussen weg', async () => {
    const page = { key: 0, doc: 1, source: 0, rotation: 0 as const };
    expect(await codeOf(readSources(new Map([[1, gone()]]), [page]))).toBe('unreadable');
  });

  it('lukt het lezen bij de tweede poging, dan gaat opslaan gewoon door', async () => {
    const page = { key: 0, doc: 1, source: 0, rotation: 0 as const };
    const sources = await readSources(new Map([[1, flakyFile('a.pdf', 1).file]]), [page]);
    expect(new TextDecoder().decode(sources.get(1))).toBe('%PDF-1.7 inhoud');
  });
});
