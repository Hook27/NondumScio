// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { PdfLoadError } from '../pdf/loader';
import { downloadFile } from '../pdf/save';
import { CompareTool } from './CompareTool';
import { compareTexts } from './diff';
import type { PageText, Piece } from './layout';
import type { DocInfo } from './profile';
import { readPdf } from './readPdf';
import { resetCompareState } from './store';
import { closeVisual, composeDiff, composeOverlay, renderPage } from './visual';

/**
 * Een pagina met alinea's van elk twee regels (de woorden half om half, of de regels zoals
 * gegeven), met een witregel ertussen; met `head` ook een kop bovenaan, ver van de tekst.
 */
function page(no: number, paragraphs: (string | string[])[], head?: string): PageText {
  const items: Piece[] = [];
  if (head) items.push({ str: head, x: 50, y: 800, fh: 10, w: head.length * 5 });
  let y = 760;
  for (const paragraph of paragraphs) {
    const words = typeof paragraph === 'string' ? paragraph.split(' ') : [];
    const half = Math.ceil(words.length / 2);
    const lines =
      typeof paragraph === 'string'
        ? [words.slice(0, half).join(' '), words.slice(half).join(' ')]
        : paragraph;
    for (const str of lines) {
      if (!str) continue;
      items.push({ str, x: 50, y, fh: 10, w: str.length * 5 });
      y -= 12;
    }
    y -= 24;
  }
  return { no, w: 595, h: 842, items, chars: items.reduce((n, i) => n + i.str.length, 0) };
}

/** Een pagina zoals Word hem maakt: 11 pt, regelafstand 14,5 pt, 8 pt witruimte na een alinea. */
function wordPage(paragraphs: string[][]): PageText {
  const items: Piece[] = [];
  let y = 760;
  for (const lines of paragraphs) {
    for (const str of lines) {
      items.push({ str, x: 71, y, fh: 11, w: str.length * 5.5 });
      y -= 14.5;
    }
    y -= 22.4 - 14.5;
  }
  return { no: 1, w: 595, h: 842, items, chars: items.reduce((n, i) => n + i.str.length, 0) };
}

/** Een pagina met twee kolommen van zes regels, met een brede goot ertussen. */
function twoColumns(): PageText {
  const items: Piece[] = [];
  for (let i = 0; i < 6; i++) {
    for (const [x, str] of [
      [50, `links regel ${i + 1}`],
      [320, `rechts regel ${i + 1}`],
    ] as const) {
      items.push({ str, x, y: 760 - i * 12, fh: 10, w: str.length * 5 });
    }
  }
  return { no: 1, w: 595, h: 842, items, chars: items.reduce((n, i) => n + i.str.length, 0) };
}

const WORD = [
  ['De eerste alinea loopt over twee regels', 'en stopt hier.'],
  ['De tweede alinea staat eronder, met', 'een witregel van 8 pt ertussen.'],
  ['De derde alinea.'],
];

const SAME = Array.from({ length: 6 }, (_, i) => `Ongewijzigde alinea nummer ${i + 1}.`);

/** Wat er per bestand "gelezen" wordt: de pagina's (of een fout). */
const DOCS: Record<string, PageText[] | Error> = {
  'oud.pdf': [page(1, [...SAME, 'De huur is 500 euro per maand.', 'Deze alinea vervalt straks.'])],
  'nieuw.pdf': [page(1, [...SAME, 'De huur is 550 euro per maand.'])],
  // Even lange naam als oud.pdf (dus even groot), met dezelfde inhoud: alleen de naam verschilt.
  'odu.pdf': [page(1, [...SAME, 'De huur is 500 euro per maand.', 'Deze alinea vervalt straks.'])],
  'kopie.pdf': [
    page(1, [...SAME, 'De huur is 500 euro per maand.', 'Deze alinea vervalt straks.']),
  ],
  'scan.pdf': [page(1, []), page(2, ['Alleen hier tekst.'])],
  'word-a.pdf': [wordPage(WORD)],
  'word-b.pdf': [wordPage([WORD[0]!, [WORD[1]![0]!, 'een witregel van 6 pt ertussen.'], WORD[2]!])],
  'kop-a.pdf': [1, 2].map((no) => page(no, ['Gewone tekst op de pagina.'], 'Rapport 2026')),
  'kop-b.pdf': [1, 2].map((no) => page(no, ['Gewone tekst op de pagina.'], 'Concept 2027')),
  'hoofd-a.pdf': [page(1, ['Het Contract is getekend.'])],
  'hoofd-b.pdf': [page(1, ['het contract is getekend.'])],
  'afbreek-a.pdf': [page(1, [['Dit is een verge-', 'lijking van twee teksten.']])],
  'afbreek-b.pdf': [page(1, [['Dit is een vergelijking', 'van twee teksten.']])],
  'kolommen.pdf': [twoColumns()],
  'geheim.pdf': new PdfLoadError('password'),
  'kapot.pdf': new Error('kapot'),
};

