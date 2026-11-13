// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/preact';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it } from 'vitest';
import { hasRedactions, type BoxAnnotation } from '../annotations/model';
import { HISTORY_LIMIT } from '../pages/plan';
import type { LoadedPdf } from '../pdf/loader';
import { flakyFile } from '../lib/testFiles';
import { DocumentProvider, useDocument } from './DocumentContext';

type DocApi = ReturnType<typeof useDocument>;

function fakePdf(pageCount: number): LoadedPdf {
  const pdf = { numPages: pageCount, getPage: async () => ({}) };
  return { pdf: pdf as unknown as PDFDocumentProxy, pageCount };
}

/** Opent een document van drie pagina's en geeft de documentstand terug (altijd de nieuwste). */
async function openThree() {
  const api: { current: DocApi | null } = { current: null };
  function Probe() {
    api.current = useDocument();
    return null;
  }
  render(
    <DocumentProvider load={async () => fakePdf(3)} unload={() => {}}>
      <Probe />
    </DocumentProvider>,
  );
  await act(async () => {
    await api.current!.open(new File(['%PDF-1.7'], 'rapport.pdf', { type: 'application/pdf' }));
  });
  await waitFor(() => expect(api.current!.pages).toHaveLength(3));
  const get = () => api.current!;
  const id = get().pages[0]!.doc;
  return { get, id };
}

const redactBox = (page: number): BoxAnnotation => ({
  id: 1,
  page,
  kind: 'redact',
  x: 40,
  y: 60,
  width: 200,
  height: 40,
  color: '#000000',
  strokeWidth: 0,
});

afterEach(() => cleanup());

describe('pagina uit en weer aan: vakken en draaiing blijven', () => {
  /** Zet een redactievak op pagina 2 en draait die pagina een kwartslag. */
  async function boxAndRotate(get: () => DocApi) {
    const second = get().pages[1]!;
    act(() => get().annotate((items) => [...items, redactBox(second.key)]));
    act(() => get().edit(get().pages.map((p) => (p === second ? { ...p, rotation: 90 } : p))));
    return second.key;
  }

  /** Pagina 2 hoort er weer bij, met dezelfde sleutel, draaiing en het vak. */
  function expectRestored(get: () => DocApi, key: number) {
    const second = get().pages[1]!;
    expect(second).toMatchObject({ key, source: 1, rotation: 90 });
    expect(hasRedactions([second], get().annotations)).toBe(true);
  }

  it('via het paginabereik (bijvoorbeeld 1, en daarna weer 1-3)', async () => {
    const { get, id } = await openThree();
    const key = await boxAndRotate(get);
    act(() => get().setSourcePages(id, new Set([0])));
    expect(get().pages).toHaveLength(1);
    act(() => get().setSourcePages(id, new Set([0, 1, 2])));
    expectRestored(get, key);
  });

  it('ook als de pagina bij Pagina’s is verwijderd', async () => {
    const { get, id } = await openThree();
    const key = await boxAndRotate(get);
    act(() => get().edit(get().pages.filter((p) => p.key !== key)));
    act(() => get().setSourcePages(id, new Set([0, 1, 2])));
    expectRestored(get, key);
  });

  it('ook na meer stappen dan ongedaan maken onthoudt', async () => {
    const { get, id } = await openThree();
    const key = await boxAndRotate(get);
    act(() => get().edit(get().pages.filter((p) => p.key !== key)));
    // Pagina 1 heel vaak draaien: de stap waarin pagina 2 er nog was, valt uit de ongedaan-reeks.
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) {
      act(() =>
        get().edit(get().pages.map((p, n) => (n === 0 ? { ...p, rotation: i % 2 ? 0 : 90 } : p))),
      );
    }
    act(() => get().setSourcePages(id, new Set([0, 1, 2])));
    expectRestored(get, key);
  });
});

describe('een bestand dat de browser even niet kan lezen', () => {
  /** Opent `file` en geeft de documentstand terug. */
  async function openFile(file: File) {
    const api: { current: DocApi | null } = { current: null };
    function Probe() {
      api.current = useDocument();
      return null;
    }
    render(
      <DocumentProvider load={async () => fakePdf(2)} unload={() => {}}>
        <Probe />
      </DocumentProvider>,
    );
    await act(async () => {
      await api.current!.open(file);
    });
    return () => api.current!;
  }

  it('lukt het bij de tweede poging, dan opent het gewoon', async () => {
    const get = await openFile(flakyFile('rapport.pdf', 1).file);
    await waitFor(() => expect(get().pages).toHaveLength(2));
  });

  it('lukt het niet, dan heet het "niet van de schijf te lezen", niet "beschadigd"', async () => {
    const get = await openFile(flakyFile('rapport.pdf', Infinity).file);
    await waitFor(() =>
      expect(get().doc).toEqual({ status: 'error', name: 'rapport.pdf', code: 'unreadable' }),
    );
  });
});
