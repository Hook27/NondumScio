// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { unzipSync } from 'fflate';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentProvider } from '../document/DocumentContext';
import { messages } from '../i18n';
import { format } from '../i18n/format';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { LoadedPdf } from '../pdf/loader';
import { buildParts, downloadFile, downloadPdf } from '../pdf/save';
import { held } from '../lib/testFiles';
import { Workspace } from './Workspace';

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  // Per deel een nep-PDF met de paginanummers erin, zodat je ze in de ZIP terugziet.
  // Met `onPart` (de ZIP) gaat elk deel daarheen, zoals bij de echte buildParts.
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

// Met `zip.tiny` krijgt de ZIP een grens van één byte, zoals een ZIP die over de 4 GB zou gaan.
const zip = vi.hoisted(() => ({ tiny: false }));
vi.mock('../lib/zip', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/zip')>();
  return {
    ...original,
    zipWriter: (limits?: typeof original.ZIP_LIMITS) =>
      original.zipWriter(zip.tiny ? { bytes: 1, files: 1 } : limits),
  };
});

const nl = messages.nl;

/** Een nep-PDF; het aantal pagina's staat in de inhoud van het nepbestand ("%PDF-1.7 3"). */
function fakeLoad(bytes: Uint8Array): Promise<LoadedPdf> {
  const pageCount = Number(/%PDF-1\.7 (\d+)/.exec(new TextDecoder().decode(bytes))?.[1] ?? 1);
  const page = {
    rotate: 0,
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    cleanup: () => {},
  };
  const pdf = { numPages: pageCount, getPage: async () => page } as unknown as PDFDocumentProxy;
  return Promise.resolve({ pdf, pageCount });
}

async function setup(pages = 5) {
  render(
    <LanguageProvider initial="nl">
      <DocumentProvider load={fakeLoad} unload={() => {}}>
        <Workspace mode="split" />
      </DocumentProvider>
    </LanguageProvider>,
  );
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File([`%PDF-1.7 ${pages}\n`], 'rapport.pdf')] },
  });
  await screen.findByRole('table', { name: nl.split.table.label });
}

/** De delen in de tabel rechts, als "Deel 1 · 1–2" (titel en pagina's). */
const parts = () =>
  within(screen.getByRole('table', { name: nl.split.table.label }))
    .getAllByRole('row')
    .slice(1)
    .map(
      (row) =>
        `${row.querySelector('.bookmark-table__title')!.textContent} · ${row.querySelector('.bookmark-table__pages')!.textContent}`,
    );

beforeEach(() => {
  vi.mocked(buildParts).mockClear();
  vi.mocked(downloadPdf).mockClear();
  vi.mocked(downloadFile).mockClear();
});

afterEach(() => cleanup());

