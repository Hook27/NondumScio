// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { unzipSync } from 'fflate';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentProvider } from '../document/DocumentContext';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { LoadedPdf } from '../pdf/loader';
import { buildParts, downloadFile, downloadPdf } from '../pdf/save';
import { rotatePages } from '../pages/plan';
import { useDocument } from '../document/DocumentContext';
import { Workspace } from './Workspace';

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  // Per deel een nep-PDF met de paginanummers erin, zodat je ze in de ZIP terugziet.
  buildParts: vi.fn(
    async (
      _sources: unknown,
      parts: { source: number }[][],
      _progress?: unknown,
      _annotations?: unknown,
      _redaction?: unknown,
      onPart?: (bytes: Uint8Array, index: number) => void,
    ) => {
      const pdfs = parts.map((part) =>
        new TextEncoder().encode(part.map((p) => p.source + 1).join(',')),
      );
      if (!onPart) return pdfs;
      pdfs.forEach((pdf, i) => onPart(pdf, i));
      return [];
    },
  ),
  downloadPdf: vi.fn(),
  downloadFile: vi.fn(),
}));

const nl = messages.nl;
const s = nl.split;

/** Een bladwijzer voor de nep-PDF: titel, pagina (vanaf 0) of null, en wat eronder valt. */
type Item = { title: string; page: number | null; items?: Item[] };

const REPORT: Item[] = [
  { title: 'Inleiding', page: 1 },
  {
    title: 'Hoofdstuk 1',
    page: 3,
    items: [
      { title: 'Paragraaf 1.1', page: 3 },
      { title: 'Paragraaf 1.2', page: 5 },
    ],
  },
  { title: 'Website', page: null },
  { title: 'Bijlage / A', page: 8 },
];

/**
 * Een nep-PDF; het aantal pagina's en de bladwijzers staan in de inhoud van het nepbestand
 * ("%PDF-1.7 10" en daarna de bladwijzers als JSON).
 */
function fakeLoad(bytes: Uint8Array): Promise<LoadedPdf> {
  const text = new TextDecoder().decode(bytes);
  const pageCount = Number(/%PDF-1\.7 (\d+)/.exec(text)?.[1] ?? 1);
  const outline = JSON.parse(text.split('\n')[1] || '[]') as Item[];
  const page = {
    rotate: 0,
    getViewport: ({ scale, rotation }: { scale: number; rotation?: number }) => {
      if (rotation !== undefined) angles.push(rotation);
      return { width: 595 * scale, height: 842 * scale };
    },
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    cleanup: () => {},
  };
  const toNodes = (items: Item[]): unknown[] =>
    items.map((item) => ({
      title: item.title,
      dest: item.page === null ? null : [{ num: item.page, gen: 0 }],
      items: toNodes(item.items ?? []),
    }));
  const pdf = {
    numPages: pageCount,
    getPage: async () => page,
    getOutline: async () => toNodes(outline),
    getDestination: async () => null,
    getPageIndex: async (ref: { num: number }) => ref.num,
  } as unknown as PDFDocumentProxy;
  return Promise.resolve({ pdf, pageCount });
}

/** De draaiingen waarmee pagina's getekend zijn (in het venster Bekijk). */
let angles: number[] = [];

/** Het document, om in een test het pagina-plan te veranderen. */
let doc: ReturnType<typeof useDocument>;
function Grab() {
  doc = useDocument();
  return null;
}

const pdfFile = (name: string, pages: number, outline: Item[]) =>
  new File([`%PDF-1.7 ${pages}\n${JSON.stringify(outline)}\n`], name);

async function setup(outline: Item[] = REPORT, pages = 10, more: File[] = []) {
  render(
    <LanguageProvider initial="nl">
      <DocumentProvider load={fakeLoad} unload={() => {}}>
        <Grab />
        <Workspace mode="split" />
      </DocumentProvider>
    </LanguageProvider>,
  );
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [pdfFile('rapport.pdf', pages, outline), ...more] },
  });
  await screen.findByRole('list', { name: s.parts });
  fireEvent.click(screen.getByLabelText(s.bookmarks));
}

