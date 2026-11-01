// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { PdfLoadError } from '../pdf/loader';
import { CompareTool } from './CompareTool';
import { compareTexts } from './diff';
import type { PageText, Piece } from './layout';
import { readPdf } from './readPdf';
import { resetCompareState } from './store';

/** Een pagina met alinea's van elk twee regels, met een witregel ertussen. */
function page(no: number, paragraphs: string[]): PageText {
  const items: Piece[] = [];
  let y = 760;
  for (const paragraph of paragraphs) {
    const words = paragraph.split(' ');
    const half = Math.ceil(words.length / 2);
    for (const str of [words.slice(0, half).join(' '), words.slice(half).join(' ')]) {
      if (!str) continue;
      items.push({ str, x: 50, y, fh: 10, w: str.length * 5 });
      y -= 12;
    }
    y -= 24;
  }
  return { no, w: 595, h: 842, items, chars: items.reduce((n, i) => n + i.str.length, 0) };
}

const SAME = Array.from({ length: 6 }, (_, i) => `Ongewijzigde alinea nummer ${i + 1}.`);

/** Wat er per bestand "gelezen" wordt: de pagina's (of een fout). */
const DOCS: Record<string, PageText[] | Error> = {
  'oud.pdf': [page(1, [...SAME, 'De huur is 500 euro per maand.', 'Deze alinea vervalt straks.'])],
  'nieuw.pdf': [page(1, [...SAME, 'De huur is 550 euro per maand.'])],
  'kopie.pdf': [
    page(1, [...SAME, 'De huur is 500 euro per maand.', 'Deze alinea vervalt straks.']),
  ],
  'scan.pdf': [page(1, []), page(2, ['Alleen hier tekst.'])],
  'geheim.pdf': new PdfLoadError('password'),
  'kapot.pdf': new Error('kapot'),
};

/** Een "poortje" om het lezen van een bestand even vast te houden (ook als het daarna mislukt). */
const gates: Record<string, Promise<void>> = {};

vi.mock('./readPdf', () => ({
  readPdf: vi.fn(async (file: File, onProgress?: (done: number, total: number) => void) => {
    const pages = DOCS[file.name]!;
    if (!(pages instanceof Error)) onProgress?.(0, pages.length);
    if (gates[file.name]) await gates[file.name];
    if (pages instanceof Error) throw pages;
    onProgress?.(pages.length, pages.length);
    return { pageCount: pages.length, pages, thumb: null };
  }),
}));

// De echte vergelijking, maar zo dat een test kan doen alsof de documenten te groot waren.
vi.mock('./diff', async (importOriginal) => {
  const real = await importOriginal<typeof import('./diff')>();
  return { ...real, compareTexts: vi.fn(real.compareTexts) };
});

const c = messages.nl.compare;
const pdf = (name: string) => new File([`%PDF-1.7 ${name}`], name, { type: 'application/pdf' });

function setup() {
  render(
    <LanguageProvider initial="nl">
      <CompareTool />
    </LanguageProvider>,
  );
}

/** Kiest bestanden in het vak van A of B. */
function choose(side: 'a' | 'b', ...names: string[]) {
  fireEvent.change(document.querySelector(`#compare-file-${side}`)!, {
    target: { files: names.map(pdf) },
  });
}

const slot = (side: 'a' | 'b') =>
  screen.getByRole('heading', { name: c.sides[side].title }).closest('section')!;

afterEach(() => {
  cleanup();
  // De stand blijft bewaard buiten het scherm; elke test begint leeg.
  resetCompareState();
  for (const name of Object.keys(gates)) delete gates[name];
  vi.mocked(readPdf).mockClear();
});