describe('Splitsen', () => {
  it('splitst standaard per pagina', async () => {
    await setup(3);
    expect(parts()).toEqual(['Deel 1 · 1', 'Deel 2 · 2', 'Deel 3 · 3']);
    expect(screen.getByRole('button', { name: 'Alle 3 delen downloaden (ZIP)' })).toBeTruthy();
  });

  it('splitst per vast aantal pagina’s', async () => {
    await setup(5);
    fireEvent.input(screen.getByLabelText(nl.split.size), { target: { value: '2' } });
    expect(parts()).toEqual(['Deel 1 · 1–2', 'Deel 2 · 3–4', 'Deel 3 · 5']);
  });

  it('heeft dezelfde bestandslijst en balk als Samenvoegen', async () => {
    await setup(4);
    const files = screen.getByRole('list', { name: nl.merge.files });
    expect(within(files).getAllByRole('listitem')).toHaveLength(1);
    expect(files.querySelector('.drag-handle')).not.toBeNull();
    expect(screen.getByLabelText('Pagina’s kiezen uit rapport.pdf')).toBeTruthy();
    // Geen apart vak om pagina's te kiezen: rechts staat het resultaat.
    expect(screen.queryByRole('button', { name: new RegExp(nl.merge.showPages) })).toBeNull();
    const toolbar = screen.getByRole('toolbar', { name: nl.split.actions });
    expect(within(toolbar).getByRole('button', { name: nl.pages.undo })).toBeTruthy();
    expect(within(toolbar).getByRole('button', { name: nl.pages.redo })).toBeTruthy();
    // Toevoegen staat onderaan, naast de hoofdactie.
    const wide = toolbar.querySelector('.toolbar__group--wide')!;
    expect(within(wide as HTMLElement).getByText(nl.merge.add)).toBeTruthy();
    expect(
      within(wide as HTMLElement).getByRole('button', { name: 'Alle 4 delen downloaden (ZIP)' }),
    ).toBeTruthy();
  });

  it('toont alle pagina’s in één raster, met het deel waar elke pagina bij hoort', async () => {
    await setup(5);
    fireEvent.input(screen.getByLabelText(nl.split.size), { target: { value: '2' } });
    expect(screen.getByRole('heading', { name: nl.merge.result })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: nl.split.views.pages }));
    const grid = screen.getByRole('list', { name: nl.merge.result });
    const cells = within(grid).getAllByRole('listitem');
    expect(cells.map((cell) => cell.querySelector('.page-option__file')!.textContent)).toEqual([
      'Deel 1',
      'Deel 1',
      'Deel 2',
      'Deel 2',
      'Deel 3',
    ]);
    // Om en om een tint, zodat de delen te onderscheiden zijn; de tekst zegt het ook.
    expect(cells.map((cell) => cell.classList.contains('thumbs__part--alt'))).toEqual([
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  it('maakt wijzigingen aan het bestand ongedaan, en de delen volgen', async () => {
    await setup(5);
    expect(parts()).toHaveLength(5);
    const field = screen.getByLabelText('Pagina’s kiezen uit rapport.pdf');
    fireEvent.input(field, { target: { value: '1-3' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(parts()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: nl.pages.undo }));
    expect(parts()).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: nl.pages.redo }));
    expect(parts()).toHaveLength(3);
  });

  it('splitst op bereiken, toont wat niet in een deel zit, en meldt fouten', async () => {
    await setup(5);
    fireEvent.click(screen.getByLabelText(nl.split.ranges));
    const field = screen.getByLabelText(nl.split.rangesLabel);
    fireEvent.input(field, { target: { value: '1-2, 4-' } });
    expect(parts()).toEqual(['Deel 1 · 1–2', 'Deel 2 · 4–5']);
    // Pagina 3 zit in geen deel: gedempt in het raster, met dat label.
    fireEvent.click(screen.getByRole('button', { name: nl.split.views.pages }));
    const dimmed = document.querySelectorAll('.thumbs__off');
    expect(dimmed).toHaveLength(1);
    expect(dimmed[0]!.textContent).toContain(nl.split.unused);

    fireEvent.input(field, { target: { value: '1-2, 9' } });
    expect(screen.getByRole('alert').textContent).toBe(
      'Pagina 9 bestaat niet: er zijn 5 pagina’s.',
    );
    expect(field.getAttribute('aria-invalid')).toBe('true');
    // Geen melding over bladwijzers: die horen alleen bij Op bladwijzers.
    expect(screen.queryByText(nl.split.noBookmarks)).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Alle 0 delen downloaden (ZIP)' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('meldt een ZIP die te groot wordt, en downloadt dan niets', async () => {
    zip.tiny = true;
    try {
      await setup(3);
      fireEvent.click(screen.getByRole('button', { name: 'Alle 3 delen downloaden (ZIP)' }));
      fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));
      expect((await screen.findByRole('alert')).textContent).toBe(nl.pages.errors.tooLarge);
      expect(downloadFile).not.toHaveBeenCalled();
    } finally {
      zip.tiny = false;
    }
  });

  it('downloadt alle delen als één ZIP', async () => {
    await setup(3);
    fireEvent.click(screen.getByRole('button', { name: 'Alle 3 delen downloaden (ZIP)' }));
    const name = screen.getByLabelText(nl.saveDialog.label) as HTMLInputElement;
    expect(name.value).toBe('rapport (gesplitst)');
    expect(document.querySelector('.save-dialog__extension')!.textContent).toBe('.zip');
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));

    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const [zip, fileName, type] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(fileName).toBe('rapport (gesplitst).zip');
    expect(type).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await (zip as Blob).arrayBuffer()));
    expect(Object.keys(files)).toEqual([
      'rapport (pagina 1).pdf',
      'rapport (pagina 2).pdf',
      'rapport (pagina 3).pdf',
    ]);
    expect(new TextDecoder().decode(files['rapport (pagina 2).pdf'])).toBe('2');
  });
});

