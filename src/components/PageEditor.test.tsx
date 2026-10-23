// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentProvider } from '../document/DocumentContext';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { LoadedPdf } from '../pdf/loader';
import { PdfSaveError, buildPdf, downloadPdf } from '../pdf/save';
import { Workspace } from './Workspace';

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  buildPdf: vi.fn(async () => new Uint8Array([1, 2, 3])),
  downloadPdf: vi.fn(),
}));

const nl = messages.nl;

function fakePdf(pageCount: number): LoadedPdf {
  const page = {
    rotate: 0,
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    cleanup: () => {},
  };
  const pdf = { numPages: pageCount, getPage: async () => page };
  return { pdf: pdf as unknown as PDFDocumentProxy, pageCount };
}

async function openEditor(pageCount = 3) {
  render(
    <LanguageProvider initial="nl">
      <DocumentProvider load={async () => fakePdf(pageCount)} unload={() => {}}>
        <Workspace editable />
      </DocumentProvider>
    </LanguageProvider>,
  );
  const file = new File(['%PDF-1.7\n' + 'x'.repeat(100)], 'rapport.pdf', {
    type: 'application/pdf',
  });
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await screen.findByRole('listbox');
}

const options = () => screen.getAllByRole('option');
const button = (name: string) => screen.getByRole('button', { name: new RegExp(name) });
const status = () => document.querySelector('.page-editor__status')!.textContent;

beforeEach(() => {
  vi.mocked(buildPdf).mockClear();
  vi.mocked(downloadPdf).mockClear();
});

afterEach(() => cleanup());

describe('PageEditor', () => {
  it('toont een balk met bewerkingen die pas werken na het kiezen van pagina’s', async () => {
    await openEditor();
    expect(screen.getByRole('toolbar', { name: nl.pages.toolbar })).toBeTruthy();
    expect(options()).toHaveLength(3);
    expect(status()).toContain('0 van 3 gekozen');
    for (const name of [
      nl.pages.rotateLeft,
      nl.pages.rotateRight,
      nl.pages.remove,
      nl.pages.undo,
    ]) {
      expect((button(name) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('kiest pagina’s met klikken, Ctrl-klik en Shift-klik', async () => {
    await openEditor(5);
    fireEvent.click(options()[1]!);
    expect(options()[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(options()[3]!, { ctrlKey: true });
    expect(status()).toContain('2 van 5 gekozen');
    fireEvent.click(options()[0]!);
    fireEvent.click(options()[2]!, { shiftKey: true });
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual([
      'true',
      'true',
      'true',
      'false',
      'false',
    ]);
  });

  it('draait de gekozen pagina’s en laat dat zien', async () => {
    await openEditor();
    fireEvent.click(options()[1]!);
    fireEvent.click(button(nl.pages.rotateRight));
    expect(options()[1]!.getAttribute('aria-label')).toBe('Pagina 2, 90° gedraaid');
    expect(options()[1]!.querySelector('.thumb')!.getAttribute('data-rotation')).toBe('90');
    fireEvent.click(button(nl.pages.rotateLeft));
    fireEvent.click(button(nl.pages.rotateLeft));
    expect(options()[1]!.getAttribute('aria-label')).toBe('Pagina 2, 270° gedraaid');
    expect(status()).toContain(nl.pages.unsaved);
  });

  it('verwijdert de gekozen pagina’s en past het aantal aan', async () => {
    await openEditor(4);
    fireEvent.click(options()[0]!);
    fireEvent.click(options()[2]!, { ctrlKey: true });
    fireEvent.click(button(nl.pages.remove));
    expect(options()).toHaveLength(2);
    expect(screen.getByText(/2 pagina’s/)).toBeTruthy();
    expect(status()).toContain('0 van 2 gekozen');
  });

  it('laat nooit alle pagina’s verwijderen', async () => {
    await openEditor(2);
    fireEvent.click(button(nl.pages.selectAll));
    expect((button(nl.pages.remove) as HTMLButtonElement).disabled).toBe(true);
    expect(status()).toContain(nl.pages.keepOne);
  });

  it('maakt ongedaan en opnieuw, met de knoppen en met Ctrl+Z en Ctrl+Y', async () => {
    await openEditor(3);
    fireEvent.click(options()[0]!);
    fireEvent.click(button(nl.pages.remove));
    expect(options()).toHaveLength(2);

    fireEvent.click(button(nl.pages.undo));
    expect(options()).toHaveLength(3);
    fireEvent.click(button(nl.pages.redo));
    expect(options()).toHaveLength(2);

    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    expect(options()).toHaveLength(3);
    fireEvent.keyDown(document, { key: 'y', ctrlKey: true });
    expect(options()).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(options()).toHaveLength(2);
    // Teruggedraaid naar het origineel: dan is er ook niets meer "niet opgeslagen".
    fireEvent.click(button(nl.pages.undo));
    expect(status()).not.toContain(nl.pages.unsaved);
  });

  it('is met het toetsenbord te bedienen', async () => {
    await openEditor(3);
    const list = screen.getByRole('listbox');
    expect(options()[0]!.tabIndex).toBe(0);
    expect(options()[1]!.tabIndex).toBe(-1);

    options()[0]!.focus();
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(options()[1]);
    fireEvent.keyDown(list, { key: ' ' });
    expect(options()[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(list, { key: 'Delete' });
    expect(options()).toHaveLength(2);

    fireEvent.keyDown(list, { key: 'a', ctrlKey: true });
    expect(status()).toContain('2 van 2 gekozen');
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(status()).toContain('0 van 2 gekozen');
  });

  it('maakt bij downloaden een nieuwe PDF volgens het plan, met een eigen naam', async () => {
    await openEditor(3);
    fireEvent.click(options()[2]!);
    fireEvent.click(button(nl.pages.remove));
    fireEvent.click(options()[0]!);
    fireEvent.click(button(nl.pages.rotateRight));
    fireEvent.click(button(nl.pages.save));

    await waitFor(() => expect(downloadPdf).toHaveBeenCalledTimes(1));
    const [, plan] = vi.mocked(buildPdf).mock.calls[0]!;
    expect(plan.map((p) => [p.source, p.rotation])).toEqual([
      [0, 90],
      [1, 0],
    ]);
    expect(vi.mocked(downloadPdf).mock.calls[0]![1]).toBe('rapport (bewerkt).pdf');
    expect(screen.getByRole('status').textContent).toBe('Opgeslagen als rapport (bewerkt).pdf.');
    expect(status()).not.toContain(nl.pages.unsaved);
  });

  it('meldt het als een beveiligde PDF niet kan worden opgeslagen', async () => {
    vi.mocked(buildPdf).mockRejectedValueOnce(new PdfSaveError('encrypted'));
    await openEditor(2);
    fireEvent.click(button(nl.pages.save));
    expect((await screen.findByRole('alert')).textContent).toBe(nl.pages.errors.encrypted);
    expect(downloadPdf).not.toHaveBeenCalled();
  });

  it('heeft een toegankelijke lijst met meervoudige keuze', async () => {
    await openEditor(2);
    const list = screen.getByRole('listbox', { name: /Pagina’s van rapport\.pdf/ });
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    expect(within(list).getAllByRole('option')[0]!.getAttribute('aria-label')).toBe('Pagina 1');
  });
});