/** De gegevens uit het document (metadata), per bestand; anders leeg. */
const INFO: Record<string, DocInfo> = {
  'oud.pdf': {
    PDFFormatVersion: '1.7',
    Title: 'Huur',
    Author: 'Jansen',
    CreationDate: 'D:20260101',
  },
  'nieuw.pdf': { PDFFormatVersion: '1.7', Title: 'Huur', CreationDate: 'D:20260301' },
  'odu.pdf': {
    PDFFormatVersion: '1.7',
    Title: 'Huur',
    Author: 'Jansen',
    CreationDate: 'D:20260101',
  },
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
    return { pageCount: pages.length, pages, info: INFO[file.name] ?? {}, thumb: null };
  }),
}));

/** Een leeg canvas met een maat (jsdom kan niet echt tekenen). */
function blank(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// Het tekenen nagebootst: een pagina is een leeg canvas van A4-verhouding, of null als hij niet
// bestaat; het pixelverschil telt vaste aantallen. De rekenregels (zoom, breedtes) blijven echt.
vi.mock('./visual', async (importOriginal) => {
  const real = await importOriginal<typeof import('./visual')>();
  return {
    ...real,
    renderPage: vi.fn(async (file: File, page: number, width: number) => {
      const pages = DOCS[file.name];
      if (!Array.isArray(pages) || page < 1 || page > pages.length) return null;
      return blank(width, Math.round(width * 1.414));
    }),
    composeDiff: vi.fn((a: HTMLCanvasElement) => ({
      canvas: blank(a.width, a.height),
      diff: 1234,
      ink: 5000,
      total: 100_000,
    })),
    composeOverlay: vi.fn((a: HTMLCanvasElement) => blank(a.width, a.height)),
    closeVisual: vi.fn(),
  };
});

// Downloaden: alleen onthouden wat er gedownload zou worden.
vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  downloadFile: vi.fn(),
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
  vi.mocked(downloadFile).mockClear();
  for (const mock of [renderPage, composeDiff, composeOverlay, closeVisual])
    vi.mocked(mock).mockClear();
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
    // Per alinea vergeleken: geen tip om per alinea te vergelijken.
    expect(screen.getByText(c.fallback)).toBeTruthy();
  });

  it('geeft bij een te grote vergelijking per zin de tip om per alinea te vergelijken', async () => {
    const real = vi.mocked(compareTexts).getMockImplementation()!;
    setup();
    fireEvent.click(screen.getByRole('button', { name: c.levels.sentence.label }));
    vi.mocked(compareTexts).mockImplementationOnce((...args) => ({
      ...real(...args),
      fallback: true,
    }));
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await screen.findByRole('table');
    expect(screen.getByText(`${c.fallback} ${c.fallbackTip}`)).toBeTruthy();
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

describe('instellingen', () => {
  const s = c.settings;
  const checkbox = (name: string) => screen.getByRole<HTMLInputElement>('checkbox', { name });
  const level = (name: string) => screen.getByRole('button', { name });
  const slider = () => screen.getByRole<HTMLInputElement>('slider', { name: s.gap });
  const summary = (a: string, b: string) => screen.findByText(`A: ${a} · B: ${b}`);

  it('staan klaar met de standaardwaarden', () => {
    setup();
    expect(screen.getByRole('group', { name: s.title })).toBeTruthy();
    expect(level(c.levels.paragraph.label).getAttribute('aria-pressed')).toBe('true');
    expect(level(c.levels.sentence.label).getAttribute('aria-pressed')).toBe('false');
    expect(slider().value).toBe('1.3');
    expect(screen.getByText('1,3')).toBeTruthy();
    expect(checkbox(s.ignoreCase).checked).toBe(false);
    for (const name of [s.strip, s.columns, s.dehyphen, s.onlyDiff]) {
      expect(checkbox(name).checked, name).toBe(true);
    }
  });

  it('vergelijkt per zin of per regel, met de bijpassende teksten', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await summary('1 pagina, 8 alinea’s', '1 pagina, 7 alinea’s');
    fireEvent.click(level(c.levels.sentence.label));
    await summary('1 pagina, 8 zinnen', '1 pagina, 7 zinnen');
    expect(level(c.levels.sentence.label).getAttribute('aria-pressed')).toBe('true');
    expect(slider().disabled).toBe(false);
    fireEvent.click(level(c.levels.line.label));
    await summary('1 pagina, 16 regels', '1 pagina, 14 regels');
    expect(screen.getByRole('button', { name: /ongewijzigde regels tonen$/ })).toBeTruthy();
    // De alinea-gevoeligheid doet niets bij regels.
    expect(slider().disabled).toBe(true);
  });

  it('alinea-gevoeligheid: Word-alinea’s standaard herkend; opnieuw vergelijken pas bij loslaten', async () => {
    setup();
    choose('a', 'word-a.pdf', 'word-b.pdf');
    await summary('1 pagina, 3 alinea’s', '1 pagina, 3 alinea’s');
    // Alleen de gewijzigde alinea is geel, niet de hele pagina.
    expect(screen.getByText('1 gewijzigd')).toBeTruthy();
    expect(screen.getByRole('table').querySelector('del')!.textContent).toBe('8');
    fireEvent.input(slider(), { target: { value: '1.6' } });
    expect(screen.getByText('1,6')).toBeTruthy();
    expect(screen.getByText('A: 1 pagina, 3 alinea’s · B: 1 pagina, 3 alinea’s')).toBeTruthy();
    fireEvent.change(slider(), { target: { value: '1.6' } });
    await summary('1 pagina, 1 alinea', '1 pagina, 1 alinea');
    expect(slider().value).toBe('1.6');
  });

  it('hoofdletters negeren', async () => {
    setup();
    choose('a', 'hoofd-a.pdf', 'hoofd-b.pdf');
    await screen.findByText('1 gewijzigd');
    fireEvent.click(checkbox(s.ignoreCase));
    await screen.findByText(c.noDiff);
  });

  it('terugkerende kop- en voetteksten weglaten (aan) of meetellen (uit)', async () => {
    setup();
    choose('a', 'kop-a.pdf', 'kop-b.pdf');
    await screen.findByText(c.noDiff);
    fireEvent.click(checkbox(s.strip));
    await screen.findByText('2 gewijzigd');
    expect(screen.getAllByText('Rapport 2026')).toHaveLength(2);
  });

  it('afgebroken woorden herstellen (aan) of laten staan (uit)', async () => {
    setup();
    choose('a', 'afbreek-a.pdf', 'afbreek-b.pdf');
    await screen.findByText(c.noDiff);
    fireEvent.click(checkbox(s.dehyphen));
    await screen.findByText('1 gewijzigd');
  });

  it('alleen verschillen tonen uit: alle stukken, zonder inklapknop', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('button')).toBeTruthy();
    fireEvent.click(checkbox(s.onlyDiff));
    expect(within(table).queryByRole('button')).toBeNull();
    expect(within(table).getAllByText('Ongewijzigde alinea nummer 1.')).toHaveLength(2);
  });

  it('weer aan: wat je had opengeklikt, klapt weer in', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    const table = await screen.findByRole('table');
    fireEvent.click(within(table).getByRole('button'));
    expect(within(table).queryByRole('button')).toBeNull();
    fireEvent.click(checkbox(s.onlyDiff));
    fireEvent.click(checkbox(s.onlyDiff));
    expect(
      within(table).getByRole('button', { name: '5 ongewijzigde alinea’s tonen' }),
    ).toBeTruthy();
  });

  it('twee kolommen herkennen (aan: na elkaar) of niet (uit: regel voor regel door elkaar)', async () => {
    setup();
    choose('a', 'kolommen.pdf', 'kolommen.pdf');
    await summary('1 pagina, 2 alinea’s', '1 pagina, 2 alinea’s');
    fireEvent.click(checkbox(s.columns));
    await summary('1 pagina, 1 alinea', '1 pagina, 1 alinea');
  });

  it('blijven staan bij Wissen', async () => {
    setup();
    fireEvent.click(level(c.levels.line.label));
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: c.clear }));
    expect(level(c.levels.line.label).getAttribute('aria-pressed')).toBe('true');
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await summary('1 pagina, 16 regels', '1 pagina, 14 regels');
  });
});

