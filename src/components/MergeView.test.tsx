// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentProvider } from '../document/DocumentContext';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { PdfLoadError, type LoadedPdf } from '../pdf/loader';
import { buildPdf, downloadPdf } from '../pdf/save';
import { Workspace, type WorkspaceMode } from './Workspace';

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  buildPdf: vi.fn(async () => new Uint8Array([1, 2, 3])),
  downloadPdf: vi.fn(),
}));

const nl = messages.nl;

/** Een nep-PDF; het aantal pagina's staat in de inhoud van het nepbestand ("%PDF-1.7 3"). */
function fakeLoad(bytes: Uint8Array): Promise<LoadedPdf> {
  const text = new TextDecoder().decode(bytes);
  if (text.includes('geheim')) return Promise.reject(new PdfLoadError('password'));
  const pageCount = Number(/%PDF-1\.7 (\d+)/.exec(text)?.[1] ?? 1);
  const page = {
    rotate: 0,
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    cleanup: () => {},
  };
  const pdf = { numPages: pageCount, getPage: async () => page } as unknown as PDFDocumentProxy;
  return Promise.resolve({ pdf, pageCount });
}

const pdfFile = (name: string, pages: number) => new File([`%PDF-1.7 ${pages}\n`], name);

function setup(mode: WorkspaceMode = 'merge') {
  render(
    <LanguageProvider initial="nl">
      <DocumentProvider load={fakeLoad} unload={() => {}}>
        <Workspace mode={mode} />
      </DocumentProvider>
    </LanguageProvider>,
  );
}

/** Kies bestanden in het (eerste) bestandsveld op de pagina. */
function choose(files: File[], selector = 'input[type="file"]') {
  fireEvent.change(document.querySelector(selector)!, { target: { files } });
}

const list = () => screen.getByRole('list', { name: nl.merge.files });
const names = () =>
  within(list())
    .getAllByRole('listitem')
    .map((item) => item.querySelector('.merge-list__name')!.textContent);
const button = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  vi.mocked(buildPdf).mockClear();
  vi.mocked(downloadPdf).mockClear();
});

afterEach(() => cleanup());

describe('Samenvoegen', () => {
  it('opent meerdere bestanden tegelijk en toont ze in volgorde', async () => {
    setup();
    choose([pdfFile('a.pdf', 2), pdfFile('b.pdf', 3), pdfFile('c.pdf', 1)]);
    await screen.findByRole('list', { name: nl.merge.files });
    expect(names()).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
    expect(screen.getByRole('heading', { level: 2, name: '3 bestanden' })).toBeTruthy();
    expect(document.querySelector('.document__meta')!.textContent).toContain('6 pagina’s');
    expect(within(list()).getAllByRole('listitem')[1]!.textContent).toContain('3 pagina’s');
  });

  it('zet bestanden omhoog en omlaag, en dat is ongedaan te maken', async () => {
    setup();
    choose([pdfFile('a.pdf', 2), pdfFile('b.pdf', 3), pdfFile('c.pdf', 1)]);
    await screen.findByRole('list', { name: nl.merge.files });

    fireEvent.click(button('c.pdf omhoog'));
    expect(names()).toEqual(['a.pdf', 'c.pdf', 'b.pdf']);
    fireEvent.click(button('a.pdf omlaag'));
    expect(names()).toEqual(['c.pdf', 'a.pdf', 'b.pdf']);
    expect((button('c.pdf omhoog') as HTMLButtonElement).disabled).toBe(true);
    expect((button('b.pdf omlaag') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(button(nl.pages.undo));
    expect(names()).toEqual(['a.pdf', 'c.pdf', 'b.pdf']);
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(names()).toEqual(['a.pdf', 'b.pdf', 'c.pdf']);
  });

  it('haalt een bestand weg, maar nooit het laatste', async () => {
    setup();
    choose([pdfFile('a.pdf', 2), pdfFile('b.pdf', 3)]);
    await screen.findByRole('list', { name: nl.merge.files });
    fireEvent.click(button('b.pdf weghalen'));
    expect(names()).toEqual(['a.pdf']);
    expect(document.querySelector('.document__meta')!.textContent).toContain('2 pagina’s');
    expect((button('a.pdf weghalen') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button(nl.pages.undo));
    expect(names()).toEqual(['a.pdf', 'b.pdf']);
  });

  it('voegt later nog bestanden toe, achteraan', async () => {
    setup();
    choose([pdfFile('a.pdf', 1)]);
    await screen.findByRole('list', { name: nl.merge.files });
    choose([pdfFile('b.pdf', 2), pdfFile('c.pdf', 1)], '#merge-add');
    await waitFor(() => expect(names()).toEqual(['a.pdf', 'b.pdf', 'c.pdf']));
    // Toevoegen is één stap voor ongedaan maken.
    fireEvent.click(button(nl.pages.undo));
    expect(names()).toEqual(['a.pdf']);
  });

  it('meldt bestanden die niet lukken, en gaat door met de rest', async () => {
    setup();
    choose([
      pdfFile('a.pdf', 1),
      new File(['tekst'], 'notities.txt'),
      new File(['%PDF-1.7 geheim'], 'geheim.pdf'),
    ]);
    await screen.findByRole('list', { name: nl.merge.files });
    expect(names()).toEqual(['a.pdf']);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('notities.txt is geen PDF');
    expect(alert.textContent).toContain('geheim.pdf is beveiligd met een wachtwoord');
  });

  it('downloadt alle bestanden als één PDF, met een voorgestelde naam', async () => {
    setup();
    choose([pdfFile('offerte.pdf', 2), pdfFile('bijlage.pdf', 1)]);
    await screen.findByRole('list', { name: nl.merge.files });
    fireEvent.click(button('bijlage.pdf omhoog'));
    fireEvent.click(button(nl.merge.download));

    const field = screen.getByLabelText(nl.saveDialog.label) as HTMLInputElement;
    expect(field.value).toBe('bijlage (samengevoegd)');
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));

    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    const [sources, plan] = vi.mocked(buildPdf).mock.calls[0]!;
    expect([...sources.keys()].sort()).toEqual([1, 2]);
    expect(plan.map((p) => `${p.doc}:${p.source}`)).toEqual(['2:0', '1:0', '1:1']);
    expect(vi.mocked(downloadPdf).mock.calls[0]![1]).toBe('bijlage (samengevoegd).pdf');
  });

  it('toont bij Pagina’s alle pagina’s van alle bestanden, met de bestandsnaam', async () => {
    setup('pages');
    choose([pdfFile('a.pdf', 1), pdfFile('b.pdf', 2)]);
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]!.getAttribute('aria-label')).toBe('Pagina 1, uit a.pdf');
    expect(options[2]!.getAttribute('aria-label')).toBe('Pagina 3, uit b.pdf');
  });

  it('kan bij Pagina’s een PDF toevoegen', async () => {
    setup('pages');
    choose([pdfFile('a.pdf', 1)]);
    await screen.findAllByRole('option');
    choose([pdfFile('b.pdf', 2)], '#add-pdf');
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3));
  });
});