const table = () => screen.getByRole('table', { name: s.table.label });

/** De rijen als "nr | bladwijzer | pagina's | aantal | naam". */
async function rows() {
  await screen.findByRole('table', { name: s.table.label });
  return within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => {
      const cells = within(row).getAllByRole('cell');
      const name = cells[5]!.querySelector('input')!.value;
      return [1, 2, 3, 4].map((i) => cells[i]!.textContent).join(' | ') + ` | ${name}`;
    });
}

const includeBox = (n: number) =>
  screen.getByRole('checkbox', { name: new RegExp(`^Deel ${n} meenemen`) }) as HTMLInputElement;
const nameField = (n: number) =>
  screen.getByLabelText(`Bestandsnaam deel ${n}`) as HTMLInputElement;

beforeEach(() => {
  angles = [];
  vi.mocked(buildParts).mockClear();
  vi.mocked(downloadPdf).mockClear();
  vi.mocked(downloadFile).mockClear();
});

afterEach(() => cleanup());

describe('Splitsen op bladwijzers', () => {
  it('toont de delen in een tabel: voorwerk, ingesprongen niveaus en “ook”', async () => {
    await setup();
    expect(await rows()).toEqual([
      '1 | Voorwerk | 1 | 1 | 01 - Voorwerk.pdf',
      '2 | Inleiding | 2–3 | 2 | 02 - Inleiding.pdf',
      '3 | Paragraaf 1.1ook: Hoofdstuk 1 | 4–5 | 2 | 03 - Paragraaf 1.1.pdf',
      '4 | Paragraaf 1.2 | 6–8 | 3 | 04 - Paragraaf 1.2.pdf',
      '5 | Bijlage / A | 9–10 | 2 | 05 - Bijlage - A.pdf',
    ]);
    // Ingesprongen per niveau.
    const titles = within(table())
      .getAllByRole('cell')
      .filter((cell) => {
        return cell.classList.contains('bookmark-table__title');
      });
    expect(titles.map((cell) => cell.style.getPropertyValue('--depth'))).toEqual([
      '0',
      '0',
      '1',
      '1',
      '0',
    ]);
    // De samenvatting en de meldingen.
    expect(screen.getByText(/^10 pagina’s · 6 bladwijzers · 2 niveaus → /).textContent).toBe(
      '10 pagina’s · 6 bladwijzers · 2 niveaus → 5 van 5 delen geselecteerd (10 pagina’s)',
    );
    expect(
      screen.getByText('1 bladwijzer zonder geldige pagina overgeslagen: Website'),
    ).toBeTruthy();
    expect(screen.getByText(s.sharedOne)).toBeTruthy();
    // De gewone lijst met delen staat er dan niet; de status telt de delen.
    expect(screen.queryByRole('list', { name: s.parts })).toBeNull();
    expect(screen.getByText('5 delen')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Alle 5 delen downloaden (ZIP)' })).toBeTruthy();
  });

  it('splitst op een gekozen niveau, en zet de grenspagina ook in het vorige deel', async () => {
    await setup();
    await rows();
    const level = screen.getByLabelText(s.level) as HTMLSelectElement;
    expect([...level.options].map((option) => option.textContent)).toEqual([
      s.levelAll,
      s.levelOne,
    ]);
    fireEvent.change(level, { target: { value: '1' } });
    expect(await rows()).toEqual([
      '1 | Voorwerk | 1 | 1 | 01 - Voorwerk.pdf',
      '2 | Inleiding | 2–3 | 2 | 02 - Inleiding.pdf',
      '3 | Hoofdstuk 1 | 4–8 | 5 | 03 - Hoofdstuk 1.pdf',
      '4 | Bijlage / A | 9–10 | 2 | 04 - Bijlage - A.pdf',
    ]);
    fireEvent.click(screen.getByLabelText(s.overlap));
    expect((await rows()).map((row) => row.split(' | ')[2])).toEqual(['1–2', '2–4', '4–9', '9–10']);
  });

  it('kent tot drie niveaus de keuzes “alleen niveau 1” en “niveau 1 t/m 2”', async () => {
    await setup([
      {
        title: 'A',
        page: 0,
        items: [{ title: 'A1', page: 1, items: [{ title: 'A1a', page: 2 }] }],
      },
    ]);
    const level = (await screen.findByLabelText(s.level)) as HTMLSelectElement;
    await waitFor(() => expect(level.options).toHaveLength(3));
    expect([...level.options].map((option) => option.textContent)).toEqual([
      'Alle bladwijzers',
      'Alleen niveau 1',
      'Niveau 1 t/m 2',
    ]);
  });

  it('zet een voorvoegsel voor de namen die je niet zelf hebt aangepast', async () => {
    await setup();
    await rows();
    fireEvent.input(nameField(2), { target: { value: 'eigen naam' } });
    fireEvent.input(screen.getByLabelText(s.prefix), { target: { value: '2026 / Q1' } });
    expect(nameField(1).value).toBe('2026 - Q1 01 - Voorwerk.pdf');
    expect(nameField(2).value).toBe('eigen naam');
    expect(nameField(5).value).toBe('2026 - Q1 05 - Bijlage - A.pdf');
  });

  it('zet bij een andere splitsinstelling de namen en vinkjes terug', async () => {
    await setup();
    await rows();
    fireEvent.input(nameField(2), { target: { value: 'eigen naam' } });
    fireEvent.click(includeBox(3));
    expect(includeBox(3).checked).toBe(false);
    fireEvent.click(screen.getByLabelText(s.overlap));
    await waitFor(() => expect(nameField(2).value).toBe('02 - Inleiding.pdf'));
    expect(includeBox(3).checked).toBe(true);
  });

  it('zet ook terug bij een ander niveau dat dezelfde delen geeft', async () => {
    await setup(
      [
        { title: 'A', page: 0, items: [{ title: 'A1', page: null }] },
        { title: 'B', page: 2 },
      ],
      4,
    );
    await rows();
    fireEvent.input(nameField(1), { target: { value: 'eigen naam' } });
    fireEvent.change(screen.getByLabelText(s.level), { target: { value: '1' } });
    await waitFor(() => expect(nameField(1).value).toBe('01 - A.pdf'));
  });

  it('noemt hooguit vijf overgeslagen bladwijzers', async () => {
    const links = Array.from({ length: 6 }, (_, i) => ({ title: `Link ${i + 1}`, page: null }));
    await setup([{ title: 'A', page: 0 }, ...links], 2);
    expect(
      await screen.findByText(
        '6 bladwijzers zonder geldige pagina overgeslagen: Link 1 · Link 2 · Link 3 · Link 4 · Link 5 …',
      ),
    ).toBeTruthy();
  });

  it('neemt alleen de aangevinkte delen mee in de ZIP, met hun naam en titel', async () => {
    await setup();
    await rows();
    fireEvent.click(includeBox(1));
    fireEvent.click(includeBox(4));
    const all = screen.getByRole('checkbox', { name: s.table.all }) as HTMLInputElement;
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(true);
    expect(within(table()).getAllByRole('row')[1]!.className).toContain('bookmark-table__row--off');
    expect(screen.getByText(/→ 3 van 5 delen geselecteerd \(6 pagina’s\)$/)).toBeTruthy();
    fireEvent.input(nameField(5), { target: { value: 'Bijlage: laatste?' } });

    fireEvent.click(screen.getByRole('button', { name: '3 van 5 delen downloaden (ZIP)' }));
    expect((screen.getByLabelText(nl.saveDialog.label) as HTMLInputElement).value).toBe(
      'rapport (gesplitst)',
    );
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const [zip, fileName] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(fileName).toBe('rapport (gesplitst).zip');
    const files = unzipSync(new Uint8Array(await (zip as Blob).arrayBuffer()));
    expect(Object.keys(files)).toEqual([
      '02 - Inleiding.pdf',
      '03 - Paragraaf 1.1.pdf',
      'Bijlage laatste.pdf',
    ]);
    expect(new TextDecoder().decode(files['03 - Paragraaf 1.1.pdf'])).toBe('4,5');
    // Elk deel krijgt de titel van zijn bladwijzer.
    expect(vi.mocked(buildParts).mock.calls[0]![6]).toEqual([
      'Inleiding',
      'Paragraaf 1.1',
      'Bijlage / A',
    ]);

    // Alles uit: niets te downloaden; alles weer aan met het vinkje in de kop.
    fireEvent.click(all);
    expect(all.checked).toBe(true);
    fireEvent.click(all);
    expect(includeBox(2).checked).toBe(false);
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(false);
    expect(
      (screen.getByRole('button', { name: '0 van 5 delen downloaden (ZIP)' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('markeert dubbele namen en nummert ze in de ZIP', async () => {
    await setup();
    await rows();
    fireEvent.input(nameField(2), { target: { value: 'Zelfde' } });
    fireEvent.input(nameField(3), { target: { value: 'zelfde.pdf' } });
    expect(nameField(2).className).toBe('is-duplicate');
    expect(nameField(3).getAttribute('aria-describedby')).toBe('split-duplicate');
    expect(document.getElementById('split-duplicate')!.textContent).toBe(s.duplicate);
    expect(nameField(4).className).toBe('');
    // Een deel dat niet meegaat, telt niet als dubbel.
    fireEvent.click(includeBox(3));
    expect(nameField(2).className).toBe('');
    fireEvent.click(includeBox(3));

    fireEvent.click(screen.getByRole('button', { name: 'Alle 5 delen downloaden (ZIP)' }));
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const zip = vi.mocked(downloadFile).mock.calls[0]![0] as Blob;
    expect(Object.keys(unzipSync(new Uint8Array(await zip.arrayBuffer())))).toEqual([
      '01 - Voorwerk.pdf',
      'Zelfde.pdf',
      'zelfde (2).pdf',
      '04 - Paragraaf 1.2.pdf',
      '05 - Bijlage - A.pdf',
    ]);
  });

  it('downloadt een deel meteen, onder de naam uit de tabel', async () => {
    await setup();
    await rows();
    fireEvent.input(nameField(4), { target: { value: 'Paragraaf / twee' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deel 4 downloaden' }));
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    // Zonder venster "Opslaan als".
    expect(screen.queryByLabelText(nl.saveDialog.label)).toBeNull();
    expect(vi.mocked(downloadPdf).mock.calls[0]![1]).toBe('Paragraaf - twee.pdf');
    const call = vi.mocked(buildParts).mock.calls[0]!;
    expect(call[1].map((part) => part.map((page) => page.source + 1))).toEqual([[6, 7, 8]]);
    expect(call[6]).toEqual(['Paragraaf 1.2']);
    expect(screen.getByRole('status').textContent).toBe('Opgeslagen als Paragraaf - twee.pdf.');
  });

  it('bekijkt een deel pagina voor pagina', async () => {
    await setup();
    await rows();
    fireEvent.click(screen.getByRole('button', { name: 'Bekijk deel 4' }));
    const dialog = screen.getByRole('dialog', { name: '04 - Paragraaf 1.2.pdf' });
    expect(within(dialog).getByText('Pagina 1 van 3 (blz. 6)')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: nl.preview.next }));
    expect(await within(dialog).findByText('Pagina 2 van 3 (blz. 7)')).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(await within(dialog).findByText('Pagina 3 van 3 (blz. 8)')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: nl.preview.close }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('bekijkt een deel met de draaiing uit het pagina-plan', async () => {
    await setup();
    await rows();
    act(() => doc.edit(rotatePages(doc.pages, new Set([doc.pages[5]!.key]), 90)));
    fireEvent.click(screen.getByRole('button', { name: 'Bekijk deel 4' }));
    await waitFor(() => expect(angles).toEqual([90, 90]));
  });

  it('toont rechts ook de pagina’s per deel', async () => {
    await setup(
      [
        { title: 'A', page: 0 },
        { title: 'B', page: 2 },
      ],
      4,
    );
    await rows();
    fireEvent.click(includeBox(2));
    fireEvent.click(screen.getByRole('button', { name: s.views.pages }));
    expect(screen.queryByRole('table')).toBeNull();
    const cells = within(screen.getByRole('list', { name: nl.merge.result })).getAllByRole(
      'listitem',
    );
    expect(cells.map((cell) => cell.querySelector('.page-option__file')!.textContent)).toEqual([
      'Deel 1',
      'Deel 1',
      s.unselected,
      s.unselected,
    ]);
    expect(cells.map((cell) => cell.classList.contains('thumbs__off'))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    fireEvent.click(screen.getByRole('button', { name: s.views.parts }));
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('meldt een PDF zonder bruikbare bladwijzers', async () => {
    await setup([{ title: 'Website', page: null }], 3);
    expect(await screen.findByText(s.noBookmarks)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Alle 0 delen downloaden (ZIP)' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('begint bij een volgend bestand een nieuw deel, met de naam van het bestand', async () => {
    await setup([{ title: 'A', page: 1 }], 3, [
      pdfFile('bijlagen.pdf', 3, [{ title: 'B', page: 1 }]),
    ]);
    await waitFor(() => expect(screen.getByText('6 pagina’s', { exact: false })).toBeTruthy());
    expect(await rows()).toEqual([
      '1 | Voorwerk | 1 | 1 | 01 - Voorwerk.pdf',
      '2 | A | 2–3 | 2 | 02 - A.pdf',
      '3 | bijlagen | 4 | 1 | 03 - bijlagen.pdf',
      '4 | B | 5–6 | 2 | 04 - B.pdf',
    ]);
  });
});

describe('Splitsen op bladwijzers op een smal scherm', () => {
  it('valt terug op per aantal als het venster smal wordt', async () => {
    const original = window.matchMedia;
    let listener = () => {};
    const list = {
      matches: true,
      addEventListener: (_: string, on: () => void) => (listener = on),
      removeEventListener: () => {},
    };
    window.matchMedia = (() => list) as unknown as typeof window.matchMedia;
    try {
      await setup();
      await rows();
      list.matches = false;
      act(() => listener());
      expect(screen.queryByRole('table')).toBeNull();
      expect((screen.getByLabelText(s.every) as HTMLInputElement).checked).toBe(true);
      expect(screen.getByRole('list', { name: s.parts })).toBeTruthy();
    } finally {
      window.matchMedia = original;
    }
  });

  it('staat er niet: alleen op de computer', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      render(
        <LanguageProvider initial="nl">
          <DocumentProvider load={fakeLoad} unload={() => {}}>
            <Workspace mode="split" />
          </DocumentProvider>
        </LanguageProvider>,
      );
      fireEvent.change(document.querySelector('input[type="file"]')!, {
        target: { files: [pdfFile('rapport.pdf', 10, REPORT)] },
      });
      await screen.findByRole('list', { name: s.parts });
      expect(screen.queryByLabelText(s.bookmarks)).toBeNull();
      expect(screen.queryByLabelText(s.level)).toBeNull();
      expect(screen.getByLabelText(s.every)).toBeTruthy();
    } finally {
      window.matchMedia = original;
    }
  });
});