describe('onder elkaar', () => {
  const v = c.views;
  const view = (name: string) => screen.getByRole('button', { name });

  it('alleen te kiezen als er verschillen zijn; standaard naast elkaar', async () => {
    setup();
    choose('a', 'oud.pdf', 'kopie.pdf');
    await screen.findByText(c.noDiff);
    expect(screen.queryByRole('group', { name: v.label })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: c.clear }));
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await screen.findByRole('table');
    expect(screen.getByRole('group', { name: v.label })).toBeTruthy();
    expect(view(v.split).getAttribute('aria-pressed')).toBe('true');
    expect(view(v.unified).getAttribute('aria-pressed')).toBe('false');
  });

  it('één kolom: gewijzigd als − (A) boven + (B), met de woorden; verwijderd met −', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    const table = await screen.findByRole('table');
    fireEvent.click(view(v.unified));
    expect(view(v.unified).getAttribute('aria-pressed')).toBe('true');
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((th) => th.textContent)).toEqual(['A · oud.pdf → B · nieuw.pdf']);

    const minus = table.querySelector('del')!.closest('tr')!;
    const plus = table.querySelector('ins')!.closest('tr')!;
    expect(table.querySelector('del')!.textContent).toBe('500');
    expect(table.querySelector('ins')!.textContent).toBe('550');
    expect(minus.nextElementSibling).toBe(plus);
    expect(minus.classList.contains('compare-diff__row--removed')).toBe(true);
    expect(plus.classList.contains('compare-diff__row--added')).toBe(true);
    expect(minus.querySelector('.compare-diff__sign')!.textContent).toBe('−');
    expect(plus.querySelector('.compare-diff__sign')!.textContent).toBe('+');
    // Voor schermlezers: de soort, niet het teken.
    expect(within(minus).getByText('Verwijderd:', { exact: false })).toBeTruthy();
    expect(within(plus).getByText('Toegevoegd:', { exact: false })).toBeTruthy();

    const removed = within(table).getByText('Deze alinea vervalt straks.').closest('tr')!;
    expect(removed.classList.contains('compare-diff__row--removed')).toBe(true);
    expect(removed.querySelectorAll('td')).toHaveLength(1);
    expect(removed.querySelector('.compare-diff__sign')!.textContent).toBe('−');
    // Een gelijk stuk staat er één keer, zonder teken.
    const same = within(table).getByText('Ongewijzigde alinea nummer 6.').closest('tr')!;
    expect(same.querySelector('.compare-diff__sign')!.textContent).toBe(' ');
    expect(within(table).getAllByText('Ongewijzigde alinea nummer 6.')).toHaveLength(1);
  });

  it('ook onder elkaar klappen ongewijzigde stukken in, en gaat de focus mee bij openklikken', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    const table = await screen.findByRole('table');
    fireEvent.click(view(v.unified));
    const expand = within(table).getByRole('button', { name: '5 ongewijzigde alinea’s tonen' });
    expect(expand.closest('td')!.colSpan).toBe(1);
    fireEvent.click(expand);
    const first = within(table).getByText('Ongewijzigde alinea nummer 1.').closest('tr');
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it('blijft staan bij Wissen, en terug naar naast elkaar', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await screen.findByRole('table');
    fireEvent.click(view(v.unified));
    fireEvent.click(screen.getByRole('button', { name: c.clear }));
    choose('a', 'oud.pdf', 'nieuw.pdf');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(1);
    fireEvent.click(view(v.split));
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2);
    expect(table.querySelector('.compare-diff__sign')).toBeNull();
  });
});