describe('Splitsen: weggaan tijdens het opslaan', () => {
  it('er komt geen download meer, en het opslaan wordt afgebroken', async () => {
    await setup(4);
    const work = held([new Uint8Array([1, 2, 3])]);
    vi.mocked(buildParts).mockImplementationOnce(() => work.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Deel 2 downloaden' }));
    await waitFor(() => expect(buildParts).toHaveBeenCalledTimes(1));
    const abort = vi.spyOn(AbortController.prototype, 'abort');
    cleanup();
    // Preact ruimt een weggehaald scherm een tikje later op: wachten tot er afgebroken is.
    await waitFor(() => expect(abort).toHaveBeenCalled());
    abort.mockRestore();
    expect(vi.mocked(buildParts).mock.calls[0]![7]!.aborted).toBe(true);
    work.release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(downloadPdf).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
  });
});

describe('Splitsen: voortgang en Stoppen', () => {
  it('Stoppen tijdens het opslaan: niets gedownload, met een gewone melding', async () => {
    await setup(4);
    const work = held([new Uint8Array([1, 2, 3])]);
    vi.mocked(buildParts).mockImplementationOnce(() => work.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Deel 2 downloaden' }));
    expect(await screen.findByText(format(nl.split.progress, { done: 0, total: 1 }))).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: nl.pages.stop }));
    expect(screen.getByText(nl.pages.stopping)).toBeTruthy();
    work.release();
    const stopped = await screen.findByText(nl.pages.stopped);
    // Geen fout of waarschuwing: je koos er zelf voor.
    expect(stopped.closest('[role="alert"]')).toBeNull();
    expect(stopped.classList.contains('page-editor__status')).toBe(true);
    expect(screen.queryByRole('button', { name: nl.pages.stop })).toBeNull();
    expect(downloadPdf).not.toHaveBeenCalled();
  });
});

