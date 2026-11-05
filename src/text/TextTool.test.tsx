// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageText, Piece } from '../compare/layout';
import { readPdf } from '../compare/readPdf';
import { copyText } from '../compare/report';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { PdfLoadError } from '../pdf/loader';
import { downloadFile } from '../pdf/save';
import { TextTool } from './TextTool';
import { resetTextState } from './store';

/**
 * Een pagina met alinea's (elk een lijst regels), met een witregel ertussen; met `head` ook een kop
 * bovenaan, ver van de tekst.
 */
function page(no: number, paragraphs: string[][], head?: string): PageText {
  const items: Piece[] = [];
  if (head) items.push({ str: head, x: 50, y: 800, fh: 10, w: head.length * 5 });
  let y = 740;
  for (const lines of paragraphs) {
    for (const str of lines) {
      items.push({ str, x: 50, y, fh: 10, w: str.length * 5 });
      y -= 12;
    }
    y -= 12;
  }
  return { no, w: 595, h: 842, items, chars: items.reduce((n, i) => n + i.str.length, 0) };
}

const empty = (no: number): PageText => ({ no, w: 595, h: 842, items: [], chars: 0 });

const LETTER = [
  ['Geachte heer Jansen,'],
  ['Hierbij ontvangt u de nieuwe', 'huurovereenkomst voor de woning.'],
  ['Met vriendelijke groet,'],
];

/** Wat er per bestand "gelezen" wordt: de pagina's (of een fout). */
const DOCS: Record<string, PageText[] | Error> = {
  'brief.pdf': [page(1, LETTER)],
  'rapport.pdf': [1, 2].map((no) =>
    page(
      no,
      [[`Tekst op pagina ${no} van het rapport.`], ['Nog een alinea hier.']],
      'Rapport 2026',
    ),
  ),
  'scan.pdf': [empty(1), page(2, [['Alleen hier staat een hele zin met tekst.']]), empty(3)],
  'kort.pdf': [page(1, [['Kort.']]), page(2, [['Een pagina met genoeg tekst erop.']])],
  'leeg.pdf': [empty(1), empty(2)],
  'tweede.pdf': [page(1, [['De tweede PDF.']])],
  'geheim.pdf': new PdfLoadError('password'),
  'kapot.pdf': new Error('kapot'),
};

/** Een "poortje" om het lezen van een bestand even vast te houden. */
const gates: Record<string, Promise<void>> = {};

vi.mock('../compare/readPdf', () => ({
  readPdf: vi.fn(async (file: File, onProgress?: (done: number, total: number) => void) => {
    const pages = DOCS[file.name]!;
    if (!(pages instanceof Error)) onProgress?.(0, pages.length);
    if (gates[file.name]) await gates[file.name];
    if (pages instanceof Error) throw pages;
    onProgress?.(pages.length, pages.length);
    return { pageCount: pages.length, pages, info: {}, thumb: null };
  }),
}));

vi.mock('../compare/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../compare/report')>()),
  copyText: vi.fn(async () => true),
}));

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
  downloadFile: vi.fn(),
}));

const p = messages.nl.plainText;
const c = messages.nl.compare;
const pdf = (name: string) => new File([`%PDF-1.7 ${name}`], name, { type: 'application/pdf' });

function setup() {
  render(
    <LanguageProvider initial="nl">
      <TextTool />
    </LanguageProvider>,
  );
}

function choose(...names: string[]) {
  fireEvent.change(document.querySelector('#plaintext-file')!, {
    target: { files: names.map(pdf) },
  });
}

const output = () => document.querySelector('pre.plaintext__output');
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const check = (name: string) => screen.getByRole<HTMLInputElement>('checkbox', { name });

afterEach(() => {
  cleanup();
  resetTextState();
  for (const name of Object.keys(gates)) delete gates[name];
  vi.mocked(readPdf).mockClear();
  vi.mocked(copyText).mockClear();
  vi.mocked(downloadFile).mockClear();
});