describe('documentprofiel', () => {
  const p = c.profile;
  const tab = (name: string) => screen.getByRole('button', { name });

  it('de schakelaar staat op Tekst; Profiel zonder PDF’s zegt wat er nodig is', () => {
    setup();
    expect(screen.getByRole('group', { name: c.tabs.label })).toBeTruthy();
    expect(tab(c.tabs.text).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(tab(c.tabs.profile));
    expect(tab(c.tabs.profile).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: p.title })).toBeTruthy();
    expect(screen.getByText(p.placeholder)).toBeTruthy();
    // De instellingen horen bij de tekst.
    expect(screen.queryByRole('group', { name: c.settings.title })).toBeNull();
  });

  it('zet de velden van A en B naast elkaar, met ≠ bij wat verschilt', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await screen.findByRole('table');
    fireEvent.click(tab(c.tabs.profile));
    // Naam, grootte, auteur, aangemaakt en het aantal tekens.
    expect(screen.getByText('5 van 16 velden wijken af')).toBeTruthy();
    const fields = screen.getByRole('table', { name: p.fieldsCaption });
    const row = (field: string) => within(fields).getByText(field).closest('tr')!;
    expect(within(fields).getByRole('columnheader', { name: 'A · oud.pdf' })).toBeTruthy();
    expect(within(fields).getAllByRole('row')).toHaveLength(17);
    // Verschillend: geel, met ≠ en voor schermlezers "wijkt af".
    const author = row(p.fields.author);
    expect(author.classList.contains('compare-profile__differs')).toBe(true);
    expect(within(author).getByText('≠')).toBeTruthy();
    expect(within(author).getByText(`(${p.differs})`, { exact: false })).toBeTruthy();
    expect(within(author).getByText('Jansen')).toBeTruthy();
    expect(within(author).getByText(p.empty)).toBeTruthy();
    expect(within(row(p.fields.created)).getByText('1 januari 2026')).toBeTruthy();
    expect(within(row(p.fields.created)).getByText('1 maart 2026')).toBeTruthy();
    // Gelijk: geen markering.
    const title = row(p.fields.title);
    expect(title.classList.contains('compare-profile__differs')).toBe(false);
    expect(within(title).queryByText('≠')).toBeNull();
    expect(within(row(p.fields.encrypted)).getAllByText(p.no)).toHaveLength(2);
  });

  it('één veld dat verschilt: enkelvoud', async () => {
    setup();
    choose('a', 'oud.pdf', 'odu.pdf');
    await screen.findByText(c.noDiff);
    fireEvent.click(tab(c.tabs.profile));
    expect(screen.getByText('1 van 16 velden wijkt af')).toBeTruthy();
  });

  it('per pagina: formaat, tekens en wat opvalt', async () => {
    setup();
    choose('a', 'scan.pdf', 'oud.pdf');
    await screen.findByRole('table');
    fireEvent.click(tab(c.tabs.profile));
    const pages = screen.getByRole('table', { name: p.pagesCaption });
    const rows = within(pages).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText(p.notes.noTextA)).toBeTruthy();
    expect(within(rows[0]!).getAllByText('595×842')).toHaveLength(2);
    expect(within(rows[0]!).getByText('0')).toBeTruthy();
    expect(within(rows[1]!).getByText(p.notes.onlyA)).toBeTruthy();
    expect(within(rows[1]!).getAllByText('—')).toHaveLength(2);
    expect(rows.every((r) => r.classList.contains('compare-profile__differs'))).toBe(true);
  });

  it('meldt een duidelijk verschil in tekens met + of −', async () => {
    setup();
    choose('a', 'oud.pdf', 'scan.pdf');
    await screen.findByRole('table');
    fireEvent.click(tab(c.tabs.profile));
    const pages = screen.getByRole('table', { name: p.pagesCaption });
    expect(within(pages).getByText(p.notes.noTextB)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: c.clear }));
    fireEvent.click(tab(c.tabs.profile));
    choose('a', 'oud.pdf', 'nieuw.pdf');
    const table = await screen.findByRole('table', { name: p.pagesCaption });
    // oud.pdf heeft een alinea meer: 26 tekens (meer dan 20 en meer dan 10 %).
    expect(within(table).getByText(format(p.notes.chars, { n: '−26' }))).toBeTruthy();
  });

  it('terug naar Tekst toont de tellers en instellingen weer; Wissen gaat terug naar Tekst', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await screen.findByRole('table');
    fireEvent.click(tab(c.tabs.profile));
    expect(screen.queryByText('1 gewijzigd')).toBeNull();
    fireEvent.click(tab(c.tabs.text));
    expect(screen.getByText('1 gewijzigd')).toBeTruthy();
    expect(screen.getByRole('group', { name: c.settings.title })).toBeTruthy();
    fireEvent.click(tab(c.tabs.profile));
    fireEvent.click(screen.getByRole('button', { name: c.clear }));
    expect(tab(c.tabs.text).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('heading', { name: c.textTitle })).toBeTruthy();
  });
});