describe('Splitsen: per aantal en op bereiken dezelfde weergave als op bladwijzers', () => {
  const s = nl.split;
  const views = () => screen.getByRole('group', { name: s.views.label });
  const names = () =>
    [...document.querySelectorAll<HTMLInputElement>('.bookmark-table__name input')].map(
      (input) => input.value,
    );

  it('rechts Delen en Pagina’s, met de tabel; links geen lijst meer', async () => {
    await setup(3);
    expect(
      within(views()).getByRole('button', { name: s.views.parts }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(document.querySelector('.split-parts')).toBeNull();
    const table = screen.getByRole('table', { name: s.table.label });
    expect(within(table).getAllByRole('columnheader')[2]!.textContent).toBe(s.table.part);
    expect(names()).toEqual([
      'rapport (pagina 1).pdf',
      'rapport (pagina 2).pdf',
      'rapport (pagina 3).pdf',
    ]);
    expect(screen.getByText('3 pagina’s → 3 van 3 delen geselecteerd (3 pagina’s)')).toBeTruthy();
    // Het aantal delen in de kop, zoals bij de andere taken.
    expect(document.querySelector('.pane-head__meta')!.textContent).toBe('3 delen');

    fireEvent.click(within(views()).getByRole('button', { name: s.views.pages }));
    expect(screen.queryByRole('table', { name: s.table.label })).toBeNull();
    expect(screen.getByRole('list', { name: nl.merge.result })).toBeTruthy();
  });

  it('uitvinken en een eigen naam: alleen de gekozen delen in de ZIP, onder hun naam', async () => {
    await setup(3);
    fireEvent.click(screen.getByLabelText(format(s.include, { n: 2, title: 'Deel 2' })));
    fireEvent.input(screen.getByLabelText(format(s.nameLabel, { n: 3 })), {
      target: { value: 'slot' },
    });
    // In het raster is het uitgevinkte deel gedempt.
    fireEvent.click(within(views()).getByRole('button', { name: s.views.pages }));
    expect(document.querySelectorAll('.thumbs__off')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '2 van 3 delen downloaden (ZIP)' }));
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const files = unzipSync(
      new Uint8Array(await (vi.mocked(downloadFile).mock.calls[0]![0] as Blob).arrayBuffer()),
    );
    expect(Object.keys(files)).toEqual(['rapport (pagina 1).pdf', 'slot.pdf']);
    expect(new TextDecoder().decode(files['slot.pdf'])).toBe('3');
    // Geen titel per deel (die hoort bij bladwijzers), wel de grootte in de tabel.
    expect(vi.mocked(buildParts).mock.calls[0]![6]).toBeUndefined();
    fireEvent.click(within(views()).getByRole('button', { name: s.views.parts }));
    const sizes = [...document.querySelectorAll('[role="cell"].bookmark-table__size')].map(
      (cell) => cell.textContent,
    );
    expect(sizes).toEqual(['1 B', '—', '1 B']);
  });

  it('⬇ per deel downloadt meteen, onder de naam uit de tabel', async () => {
    await setup(5);
    fireEvent.input(screen.getByLabelText(s.size), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deel 2 downloaden' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    expect(vi.mocked(downloadPdf).mock.calls[0]![1]).toBe("rapport (pagina's 3-4).pdf");
    const plans = vi.mocked(buildParts).mock.calls[0]![1];
    expect(plans.map((part) => part.map((page) => page.source + 1))).toEqual([[3, 4]]);
    expect(vi.mocked(buildParts).mock.calls[0]![6]).toBeUndefined();
    await waitFor(() =>
      expect(
        document.querySelectorAll('[role="cell"].bookmark-table__size')[1]!.textContent,
      ).not.toBe('—'),
    );
  });

  it('op bereiken kan een deel losse pagina’s zijn: precies die gaan mee', async () => {
    await setup(5);
    fireEvent.click(screen.getByLabelText(s.ranges));
    fireEvent.input(screen.getByLabelText(s.rangesLabel), { target: { value: '4-, 1 3' } });
    expect(parts()).toEqual(['Deel 1 · 4–5', 'Deel 2 · 1, 3']);
    expect(screen.getByText('5 pagina’s → 2 van 2 delen geselecteerd (4 pagina’s)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Deel 2 downloaden' }));
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    const plans = vi.mocked(buildParts).mock.calls[0]![1];
    expect(plans.map((part) => part.map((page) => page.source + 1))).toEqual([[1, 3]]);
  });

  it('op bereiken ook: de tabel volgt de bereiken', async () => {
    await setup(5);
    fireEvent.click(screen.getByLabelText(s.ranges));
    fireEvent.input(screen.getByLabelText(s.rangesLabel), { target: { value: '1-2, 4-' } });
    expect(names()).toEqual(["rapport (pagina's 1-2).pdf", "rapport (pagina's 4-5).pdf"]);
    expect(screen.getByText('5 pagina’s → 2 van 2 delen geselecteerd (4 pagina’s)')).toBeTruthy();
  });
});
