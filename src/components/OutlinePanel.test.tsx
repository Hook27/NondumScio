// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { afterEach, describe, expect, it } from 'vitest';
import { DocumentProvider } from '../document/DocumentContext';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import type { LoadedPdf } from '../pdf/loader';
import { Workspace, type WorkspaceMode } from './Workspace';

const nl = messages.nl;
const o = nl.outline;

type Node = { title: string; dest: unknown; items: Node[] };
const node = (title: string, page: number | null, items: Node[] = []): Node => ({
  title,
  dest: page === null ? null : [{ num: page + 10, gen: 0 }, { name: 'Fit' }],
  items,
});

/** Een nep-PDF; "%PDF-1.7 6 outline" heeft zes pagina's en bladwijzers. */
function fakeLoad(bytes: Uint8Array): Promise<LoadedPdf> {
  const text = new TextDecoder().decode(bytes);
  const pageCount = Number(/%PDF-1\.7 (\d+)/.exec(text)?.[1] ?? 1);
  const outline = text.includes('outline')
    ? [
        node('Inleiding', 0),
        node('Hoofdstuk 1', 1, [node('Paragraaf 1.1', 2), node('Paragraaf 1.2', 3)]),
        node('Bijlage', 5),
        node('Website', null),
      ]
    : [];
  const page = {
    rotate: 0,
    getViewport: ({ scale, rotation = 0 }: { scale: number; rotation?: number }) => {
      const sideways = rotation === 90 || rotation === 270;
      return { width: (sideways ? 842 : 595) * scale, height: (sideways ? 595 : 842) * scale };
    },
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    cleanup: () => {},
  };
  const pdf = {
    numPages: pageCount,
    getPage: async () => page,
    getOutline: async () => outline,
    getDestination: async () => null,
    getPageIndex: async (ref: { num: number }) => ref.num - 10,
  } as unknown as PDFDocumentProxy;
  return Promise.resolve({ pdf, pageCount });
}

async function setup(mode: WorkspaceMode, content = '%PDF-1.7 6 outline\n') {
  render(
    <LanguageProvider initial="nl">
      <DocumentProvider load={fakeLoad} unload={() => {}}>
        <Workspace mode={mode} />
      </DocumentProvider>
    </LanguageProvider>,
  );
  fireEvent.change(document.querySelector('input[type="file"]')!, {
    target: { files: [new File([content], 'rapport.pdf')] },
  });
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
  // De bladwijzers worden na het openen apart ingelezen.
  if (content.includes('outline')) await screen.findByText(/^Bladwijzers \(\d+\)$/);
}

const summary = () => screen.getByText(o.title.replace('{n}', '6'));
const panel = () => summary().closest('details')!;
const entry = (name: RegExp) => within(panel()).getByRole('button', { name });

afterEach(() => cleanup());

describe('Bladwijzers tonen', () => {
  for (const mode of ['pages', 'edit', 'redact'] as const) {
    it(`staat ingeklapt onder de bestandslijst (${mode})`, async () => {
      await setup(mode);
      expect(panel().open).toBe(false);
      // Direct onder de bestandslijst.
      expect(screen.getByRole('list', { name: nl.merge.files }).nextElementSibling).toBe(panel());
      expect(
        within(panel()).getByRole('list', { name: 'Bladwijzers van rapport.pdf' }),
      ).toBeTruthy();
    });
  }

  it('is er niet bij een bestand zonder bladwijzers', async () => {
    await setup('pages', '%PDF-1.7 3\n');
    expect(screen.queryByText(/^Bladwijzers \(/)).toBeNull();
  });

  it('toont het bovenste niveau met paginanummers en klapt onderliggende uit', async () => {
    await setup('edit');
    expect(entry(/^Inleiding/).textContent).toContain('blz. 1');
    expect(entry(/^Bijlage/).textContent).toContain('blz. 6');
    expect(within(panel()).queryByText('Paragraaf 1.1')).toBeNull();
    const toggle = within(panel()).getByRole('button', {
      name: 'Onderliggende bladwijzers van Hoofdstuk 1',
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(entry(/^Paragraaf 1\.2/).textContent).toContain('blz. 4');
    // Een link zonder pagina staat er, maar is geen knop.
    expect(within(panel()).getByText('Website')).toBeTruthy();
    expect(within(panel()).getByText(o.noPage)).toBeTruthy();
    expect(within(panel()).queryByRole('button', { name: /^Website/ })).toBeNull();
  });

  it('selecteert bij Pagina’s de pagina van de bladwijzer', async () => {
    await setup('pages');
    fireEvent.click(entry(/^Bijlage/));
    const option = screen.getByRole('option', { name: 'Pagina 6' });
    expect(option.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(option);
    expect(screen.getByText(/1 van 6 gekozen/)).toBeTruthy();
  });

  it('springt bij Bewerken naar de pagina: focus erop en even oplichtend', async () => {
    await setup('edit');
    fireEvent.click(entry(/^Hoofdstuk 1/));
    const target = screen.getByRole('group', { name: 'Pagina 2' });
    expect(document.activeElement).toBe(target);
    expect(target.closest('li')!.classList.contains('annotate-pages__item--flash')).toBe(true);
  });

  it('markeert een bladwijzer naar een weggehaalde pagina en past de nummers aan', async () => {
    await setup('pages');
    const field = screen.getByLabelText('Pagina’s kiezen uit rapport.pdf');
    fireEvent.input(field, { target: { value: '2-6' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(within(panel()).queryByRole('button', { name: /^Inleiding/ })).toBeNull();
    expect(within(panel()).getByText(o.removed)).toBeTruthy();
    expect(entry(/^Hoofdstuk 1/).textContent).toContain('blz. 1');
    expect(within(panel()).getByText(`${o.removedOne} ${o.nowhere}`)).toBeTruthy();
  });

  it('meldt bij redactievakken dat de bladwijzers niet meegaan', async () => {
    await setup('redact');
    expect(within(panel()).queryByText(o.redacted)).toBeNull();
    fireEvent.keyDown(document.body, { key: 'r' });
    fireEvent.keyDown(screen.getByRole('group', { name: 'Pagina 1' }), { key: 'Enter' });
    expect(document.querySelectorAll('[data-annotation]')).toHaveLength(1);
    expect(within(panel()).getByText(o.redacted)).toBeTruthy();
  });

  it('groepeert per bestand en meldt dat ze bij meer bestanden niet meegaan', async () => {
    await setup('pages');
    fireEvent.change(document.querySelector('#add-pdf')!, {
      target: { files: [new File(['%PDF-1.7 2 outline\n'], 'tweede.pdf')] },
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
    const details = (await screen.findByText(o.title.replace('{n}', '12'))).closest('details')!;
    expect(within(details).getByRole('list', { name: 'Bladwijzers van tweede.pdf' })).toBeTruthy();
    expect(within(details).getByText(o.merged)).toBeTruthy();
    // Het tweede bestand staat achteraan: zijn eerste bladwijzer wijst naar plek 7.
    const second = within(details).getByRole('list', { name: 'Bladwijzers van tweede.pdf' });
    expect(within(second).getByRole('button', { name: /^Inleiding/ }).textContent).toContain(
      'blz. 7',
    );
  });
});