describe('beeld', () => {
  const v = c.visual;
  const button = (name: string) => screen.getByRole('button', { name });
  const mode = (name: string) =>
    within(screen.getByRole('group', { name: v.modes.label })).getByRole('button', { name });
  /** Opent twee PDF's en gaat naar Beeld; wacht tot er getekend is. */
  async function openVisual(a: string, b: string) {
    setup();
    choose('a', a, b);
    await screen.findByText(/^A: \d+ pagina/);
    fireEvent.click(button(c.tabs.visual));
    await screen.findByText(/^(Verschil|Pagina \d+ bestaat)/);
  }

  it('zonder PDF’s: zegt wat er nodig is, en bladeren kan nog niet', () => {
    setup();
    fireEvent.click(button(c.tabs.visual));
    expect(screen.getByRole('heading', { name: v.title })).toBeTruthy();
    expect(screen.getByText(v.placeholder)).toBeTruthy();
    expect(screen.getByText(v.noPages)).toBeTruthy();
    expect(button(v.previous).hasAttribute('disabled')).toBe(true);
    expect(button(v.next).hasAttribute('disabled')).toBe(true);
    // De instellingen en tellers horen bij de tekst.
    expect(screen.queryByRole('group', { name: c.settings.title })).toBeNull();
  });

  it('tekent het verschil van pagina 1, met de tellingen, de legenda en een beschrijving', async () => {
    await openVisual('oud.pdf', 'nieuw.pdf');
    expect(
      screen.getByText('Verschil: 1,23% van de pagina · 24,7% van de inkt · 1.234 px'),
    ).toBeTruthy();
    expect(screen.getByText('A: pagina 1 · B: pagina 1')).toBeTruthy();
    expect(screen.getByRole('img', { name: format(v.labels.diff, { a: 1, b: 1 }) })).toBeTruthy();
    expect(screen.getByText(v.legend.a)).toBeTruthy();
    // Passend in een vak van (bij gebrek aan meting) 940 breed, op 1× pixeldichtheid.
    expect(
      vi.mocked(renderPage).mock.calls.map(([file, page, width]) => [file.name, page, width]),
    ).toEqual([
      ['oud.pdf', 1, 940],
      ['nieuw.pdf', 1, 940],
    ]);
    expect(vi.mocked(composeDiff).mock.calls[0]![2]).toBe(30);
  });

  it('een andere drempel rekent opnieuw, zonder de pagina’s opnieuw te tekenen', async () => {
    await openVisual('oud.pdf', 'nieuw.pdf');
    fireEvent.input(screen.getByRole('slider', { name: v.threshold }), { target: { value: '60' } });
    await waitFor(() => expect(vi.mocked(composeDiff).mock.lastCall![2]).toBe(60));
    expect(screen.getByText('60')).toBeTruthy();
    expect(renderPage).toHaveBeenCalledTimes(2);
  });

  it('naast elkaar en overlay', async () => {
    await openVisual('oud.pdf', 'nieuw.pdf');
    fireEvent.click(mode(v.modes.side));
    await screen.findByText('A: 462×653 px · B: 462×653 px');
    expect(screen.getByRole('img', { name: format(v.labels.a, { n: 1 }) })).toBeTruthy();
    expect(screen.getByRole('img', { name: format(v.labels.b, { n: 1 }) })).toBeTruthy();
    expect(screen.queryByText(v.legend.a)).toBeNull();
    expect(screen.queryByRole('slider', { name: v.threshold })).toBeNull();

    fireEvent.click(mode(v.modes.overlay));
    await screen.findByText('Overlay: B voor 50% over A');
    expect(mode(v.modes.overlay).getAttribute('aria-pressed')).toBe('true');
    fireEvent.input(screen.getByRole('slider', { name: v.alpha }), { target: { value: '80' } });
    await screen.findByText('Overlay: B voor 80% over A');
    expect(vi.mocked(composeOverlay).mock.lastCall![2]).toBe(0.8);
    expect(screen.getByText('80%')).toBeTruthy();
  });

  it('bladeren, en een pagina die in B niet bestaat', async () => {
    await openVisual('scan.pdf', 'oud.pdf');
    expect(screen.getByText(format(v.page, { n: 1, total: 2 }))).toBeTruthy();
    expect(button(v.previous).hasAttribute('disabled')).toBe(true);
    fireEvent.click(button(v.next));
    await screen.findByText('Pagina 2 bestaat niet in B (B heeft 1 pagina).');
    expect(screen.getByText(format(v.page, { n: 2, total: 2 }))).toBeTruthy();
    expect(button(v.next).hasAttribute('disabled')).toBe(true);
    fireEvent.click(button(v.previous));
    await screen.findByText(/^Verschil: /);
  });

  it('B verschuiven: pagina 1 van A naast pagina 2 van B', async () => {
    await openVisual('oud.pdf', 'scan.pdf');
    fireEvent.change(screen.getByRole('spinbutton', { name: v.offset }), {
      target: { value: '1' },
    });
    await screen.findByText('A: pagina 1 · B: pagina 2');
    await waitFor(() =>
      expect(vi.mocked(renderPage).mock.lastCall!.slice(0, 2)).toEqual([
        expect.objectContaining({ name: 'scan.pdf' }),
        2,
      ]),
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: v.offset }), {
      target: { value: '5' },
    });
    await screen.findByText('Pagina 6 bestaat niet in B (B heeft 2 pagina’s).');
    fireEvent.change(screen.getByRole('spinbutton', { name: v.offset }), {
      target: { value: 'x' },
    });
    await screen.findByText('A: pagina 1 · B: pagina 1');
  });

  it('zoomen tekent op een andere breedte; Passend gaat terug', async () => {
    await openVisual('oud.pdf', 'nieuw.pdf');
    expect(button(v.fit).hasAttribute('disabled')).toBe(true);
    fireEvent.click(button(v.zoomIn));
    expect(screen.getByText('125%')).toBeTruthy();
    await waitFor(() => expect(vi.mocked(renderPage).mock.lastCall![2]).toBe(1175));
    fireEvent.click(button(v.fit));
    expect(screen.getByText('100%')).toBeTruthy();
    for (let i = 0; i < 3; i++) fireEvent.click(button(v.zoomOut));
    expect(screen.getByText('50%')).toBeTruthy();
    expect(button(v.zoomOut).hasAttribute('disabled')).toBe(true);
  });

  it('toetsen: ← → bladeren, + − zoomen, 0 passend; niet in een invoerveld en niet met Ctrl', async () => {
    await openVisual('scan.pdf', 'oud.pdf');
    const key = (k: string, target: Element = document.body, init: KeyboardEventInit = {}) =>
      fireEvent.keyDown(target, { key: k, ...init });
    key('ArrowRight');
    expect(screen.getByText(format(v.page, { n: 2, total: 2 }))).toBeTruthy();
    key('ArrowRight');
    expect(screen.getByText(format(v.page, { n: 2, total: 2 }))).toBeTruthy();
    key('ArrowLeft');
    expect(screen.getByText(format(v.page, { n: 1, total: 2 }))).toBeTruthy();
    key('+');
    expect(screen.getByText('125%')).toBeTruthy();
    key('=', document.body, { ctrlKey: true });
    expect(screen.getByText('125%')).toBeTruthy();
    key('-');
    key('-');
    expect(screen.getByText('75%')).toBeTruthy();
    key('0');
    expect(screen.getByText('100%')).toBeTruthy();
    key('ArrowRight', screen.getByRole('spinbutton', { name: v.offset }));
    expect(screen.getByText(format(v.page, { n: 1, total: 2 }))).toBeTruthy();
  });

  it('meldt het als een pagina niet getekend kon worden', async () => {
    vi.mocked(renderPage).mockRejectedValueOnce(new Error('kapot'));
    await openVisual('oud.pdf', 'nieuw.pdf').catch(() => undefined);
    await screen.findByText(v.error);
  });

  it('Wissen: terug naar Tekst, pagina 1, geen verschuiving, passend; de PDF’s gaan dicht', async () => {
    await openVisual('scan.pdf', 'oud.pdf');
    fireEvent.click(button(v.next));
    fireEvent.change(screen.getByRole('spinbutton', { name: v.offset }), {
      target: { value: '1' },
    });
    fireEvent.click(button(v.zoomIn));
    fireEvent.click(mode(v.modes.overlay));
    fireEvent.click(button(c.clear));
    expect(
      vi
        .mocked(closeVisual)
        .mock.calls.map(([file]) => file.name)
        .sort(),
    ).toEqual(['oud.pdf', 'scan.pdf']);
    expect(button(c.tabs.text).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button(c.tabs.visual));
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: v.offset }).value).toBe('0');
    expect(screen.getByText('100%')).toBeTruthy();
    // De weergave blijft staan, zoals de instellingen bij de tekst.
    choose('a', 'scan.pdf', 'oud.pdf');
    await screen.findByText(format(v.page, { n: 1, total: 2 }));
    expect(mode(v.modes.overlay).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('rapport', () => {
  const r = c.report;
  const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
    Reflect.deleteProperty(document, 'execCommand');
  });

  it('kan pas als A en B vergeleken zijn', async () => {
    setup();
    expect(button(r.copy).disabled).toBe(true);
    expect(button(r.download).disabled).toBe(true);
    choose('a', 'oud.pdf');
    await screen.findByText(format(c.waitingFor, { side: 'B' }));
    expect(button(r.copy).disabled).toBe(true);
    choose('b', 'nieuw.pdf');
    await screen.findByRole('table');
    expect(button(r.copy).disabled).toBe(false);
    expect(button(r.download).disabled).toBe(false);
  });

  it('kopiëren zet het rapport op het klembord, met profiel en tekstverschillen', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await screen.findByRole('table');
    fireEvent.click(button(r.copy));
    await screen.findByText(r.copied);
    const text = writeText.mock.calls[0]![0];
    expect(text.startsWith('PDF-VERGELIJKING\nGemaakt: ')).toBe(true);
    expect(text).toContain('A: oud.pdf (1 pagina, ');
    expect(text).toContain('≠ Bestandsnaam:\n    A: oud.pdf\n    B: nieuw.pdf');
    expect(text).toContain('0 toegevoegd, 1 verwijderd, 1 gewijzigd');
    expect(text).toContain(
      '- De huur is 500 euro per maand.\n+ De huur is 550 euro per maand.\n- Deze alinea vervalt straks.',
    );
  });

  it('lukt het klembord niet, dan de oude manier; lukt ook die niet, dan een melding', async () => {
    writeText.mockRejectedValue(new Error('geen toestemming'));
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await screen.findByRole('table');
    fireEvent.click(button(r.copy));
    await screen.findByText(r.copied);
    expect(execCommand).toHaveBeenCalledWith('copy');
    // Het hulpveld is weer weg.
    expect(document.querySelector('textarea')).toBeNull();
    execCommand.mockReturnValue(false);
    fireEvent.click(button(r.copy));
    await screen.findByText(r.copyFailed);
  });

  it('downloaden geeft een tekstbestand met datum en tijd in de naam', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await screen.findByRole('table');
    fireEvent.click(button(c.tabs.profile));
    fireEvent.click(button(r.download));
    const [data, name, type] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(name).toMatch(/^pdf-vergelijking_\d{8}_\d{4}\.txt$/);
    expect(type).toBe('text/plain;charset=utf-8');
    const text = new TextDecoder().decode(data as Uint8Array);
    expect(text).toContain('=== DOCUMENTPROFIEL ===');
    expect(text).toContain('@@ A pagina 1 | B pagina 1 @@');
    expect(screen.getByText(format(r.downloaded, { name }))).toBeTruthy();
  });

  it('volgt de instellingen, en de melding verdwijnt bij een nieuwe vergelijking', async () => {
    setup();
    choose('a', 'oud.pdf', 'nieuw.pdf');
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: c.levels.line.label }));
    fireEvent.click(button(r.copy));
    await screen.findByText(r.copied);
    expect(writeText.mock.calls[0]![0]).toContain('Instellingen: per regel, ');
    fireEvent.click(screen.getByRole('button', { name: c.levels.sentence.label }));
    await waitFor(() => expect(screen.queryByText(r.copied)).toBeNull());
  });
});
