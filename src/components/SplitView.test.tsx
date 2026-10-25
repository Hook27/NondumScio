// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { unzipSync } from 'fflate';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentProvider } from '../document/DocumentContext';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { LoadedPdf } from '../pdf/loader';
import { buildParts, downloadFile, downloadPdf } from '../pdf/save';
import { Workspace } from './Workspace';

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  // Per deel een nep-PDF met de paginanummers erin, zodat je ze in de ZIP terugziet.
  buildParts: vi.fn(async (_sources: unknown, parts: { source: number }[][]) =>
    parts.map((part) => new TextEncoder().encode(part.map((p) => p.source + 1).join(','))),
  ),
  downloadPdf: vi.fn(),
  downloadFile: vi.fn(),
}));

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
  await screen.findByRole('list', { name: nl.split.parts });
}

const parts = () =>
  within(screen.getByRole('list', { name: nl.split.parts }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

beforeEach(() => {
  vi.mocked(buildParts).mockClear();
  vi.mocked(downloadPdf).mockClear();
  vi.mocked(downloadFile).mockClear();
});

afterEach(() => cleanup());

describe('Splitsen', () => {
  it('splitst standaard per pagina', async () => {
    await setup(3);
    expect(parts()).toEqual(['Deel 1pagina 1', 'Deel 2pagina 2', 'Deel 3pagina 3']);
    expect(screen.getByRole('button', { name: 'Alle 3 delen downloaden (ZIP)' })).toBeTruthy();
  });

  it('splitst per vast aantal pagina’s', async () => {
    await setup(5);
    fireEvent.input(screen.getByLabelText(nl.split.size), { target: { value: '2' } });
    expect(parts()).toEqual(['Deel 1pagina’s 1-2', 'Deel 2pagina’s 3-4', 'Deel 3pagina 5']);
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
    expect(parts()).toEqual(['Deel 1pagina’s 1-2', 'Deel 2pagina’s 4-5']);
    // Pagina 3 zit in geen deel: gedempt in het raster, met dat label.
    const dimmed = document.querySelectorAll('.thumbs__off');
    expect(dimmed).toHaveLength(1);
    expect(dimmed[0]!.textContent).toContain(nl.split.unused);

    fireEvent.input(field, { target: { value: '1-2, 9' } });
    expect(screen.getByRole('alert').textContent).toBe(
      'Pagina 9 bestaat niet: er zijn 5 pagina’s.',
    );
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(
      (screen.getByRole('button', { name: 'Alle 0 delen downloaden (ZIP)' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('downloadt één deel als PDF, met een voorgestelde naam', async () => {
    await setup(5);
    fireEvent.input(screen.getByLabelText(nl.split.size), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deel 2 downloaden' }));
    const name = screen.getByLabelText(nl.saveDialog.label) as HTMLInputElement;
    expect(name.value).toBe("rapport (pagina's 3-4)");
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));

    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    const plans = vi.mocked(buildParts).mock.calls[0]![1];
    expect(plans.map((part) => part.map((page) => page.source + 1))).toEqual([[3, 4]]);
    expect(vi.mocked(downloadPdf).mock.calls[0]![1]).toBe("rapport (pagina's 3-4).pdf");
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
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual([
      'rapport (pagina 1).pdf',
      'rapport (pagina 2).pdf',
      'rapport (pagina 3).pdf',
    ]);
    expect(new TextDecoder().decode(files['rapport (pagina 2).pdf'])).toBe('2');
  });
});