describe('PDF → Platte tekst', () => {
  it('begint leeg: een vak voor de PDF, en de knoppen staan uit', () => {
    setup();
    expect(screen.getByText(p.placeholder)).toBeTruthy();
    expect(screen.getByText(p.slot.choose)).toBeTruthy();
    for (const name of [p.copy, p.download, p.clear]) expect(button(name).disabled).toBe(true);
  });

  it('toont de tekst met alinea’s zodra de PDF gelezen is', async () => {
    setup();
    choose('brief.pdf');
    await waitFor(() => expect(output()).toBeTruthy());
    expect(output()!.textContent).toBe(
      'Geachte heer Jansen,\n\nHierbij ontvangt u de nieuwe huurovereenkomst voor de woning.\n\nMet vriendelijke groet,',
    );
    const chars = output()!.textContent!.length;
    expect(
      screen.getByText(
        `${chars} tekens · 1 van 1 pagina gelezen · gemiddeld ${chars} tekens per pagina`,
      ),
    ).toBeTruthy();
    expect(screen.getByText('brief.pdf')).toBeTruthy();
    expect(screen.getByText(p.slot.replace)).toBeTruthy();
    for (const name of [p.copy, p.download, p.clear]) expect(button(name).disabled).toBe(false);
  });

  it('meldt de voortgang tijdens het lezen', async () => {
    let open!: () => void;
    gates['brief.pdf'] = new Promise((resolve) => (open = resolve));
    setup();
    choose('brief.pdf');
    await waitFor(() =>
      expect(screen.getByText(format(c.reading, { n: 0, total: 1 }))).toBeTruthy(),
    );
    expect(output()).toBeNull();
    open();
    await waitFor(() => expect(output()).toBeTruthy());
  });

  it('bouwt de tekst meteen opnieuw op bij elke instelling', async () => {
    setup();
    choose('rapport.pdf');
    await waitFor(() => expect(output()).toBeTruthy());
    expect(output()!.textContent).not.toContain('Rapport 2026');

    fireEvent.click(check(p.settings.strip));
    expect(output()!.textContent).toContain('Rapport 2026');

    fireEvent.click(check(p.settings.joinLines));
    expect(output()!.textContent).toBe(
      [1, 2]
        .map((no) => `Rapport 2026\nTekst op pagina ${no} van het rapport.\nNog een alinea hier.`)
        .join('\n\n'),
    );
    // Zonder samenvoegen doet de gevoeligheid niets.
    expect(screen.getByRole<HTMLInputElement>('slider', { name: p.settings.gap }).disabled).toBe(
      true,
    );
  });

  it('de alinea-gevoeligheid: tijdens het slepen alleen het getal, bij loslaten de tekst', async () => {
    setup();
    choose('brief.pdf');
    await waitFor(() => expect(output()).toBeTruthy());
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: p.settings.gap });
    expect(slider.value).toBe('1.3');
    const before = output()!.textContent;

    // De witregels hier zijn 2 keer de regelafstand: bij 2,5 is het één alinea.
    fireEvent.input(slider, { target: { value: '2.5' } });
    expect(screen.getByText('2,5')).toBeTruthy();
    expect(output()!.textContent).toBe(before);
    fireEvent.change(slider, { target: { value: '2.5' } });
    expect(output()!.textContent).toBe(
      'Geachte heer Jansen, Hierbij ontvangt u de nieuwe huurovereenkomst voor de woning. Met vriendelijke groet,',
    );
  });

  it('noemt pagina’s zonder tekstlaag en met nauwelijks tekst', async () => {
    setup();
    choose('scan.pdf');
    await waitFor(() => expect(output()).toBeTruthy());
    expect(screen.getByText(format(p.noTextPages, { list: 'pagina’s 1 en 3' }))).toBeTruthy();
    expect(screen.getByText(/· 2 pagina’s zonder tekstlaag$/)).toBeTruthy();
    expect(screen.getByText(/^\d+ tekens · 1 van 3 pagina’s gelezen/)).toBeTruthy();

    choose('kort.pdf');
    await waitFor(() =>
      expect(screen.getByText(format(p.lowPages, { list: 'pagina 1' }))).toBeTruthy(),
    );
    expect(screen.queryByText(/Geen tekstlaag/)).toBeNull();
  });

  it('een PDF zonder enige tekst: een melding, en niets te kopiëren', async () => {
    setup();
    choose('leeg.pdf');
    await waitFor(() => expect(screen.getByText(p.empty)).toBeTruthy());
    expect(output()).toBeNull();
    expect(button(p.copy).disabled).toBe(true);
    expect(button(p.download).disabled).toBe(true);
    expect(button(p.clear).disabled).toBe(false);
  });

  it('kopieert de tekst; de melding verdwijnt bij een andere tekst', async () => {
    setup();
    choose('brief.pdf');
    await waitFor(() => expect(output()).toBeTruthy());
    fireEvent.click(button(p.copy));
    await waitFor(() => expect(screen.getByText(p.copied)).toBeTruthy());
    expect(copyText).toHaveBeenCalledWith(output()!.textContent);

    fireEvent.click(check(p.settings.dehyphen));
    expect(screen.queryByText(p.copied)).toBeNull();
  });

  it('meldt het als kopiëren niet lukt', async () => {
    vi.mocked(copyText).mockResolvedValueOnce(false);
    setup();
    choose('brief.pdf');
    await waitFor(() => expect(output()).toBeTruthy());
    fireEvent.click(button(p.copy));
    await waitFor(() => expect(screen.getByText(p.copyFailed)).toBeTruthy());
  });

  it('downloadt de tekst als <naam>_extract.txt', async () => {
    setup();
    choose('brief.pdf');
    await waitFor(() => expect(output()).toBeTruthy());
    fireEvent.click(button(p.download));
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [data, name, type] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(name).toBe('brief_extract.txt');
    expect(type).toBe('text/plain;charset=utf-8');
    expect(new TextDecoder().decode(data as Uint8Array)).toBe(output()!.textContent);
    expect(screen.getByText(format(p.downloaded, { name: 'brief_extract.txt' }))).toBeTruthy();
  });

  it('meldt een PDF met een wachtwoord en een kapotte PDF', async () => {
    setup();
    choose('geheim.pdf');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(c.errors.password));
    choose('kapot.pdf');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(c.errors.damaged));
    expect(screen.getByText(p.placeholder)).toBeTruthy();
  });

  it('meer dan één PDF tegelijk: alleen de eerste, met een melding', async () => {
    setup();
    choose('brief.pdf', 'tweede.pdf');
    await waitFor(() => expect(output()).toBeTruthy());
    expect(screen.getByText(p.tooMany)).toBeTruthy();
    expect(readPdf).toHaveBeenCalledTimes(1);
    expect(output()!.textContent).toContain('Geachte heer Jansen');
  });

  it('een PDF die nog gelezen wordt, overschrijft een later gekozen PDF niet', async () => {
    let open!: () => void;
    gates['brief.pdf'] = new Promise((resolve) => (open = resolve));
    setup();
    choose('brief.pdf');
    choose('tweede.pdf');
    await waitFor(() => expect(output()?.textContent).toBe('De tweede PDF.'));
    open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(output()!.textContent).toBe('De tweede PDF.');
  });

  it('een PDF die nog gelezen wordt en dan mislukt, geeft geen melding bij een later gekozen PDF', async () => {
    let open!: () => void;
    gates['geheim.pdf'] = new Promise((resolve) => (open = resolve));
    setup();
    choose('geheim.pdf');
    choose('tweede.pdf');
    await waitFor(() => expect(output()?.textContent).toBe('De tweede PDF.'));
    open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(output()!.textContent).toBe('De tweede PDF.');
  });

  it('Wissen haalt de PDF weg; de instellingen blijven staan', async () => {
    setup();
    choose('brief.pdf', 'tweede.pdf');
    await waitFor(() => expect(output()).toBeTruthy());
    fireEvent.click(check(p.settings.columns));
    fireEvent.click(button(p.clear));
    expect(screen.getByText(p.placeholder)).toBeTruthy();
    expect(screen.queryByText(p.tooMany)).toBeNull();
    expect(button(p.clear).disabled).toBe(true);
    expect(check(p.settings.columns).checked).toBe(false);
    expect(within(document.querySelector('.compare-slot')!).getByText(p.slot.choose)).toBeTruthy();
  });

  it('Wissen tijdens het lezen: de PDF komt er niet meer bij', async () => {
    let open!: () => void;
    gates['brief.pdf'] = new Promise((resolve) => (open = resolve));
    setup();
    choose('brief.pdf');
    await waitFor(() => expect(button(p.clear).disabled).toBe(false));
    fireEvent.click(button(p.clear));
    open();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(output()).toBeNull();
    expect(screen.getByText(p.placeholder)).toBeTruthy();
  });
});