describe('PDF’s vergelijken', () => {
  it('begint leeg, met een vak voor A en B', () => {
    setup();
    expect(screen.getByText(c.placeholder)).toBeTruthy();
    expect(within(slot('a')).getByText(c.sides.a.choose)).toBeTruthy();
    expect(within(slot('b')).getByText(c.sides.b.choose)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: c.swap }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: c.clear }).disabled).toBe(true);
  });

  it('met alleen A: wat er gelezen is, en dat B nog nodig is', async () => {
    setup();
    choose('a', 'oud.pdf');
    await screen.findByText(format(c.waitingFor, { side: 'B' }));
    expect(within(slot('a')).getByText('oud.pdf')).toBeTruthy();
    expect(within(slot('a')).getByText(/^1 pagina · .* · 2\d\d tekens$/)).toBeTruthy();
    expect(within(slot('a')).getByText(c.sides.a.replace)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('vergelijkt vanzelf zodra A en B er zijn: gewijzigd met de woorden, en verwijderd', async () => {
    setup();
    choose('a', 'oud.pdf');
    choose('b', 'nieuw.pdf');
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'A · oud.pdf' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'B · nieuw.pdf' })).toBeTruthy();
    // De woorden die verschillen: weggehaald in A, toegevoegd in B.
    expect(table.querySelector('del')!.textContent).toBe('500');
    expect(table.querySelector('ins')!.textContent).toBe('550');
    const changed = table.querySelector('del')!.closest('tr')!;
    expect(changed.classList.contains('compare-diff__row--changed')).toBe(true);
    expect(within(changed).getAllByText('Gewijzigd:', { exact: false })).toHaveLength(2);
    // De alinea die alleen in A staat, met een lege cel bij B.
    const removed = within(table).getByText('Deze alinea vervalt straks.').closest('tr')!;
    expect(removed.classList.contains('compare-diff__row--removed')).toBe(true);
    expect(removed.querySelector('.compare-diff__cell--empty')).toBeTruthy();
    expect(screen.getByText('0 toegevoegd')).toBeTruthy();
    expect(screen.getByText('1 verwijderd')).toBeTruthy();
    expect(screen.getByText('1 gewijzigd')).toBeTruthy();
    expect(screen.getByText('A: 1 pagina, 8 alinea’s · B: 1 pagina, 7 alinea’s')).toBeTruthy();
    // Het paginalabel, met voor schermlezers het hele woord.
    expect(within(changed).getAllByText('Pagina 1')).toHaveLength(2);
  });

  it('klapt ongewijzigde alinea’s in, en toont ze met een klik (de focus gaat mee)', async () => {
    setup();
    choose('a', 'oud.pdf');
    choose('b', 'nieuw.pdf');
    const table = await screen.findByRole('table');
    // Zes gelijke alinea's; de laatste staat als context bij het verschil.
    expect(within(table).queryByText('Ongewijzigde alinea nummer 1.')).toBeNull();
    expect(within(table).getAllByText('Ongewijzigde alinea nummer 6.')).toHaveLength(2);
    const expand = within(table).getByRole('button', { name: '5 ongewijzigde alinea’s tonen' });
    fireEvent.click(expand);
    expect(within(table).getAllByText('Ongewijzigde alinea nummer 1.')).toHaveLength(2);
    expect(within(table).queryByRole('button')).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(table).getAllByText('Ongewijzigde alinea nummer 1.')[0]!.closest('tr'),
      ),
    );
  });

  it('twee PDF’s tegelijk worden A en B; omwisselen zet ze andersom', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'A · oud.pdf' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: c.swap }));
    expect(within(table).getByRole('columnheader', { name: 'A · nieuw.pdf' })).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'B · oud.pdf' })).toBeTruthy();
    expect(table.querySelector('del')!.textContent).toBe('550');
    // Nu staat de vervallen alinea alleen in B: toegevoegd.
    expect(screen.getByText('1 toegevoegd')).toBeTruthy();
  });

  it('meldt dat alleen de eerste twee tellen als je er meer kiest', async () => {
    setup();
    choose('b', 'oud.pdf', 'nieuw.pdf', 'kopie.pdf');
    await screen.findByRole('table');
    expect(screen.getByText(c.tooMany)).toBeTruthy();
    expect(vi.mocked(readPdf).mock.calls.map(([file]) => file.name)).toEqual([
      'oud.pdf',
      'nieuw.pdf',
    ]);
  });

  it('zegt het als er geen tekstverschillen zijn', async () => {
    setup();
    choose('a', 'oud.pdf', 'kopie.pdf');
    await screen.findByText(c.noDiff);
    expect(screen.getByText(c.noDiffNote)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('0 gewijzigd')).toBeTruthy();
  });

  it('waarschuwt voor pagina’s zonder tekstlaag', async () => {
    setup();
    choose('a', 'scan.pdf', 'oud.pdf');
    await screen.findByRole('table');
    expect(within(slot('a')).getByText(/· 1 pagina zonder tekstlaag$/)).toBeTruthy();
    expect(
      screen.getByText(format(c.noTextWarning, { list: '1 van 2 in A' }), { exact: false }),
    ).toBeTruthy();
    expect(screen.queryByText(c.noTextAll, { exact: false })).toBeNull();
  });

  it('meldt een PDF met een wachtwoord of een kapotte PDF in het vak zelf', async () => {
    setup();
    choose('a', 'geheim.pdf');
    expect((await within(slot('a')).findByRole('alert')).textContent).toBe(c.errors.password);
    choose('b', 'kapot.pdf');
    expect((await within(slot('b')).findByRole('alert')).textContent).toBe(c.errors.damaged);
    expect(screen.getByText(c.placeholder)).toBeTruthy();
  });

  it('een later gekozen PDF wint van een die nog gelezen wordt', async () => {
    setup();
    let release!: () => void;
    gates['oud.pdf'] = new Promise((resolve) => (release = resolve));
    choose('a', 'oud.pdf');
    await within(slot('a')).findByText(format(c.reading, { n: 0, total: 1 }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: c.swap }).disabled).toBe(true);
    choose('a', 'kopie.pdf');
    await within(slot('a')).findByText('kopie.pdf');
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(within(slot('a')).getByText('kopie.pdf')).toBeTruthy();
    expect(within(slot('a')).queryByText('oud.pdf')).toBeNull();
  });

  it('ook een PDF die na een later gekozen PDF alsnog mislukt, telt niet meer', async () => {
    setup();
    let release!: () => void;
    gates['kapot.pdf'] = new Promise((resolve) => (release = resolve));
    choose('a', 'kapot.pdf');
    await within(slot('a')).findByText(c.readingStart);
    choose('a', 'kopie.pdf');
    await within(slot('a')).findByText(/^1 pagina · /);
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(within(slot('a')).queryByRole('alert')).toBeNull();
    expect(within(slot('a')).getByText('kopie.pdf')).toBeTruthy();
  });

  it('waarschuwt als de documenten te groot waren voor een volledige vergelijking', async () => {
    const real = vi.mocked(compareTexts).getMockImplementation()!;
    vi.mocked(compareTexts).mockImplementationOnce((...args) => ({
      ...real(...args),
      fallback: true,
    }));
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await screen.findByRole('table');
    expect(screen.getByText(c.fallback)).toBeTruthy();
  });

  it('Wissen haalt beide documenten weg', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: c.clear }));
    expect(screen.getByText(c.placeholder)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(within(slot('a')).getByText(c.sides.a.choose)).toBeTruthy();
  });
});
