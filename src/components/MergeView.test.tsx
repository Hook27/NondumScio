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

  it('probeert een bestand nog één keer als het openen een keer mislukt', async () => {
    let attempts = 0;
    const flaky = (bytes: Uint8Array) => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error('worker te laat')) : fakeLoad(bytes);
    };
    render(
      <LanguageProvider initial="nl">
        <DocumentProvider load={flaky} unload={() => {}}>
          <Workspace mode="merge" />
        </DocumentProvider>
      </LanguageProvider>,
    );
    choose([pdfFile('a.pdf', 2)]);
    await screen.findByRole('list', { name: nl.merge.files });
    expect(names()).toEqual(['a.pdf']);
    expect(attempts).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
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

  it('kiest per bestand pagina’s met een bereik, en dat is ongedaan te maken', async () => {
    setup();
    choose([pdfFile('a.pdf', 2), pdfFile('b.pdf', 5)]);
    await screen.findByRole('list', { name: nl.merge.files });
    const field = screen.getByLabelText('Pagina’s kiezen uit b.pdf') as HTMLInputElement;
    expect(field.value).toBe('1-5');

    fireEvent.input(field, { target: { value: '4, 1-2' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(field.value).toBe('1-2, 4');
    expect(within(list()).getAllByRole('listitem')[1]!.textContent).toContain('3 van 5 pagina’s');
    expect(document.querySelector('.document__meta')!.textContent).toContain('5 pagina’s');

    fireEvent.click(button(nl.pages.undo));
    expect(field.value).toBe('1-5');
  });

  it('meldt een verkeerd bereik en laat de keuze dan zoals hij was', async () => {
    setup();
    choose([pdfFile('a.pdf', 3)]);
    await screen.findByRole('list', { name: nl.merge.files });
    const field = screen.getByLabelText('Pagina’s kiezen uit a.pdf') as HTMLInputElement;

    fireEvent.input(field, { target: { value: '2-7' } });
    fireEvent.blur(field);
    expect(screen.getByRole('alert').textContent).toBe(
      'Pagina 7 bestaat niet: dit bestand heeft 3 pagina’s.',
    );
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect((button(nl.pages.undo) as HTMLButtonElement).disabled).toBe(true);

    // Escape zet het veld terug.
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field.value).toBe('1-3');
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.input(field, { target: { value: '' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toContain('Kies minstens één pagina');
  });

  it('kiest pagina’s met vinkjes bij de miniaturen, maar laat er minstens één staan', async () => {
    setup();
    choose([pdfFile('a.pdf', 3)]);
    await screen.findByRole('list', { name: nl.merge.files });
    const toggle = button(`${nl.merge.showPages}: a.pdf`);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    // Het rechtervak toont nu de pagina's van dit bestand, en de kop daarvan krijgt de focus.
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(document.activeElement?.textContent).toBe('a.pdf: pagina’s kiezen'));

    const group = screen.getByRole('group', { name: 'Miniaturen van a.pdf' });
    const boxes = within(group).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.checked)).toEqual([true, true, true]);

    fireEvent.click(boxes[1]!);
    fireEvent.click(boxes[2]!);
    const field = screen.getByLabelText('Pagina’s kiezen uit a.pdf') as HTMLInputElement;
    expect(field.value).toBe('1');
    // De laatste pagina kan niet uit; aanzetten kan weer wel.
    expect(boxes[0]!.disabled).toBe(true);
    fireEvent.click(boxes[2]!);
    expect(field.value).toBe('1, 3');

    fireEvent.click(button(nl.merge.showResult));
    expect(screen.queryByRole('group', { name: 'Miniaturen van a.pdf' })).toBeNull();
    expect(screen.getByRole('heading', { name: nl.merge.result })).toBeTruthy();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('maakt standaard geen nieuwe bladwijzers', async () => {
    setup();
    choose([pdfFile('a.pdf', 1), pdfFile('b.pdf', 1)]);
    await screen.findByRole('list', { name: nl.merge.files });
    expect((screen.getByLabelText(nl.merge.bookmarks) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText('Bladwijzer voor a.pdf')).toBeNull();

    fireEvent.click(button(nl.merge.download));
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    expect(vi.mocked(buildPdf).mock.calls[0]![2]).toEqual({ annotations: [] });
  });

  it('maakt met de optie een bladwijzer per bestand, met een aanpasbare titel', async () => {
    setup();
    choose([pdfFile('offerte.pdf', 2), pdfFile('bijlage.pdf', 1), pdfFile('c.pdf', 1)]);
    await screen.findByRole('list', { name: nl.merge.files });
    fireEvent.click(screen.getByLabelText(nl.merge.bookmarks));

    // Standaard de bestandsnaam zonder .pdf.
    const offerte = screen.getByLabelText('Bladwijzer voor offerte.pdf') as HTMLInputElement;
    expect(offerte.value).toBe('offerte');
    fireEvent.input(screen.getByLabelText('Bladwijzer voor bijlage.pdf'), {
      target: { value: 'Bijlage A' },
    });
    // Leeg gemaakt: dan toch de bestandsnaam.
    fireEvent.input(screen.getByLabelText('Bladwijzer voor c.pdf'), { target: { value: '  ' } });
    // De volgorde volgt de lijst.
    fireEvent.click(button('bijlage.pdf omhoog'));

    fireEvent.click(button(nl.merge.download));
    fireEvent.click(screen.getByRole('button', { name: nl.saveDialog.download }));
    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    expect(vi.mocked(buildPdf).mock.calls[0]![2]).toEqual({
      annotations: [],
      bookmarks: [
        { doc: 2, title: 'Bijlage A' },
        { doc: 1, title: 'offerte' },
        { doc: 3, title: 'c' },
      ],
    });
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
