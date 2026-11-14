// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageText, Piece } from '../compare/layout';
import type { DocInfo } from '../compare/profile';
import { unzipSync } from 'fflate';
import { readPdf } from '../compare/readPdf';
import { copyText } from '../compare/report';
import { closeVisual, renderPage } from '../compare/visual';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { PdfLoadError } from '../pdf/loader';
import { unsavedSources } from '../lib/unsavedWarning';
import { downloadFile } from '../pdf/save';
import { TextTool } from './TextTool';
import { DEFAULT_TEXT_OPTIONS } from './extract';
import { SETTINGS_PREFIX } from './settings';
import {
  UNDO_LIMIT,
  clearBatchFiles,
  getTextState,
  moveBatchFile,
  moveBatchFileTo,
  removeBatchFile,
  resetTextState,
  runBatch,
  setJoin,
  setOptions,
  undoZones,
} from './store';

/** Een pagina met alinea's (elk een lijst regels), met een witregel ertussen. */
function page(no: number, paragraphs: string[][]): PageText {
  const items: Piece[] = [];
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

const ROWS = 6;
const rows = (side: string, no: number) =>
  Array.from({ length: ROWS }, (_, i) => `${side} ${no}.${i + 1}`);

/** Een pagina met een kop, twee kolommen van zes regels en een voet (A4, in punten). */
function columns(no: number): PageText {
  const items: Piece[] = [];
  const add = (str: string, x: number, y: number) =>
    items.push({ str, x, y, fh: 10, w: str.length * 5 });
  add('Tijdschrift voor proeven', 50, 800);
  rows('links', no).forEach((str, i) => add(str, 50, 700 - i * 12));
  rows('rechts', no).forEach((str, i) => add(str, 320, 700 - i * 12));
  add(`Pagina ${no}`, 280, 40);
  return { no, w: 595, h: 842, items, chars: items.reduce((n, i) => n + i.str.length, 0) };
}

/** Een pagina met regels tekst en onderaan een paginanummer, in de onderrand. */
function numberedPage(no: number, lines: string[], printed: string): PageText {
  const p = page(no, [lines]);
  p.items.push({ str: printed, x: 290, y: 30, fh: 10, w: printed.length * 5 });
  return p;
}

const empty = (no: number): PageText => ({ no, w: 595, h: 842, items: [], chars: 0 });

const LETTER = [
  ['Geachte heer Jansen,'],
  ['Hierbij ontvangt u de nieuwe', 'huurovereenkomst voor de woning.'],
  ['Met vriendelijke groet,'],
];
const LETTER_TEXT =
  'Geachte heer Jansen,\n\nHierbij ontvangt u de nieuwe huurovereenkomst voor de woning.\n\nMet vriendelijke groet,';

/** Wat er per bestand "gelezen" wordt: de pagina's (of een fout). */
const DOCS: Record<string, PageText[] | Error> = {
  'brief.pdf': [page(1, LETTER)],
  'artikel.pdf': [columns(1), columns(2), columns(3)],
  'scan.pdf': [empty(1), page(2, [['Alleen hier staat een hele zin met tekst.']]), empty(3)],
  'kort.pdf': [page(1, [['Kort.']]), page(2, [['Een pagina met genoeg tekst erop.']])],
  'leeg.pdf': [empty(1), empty(2)],
  'boek.pdf': [
    page(1, [['De titel van het boek.']]),
    numberedPage(2, ['Het voorwoord van', 'het boek.'], '1'),
    numberedPage(3, ['En dan loopt de zin', 'door op de'], '2'),
    numberedPage(4, ['volgende pagina en', 'eindigt hier.'], '3'),
  ],
  'contract.pdf': [
    page(1, [
      [
        'Partijen komen het volgende overeen over de woning aan de straat.',
        'Artikel 1 Huurprijs',
        'De huur bedraagt vijfhonderd euro per maand, vooraf te betalen.',
      ],
    ]),
  ],
  'twee-scans.pdf': [empty(1), empty(2), page(3, [['Tekst op pagina drie, lang genoeg.']])],
  'scans.pdf': [
    empty(1),
    empty(2),
    empty(3),
    empty(4),
    page(5, [['Tekst op pagina vijf, lang genoeg.']]),
    empty(6),
  ],
  'tweede.pdf': [page(1, [['De tweede PDF.']])],
  'geheim.pdf': new PdfLoadError('password'),
  'kapot.pdf': new Error('kapot'),
  'weg.pdf': new PdfLoadError('unreadable'),
};

/** De gegevens (metadata) per bestand, zoals pdf.js ze geeft; de rest heeft er geen. */
const INFO: Record<string, DocInfo> = {
  'brief.pdf': {
    Title: 'Nieuwe huurovereenkomst',
    Author: 'Woningstichting Voorbeeld',
    Subject: 'Huur',
    CreationDate: "D:20180604090000+02'00'",
    Producer: 'Voorbeeld PDF 2.0',
    Creator: 'Tekstverwerker',
  },
  'tweede.pdf': { Title: 'De tweede', CreationDate: 'D:20200501' },
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
    return { pageCount: pages.length, pages, info: INFO[file.name] ?? {}, thumb: null };
  }),
}));

// Het tekenen nagebootst (jsdom kan niet echt tekenen); de rekenregels voor de zoom blijven echt.
vi.mock('../compare/visual', async (importOriginal) => {
  const real = await importOriginal<typeof import('../compare/visual')>();
  return {
    ...real,
    renderPage: vi.fn(async (file: File, no: number, width: number) => {
      const pages = DOCS[file.name];
      if (!Array.isArray(pages) || no < 1 || no > pages.length) return null;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.round(width * 1.414);
      return canvas;
    }),
    closeVisual: vi.fn(),
  };
});

vi.mock('../compare/report', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../compare/report')>()),
  copyText: vi.fn(async () => true),
}));

vi.mock('../pdf/save', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pdf/save')>()),
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

/** Effecten (toetsen, muis) lopen pas na het tekenen. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 60)));

const output = () => document.querySelector<HTMLTextAreaElement>('textarea.plaintext__output');
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const check = (name: string) => screen.getByRole<HTMLInputElement>('checkbox', { name });
const pressed = (name: string) => button(name).getAttribute('aria-pressed');

async function open(name: string) {
  setup();
  choose(name);
  await waitFor(() => expect(button(p.extract).disabled).toBe(false));
  await settle();
}

/** De laag met de vakken, even groot als een A4 in punten: zo is een punt één beeldpunt. */
function layer() {
  const element = document.querySelector<HTMLElement>('.plaintext-zones-layer')!;
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 595, height: 842, right: 595, bottom: 842 }) as DOMRect;
  return element;
}

/** Slepen van (x, y) naar (x2, y2), in punten vanaf linksonder zoals de PDF. */
function drag(target: Element, [x, y]: [number, number], [x2, y2]: [number, number]) {
  fireEvent.mouseDown(target, { button: 0, clientX: x, clientY: 842 - y });
  fireEvent.mouseMove(window, { clientX: x2, clientY: 842 - y2 });
  fireEvent.mouseUp(window, { clientX: x2, clientY: 842 - y2 });
}

/** Een vak tekenen van linksboven (x, y) naar rechtsonder (x2, y2), in punten. */
function draw(x: number, y: number, x2: number, y2: number) {
  drag(layer(), [x, y], [x2, y2]);
}

const zoneList = () =>
  [...document.querySelectorAll('.plaintext-zones__label')].map((el) => el.textContent);

/** De kolommen van het artikel: links en rechts, elk als vak. */
const LEFT_BOX = [40, 720, 300, 600] as const;
const RIGHT_BOX = [310, 720, 560, 600] as const;

// De tekst in deze tests zonder pagina-ankers en doorlopende zinnen (de standaard); die hebben
// hun eigen tests onderaan.
beforeEach(() => setOptions({ anchors: false, crossPage: false }));

afterEach(() => {
  cleanup();
  resetTextState();
  // De instellingen worden per bestandsnaam onthouden: elke test begint zonder.
  localStorage.clear();
  for (const name of Object.keys(gates)) delete gates[name];
  vi.mocked(readPdf).mockClear();
  vi.mocked(renderPage).mockClear();
  vi.mocked(closeVisual).mockClear();
  vi.mocked(copyText).mockClear();
  vi.mocked(downloadFile).mockClear();
});

describe('PDF → Platte tekst: beginnen', () => {
  it('begint leeg: het voorbeeld, een vak voor de PDF, en de knoppen staan uit', () => {
    setup();
    expect(pressed(p.views.preview)).toBe('true');
    expect(screen.getByText(p.placeholder)).toBeTruthy();
    expect(screen.getByText(p.slot.choose)).toBeTruthy();
    expect(button(p.extract).disabled).toBe(true);
    expect(button(p.clear).disabled).toBe(true);
    fireEvent.click(button(p.views.result));
    expect(screen.getByText(p.placeholder)).toBeTruthy();
  });

  it('toont de PDF eerst als voorbeeld; de tekst komt pas na "Tekst extraheren"', async () => {
    await open('brief.pdf');
    expect(screen.getByText(format(p.preview.page, { n: 1, total: 1 }))).toBeTruthy();
    expect(screen.getByRole('img', { name: format(p.preview.canvas, { n: 1 }) })).toBeTruthy();
    expect(renderPage).toHaveBeenLastCalledWith(expect.any(File), 1, expect.any(Number));
    expect(output()).toBeNull();

    fireEvent.click(button(p.views.result));
    expect(screen.getByText(p.resultPlaceholder)).toBeTruthy();

    fireEvent.click(button(p.extract));
    expect(pressed(p.views.result)).toBe('true');
    expect(output()!.value).toBe(LETTER_TEXT);
    const chars = LETTER_TEXT.length;
    const done = `${chars} tekens · 1 van 1 pagina gelezen`;
    expect(screen.getByText(format(p.done, { summary: done }))).toBeTruthy();
    expect(screen.getByText(`${done} · gemiddeld ${chars} tekens per pagina`)).toBeTruthy();
  });

  it('meldt de voortgang tijdens het lezen', async () => {
    let release!: () => void;
    gates['brief.pdf'] = new Promise((resolve) => (release = resolve));
    setup();
    choose('brief.pdf');
    await waitFor(() =>
      expect(screen.getByText(format(c.reading, { n: 0, total: 1 }))).toBeTruthy(),
    );
    expect(button(p.extract).disabled).toBe(true);
    release();
    await waitFor(() => expect(button(p.extract).disabled).toBe(false));
  });

  it('meldt een PDF met een wachtwoord en een kapotte PDF', async () => {
    setup();
    choose('geheim.pdf');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(c.errors.password));
    choose('kapot.pdf');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(c.errors.damaged));
    expect(button(p.extract).disabled).toBe(true);
  });

  it('een bestand dat niet van de schijf te lezen is, heet niet "beschadigd"', async () => {
    setup();
    choose('weg.pdf');
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(c.errors.unreadable));
  });

  it('meer dan één PDF tegelijk: alleen de eerste, met een melding', async () => {
    setup();
    choose('brief.pdf', 'tweede.pdf');
    await waitFor(() => expect(button(p.extract).disabled).toBe(false));
    expect(screen.getByText(p.tooMany)).toBeTruthy();
    expect(readPdf).toHaveBeenCalledTimes(1);
  });

  it('een PDF die nog gelezen wordt, overschrijft een later gekozen PDF niet', async () => {
    let release!: () => void;
    gates['brief.pdf'] = new Promise((resolve) => (release = resolve));
    setup();
    choose('brief.pdf');
    choose('tweede.pdf');
    await waitFor(() => expect(button(p.extract).disabled).toBe(false));
    release();
    await settle();
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe('De tweede PDF.');
  });

  it('een PDF die nog gelezen wordt en dan mislukt, geeft geen melding bij een later gekozen PDF', async () => {
    let release!: () => void;
    gates['geheim.pdf'] = new Promise((resolve) => (release = resolve));
    setup();
    choose('geheim.pdf');
    choose('tweede.pdf');
    await waitFor(() => expect(button(p.extract).disabled).toBe(false));
    release();
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('PDF → Platte tekst: voorbeeld', () => {
  it('bladert met de knoppen en de toetsen, en niet voorbij de eerste of laatste pagina', async () => {
    await open('artikel.pdf');
    const at = (n: number) => screen.getByText(format(p.preview.page, { n, total: 3 }));
    expect(at(1)).toBeTruthy();
    expect(button(p.preview.first).disabled).toBe(true);
    expect(button(p.preview.previous).disabled).toBe(true);

    fireEvent.click(button(p.preview.next));
    expect(at(2)).toBeTruthy();
    await waitFor(() =>
      expect(renderPage).toHaveBeenLastCalledWith(expect.any(File), 2, expect.any(Number)),
    );
    fireEvent.click(button(p.preview.last));
    expect(at(3)).toBeTruthy();
    expect(button(p.preview.next).disabled).toBe(true);
    expect(button(p.preview.last).disabled).toBe(true);
    fireEvent.click(button(p.preview.previous));
    expect(at(2)).toBeTruthy();
    fireEvent.click(button(p.preview.first));
    expect(at(1)).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(at(2)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'End' });
    expect(at(3)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'PageDown' });
    expect(at(3)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(at(2)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Home' });
    expect(at(1)).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'PageUp' });
    expect(at(1)).toBeTruthy();
    // Niet met Ctrl, en niet in een invoerveld.
    fireEvent.keyDown(document.body, { key: 'ArrowRight', ctrlKey: true });
    expect(at(1)).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('slider', { name: p.settings.gap }), { key: 'ArrowRight' });
    expect(at(1)).toBeTruthy();
  });

  it('bladert met het scrollwiel aan de rand, niet in het midden', async () => {
    await open('artikel.pdf');
    const root = document.querySelector<HTMLElement>('[data-scroll-root]')!;
    const at = (n: number) => screen.queryByText(format(p.preview.page, { n, total: 3 }));
    // jsdom heeft geen opmaak: zonder schuifruimte staat het vak boven- én onderaan.
    fireEvent.wheel(root, { deltaY: 100 });
    expect(at(2)).toBeTruthy();
    // Kort daarna nog een tik: niet meteen nog een pagina verder.
    fireEvent.wheel(root, { deltaY: 100 });
    expect(at(2)).toBeTruthy();
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    fireEvent.wheel(root, { deltaY: -100 });
    expect(at(1)).toBeTruthy();
    // Midden in een lange pagina: gewoon schuiven.
    Object.defineProperty(root, 'scrollHeight', { value: 2000, configurable: true });
    Object.defineProperty(root, 'clientHeight', { value: 500, configurable: true });
    root.scrollTop = 600;
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    fireEvent.wheel(root, { deltaY: 100 });
    expect(at(1)).toBeTruthy();
  });

  it('zoomt in en uit, en maakt de pagina of de breedte passend', async () => {
    await open('brief.pdf');
    const zoom = () => document.querySelector('.plaintext-zoom__value')!.textContent;
    expect(pressed(p.preview.fitPage)).toBe('true');
    const fitted = zoom();
    fireEvent.click(button(p.preview.zoomIn));
    expect(pressed(p.preview.fitPage)).toBe('false');
    expect(parseInt(zoom()!, 10)).toBeGreaterThan(parseInt(fitted!, 10));
    fireEvent.click(button(p.preview.zoomOut));
    fireEvent.click(button(p.preview.zoomOut));
    expect(parseInt(zoom()!, 10)).toBeLessThan(parseInt(fitted!, 10));
    fireEvent.click(button(p.preview.fitWidth));
    expect(pressed(p.preview.fitWidth)).toBe('true');
    expect(pressed(p.preview.fitPage)).toBe('false');
    fireEvent.click(button(p.preview.fitPage));
    expect(zoom()).toBe(fitted);
  });

  it('meldt het als een pagina niet getekend kan worden', async () => {
    vi.mocked(renderPage).mockRejectedValueOnce(new Error('kapot'));
    await open('brief.pdf');
    await waitFor(() => expect(screen.getByText(p.preview.error)).toBeTruthy());
  });
});

describe('PDF → Platte tekst: leesvakken', () => {
  it('leest alleen wat in de vakken staat, in de volgorde waarin ze getekend zijn', async () => {
    await open('artikel.pdf');
    // Zonder vakken: de hele pagina, kop en voet weggelaten, links en dan rechts.
    fireEvent.click(button(p.extract));
    expect(output()!.value!.split('\n\n')[0]).toBe(
      `${rows('links', 1).join(' ')}\n\n${rows('rechts', 1).join(' ')}`.split('\n\n')[0],
    );
    expect(output()!.value).not.toContain('Tijdschrift');

    fireEvent.click(check(p.zones.use));
    expect(pressed(p.views.preview)).toBe('true');
    expect(screen.getByText(p.zones.empty)).toBeTruthy();
    expect(screen.getByText(p.zones.drawHint)).toBeTruthy();
    await settle();
    draw(...RIGHT_BOX);
    draw(...LEFT_BOX);
    expect(zoneList()).toEqual(['Vak 1', 'Vak 2']);
    expect(
      [...document.querySelectorAll('.plaintext-zone__num')].map((e) => e.textContent),
    ).toEqual(['1', '2']);

    fireEvent.click(button(p.extract));
    const pageText = (no: number) =>
      `${rows('rechts', no).join(' ')}\n\n${rows('links', no).join(' ')}`;
    expect(output()!.value).toBe([1, 2, 3].map(pageText).join('\n\n'));
  });

  it('een te klein getekend vak telt niet', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(100, 700, 105, 600);
    draw(100, 700, 300, 696);
    expect(zoneList()).toEqual([]);
    expect(button(p.zones.undo).disabled).toBe(true);
  });

  it('verplaatst een vak en versleept een rand', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    // Eerst een vak over de linkerkolom, dan naar rechts geschoven: dan leest het de rechter.
    draw(...LEFT_BOX);
    const zone = document.querySelector('.plaintext-zone')!;
    drag(zone, [150, 650], [420, 650]);
    expect(getTextState().zones).toHaveLength(1);
    fireEvent.click(button(p.extract));
    expect(output()!.value!.split('\n\n')[0]).toBe(rows('rechts', 1).join(' '));

    // De onderrand omhoog: alleen de bovenste twee regels.
    fireEvent.click(button(p.views.preview));
    await settle();
    layer();
    const bottom = document.querySelector('.plaintext-zone__handle--s')!;
    drag(bottom, [430, 600], [430, 686]);
    fireEvent.click(button(p.extract));
    expect(output()!.value!.split('\n\n')[0]).toBe(rows('rechts', 1).slice(0, 2).join(' '));
  });

  it('ongedaan maken met de knop en met Ctrl+Z; vakken wissen', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...LEFT_BOX);
    draw(...RIGHT_BOX);
    expect(zoneList()).toEqual(['Vak 1', 'Vak 2']);
    fireEvent.click(button(p.zones.undo));
    expect(zoneList()).toEqual(['Vak 1']);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(screen.getByText(p.zones.empty)).toBeTruthy();
    expect(button(p.zones.undo).disabled).toBe(true);

    draw(...LEFT_BOX);
    draw(...RIGHT_BOX);
    fireEvent.click(button(format(p.zones.remove, { n: 1 })));
    expect(zoneList()).toEqual(['Vak 1']);
    // Het overgebleven vak is het rechter.
    fireEvent.click(button(p.extract));
    expect(output()!.value!.split('\n\n')[0]).toBe(rows('rechts', 1).join(' '));
    fireEvent.click(button(p.views.preview));
    fireEvent.click(button(p.zones.clearAll));
    expect(screen.getByText(p.zones.empty)).toBeTruthy();
    // Het wissen kan ook terug.
    fireEvent.click(button(p.zones.undo));
    expect(zoneList()).toEqual(['Vak 1']);
  });

  it('onthoudt hooguit zoveel stappen om ongedaan te maken als de extractor', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    for (let i = 0; i < UNDO_LIMIT + 5; i++) {
      draw(...LEFT_BOX);
      fireEvent.click(button(p.zones.clearAll));
    }
    expect(getTextState().undo).toHaveLength(UNDO_LIMIT);
  });

  it('Ctrl+Z doet niets als de leesvakken uit staan', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...LEFT_BOX);
    fireEvent.click(check(p.zones.use));
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(getTextState().zones).toHaveLength(1);
    expect(document.querySelector('.plaintext-zones-layer')).toBeNull();
    expect(button(p.zones.undo).disabled).toBe(true);
    // Ook de stand zelf maakt dan niets ongedaan, zoals in de extractor.
    act(() => undoZones());
    expect(getTextState().zones).toHaveLength(1);
  });

  it('een klik op een vak zonder te slepen is geen stap om ongedaan te maken', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...LEFT_BOX);
    expect(getTextState().undo).toHaveLength(1);
    drag(document.querySelector('.plaintext-zone')!, [150, 650], [150, 650]);
    drag(document.querySelector('.plaintext-zone__handle--e')!, [300, 660], [300, 660]);
    expect(getTextState().undo).toHaveLength(1);
  });

  it('met leesvakken aan maar zonder vak: niets gelezen, met een melding', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    fireEvent.click(button(p.extract));
    expect(screen.getByText(p.noZones)).toBeTruthy();
    expect(screen.getByText(p.empty)).toBeTruthy();
    expect(button(p.copy).disabled).toBe(true);
  });

  it('met leesvakken gaan kolommen en kop- en voetteksten niet mee', async () => {
    await open('artikel.pdf');
    expect(check(p.settings.columns).disabled).toBe(false);
    fireEvent.click(check(p.zones.use));
    expect(check(p.settings.columns).disabled).toBe(true);
    expect(check(p.settings.strip).disabled).toBe(true);
    expect(check(p.settings.dehyphen).disabled).toBe(false);
    expect(screen.getByText(p.settings.zonesOff)).toBeTruthy();
  });

  it('een andere PDF begint zonder vakken, op pagina 1', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...LEFT_BOX);
    fireEvent.click(button(p.preview.next));
    choose('brief.pdf');
    await waitFor(() =>
      expect(screen.getByText(format(p.preview.page, { n: 1, total: 1 }))).toBeTruthy(),
    );
    expect(screen.getByText(p.zones.empty)).toBeTruthy();
    expect(check(p.zones.use).checked).toBe(true);
    expect(closeVisual).toHaveBeenCalled();
  });
});

describe('PDF → Platte tekst: resultaat', () => {
  it('een andere instelling of een ander vak werkt pas bij opnieuw extraheren', async () => {
    await open('artikel.pdf');
    fireEvent.click(button(p.extract));
    const before = output()!.value;
    expect(screen.queryByText(p.stale)).toBeNull();
    fireEvent.click(check(p.settings.strip));
    expect(screen.getByText(p.stale)).toBeTruthy();
    expect(output()!.value).toBe(before);
    fireEvent.click(button(p.extract));
    expect(screen.queryByText(p.stale)).toBeNull();
    expect(output()!.value).toContain('Tijdschrift voor proeven');

    fireEvent.click(check(p.zones.use));
    fireEvent.click(button(p.views.result));
    expect(screen.getByText(p.stale)).toBeTruthy();
  });

  it('de alinea-gevoeligheid', async () => {
    await open('brief.pdf');
    const slider = screen.getByRole<HTMLInputElement>('slider', { name: p.settings.gap });
    expect(slider.value).toBe('1.3');
    // De witregels hier zijn 2 keer de regelafstand: bij 2,5 is het één alinea.
    fireEvent.input(slider, { target: { value: '2.5' } });
    expect(screen.getByText('2,5')).toBeTruthy();
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe(LETTER_TEXT.replace(/\n\n/g, ' '));
    fireEvent.click(check(p.settings.joinLines));
    expect(slider.disabled).toBe(true);
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe(LETTER.flat().join('\n'));
  });

  it('noemt pagina’s zonder tekstlaag en met nauwelijks tekst', async () => {
    await open('scan.pdf');
    fireEvent.click(button(p.extract));
    expect(screen.getByText(format(p.noTextPages, { list: 'pagina’s 1 en 3' }))).toBeTruthy();
    expect(screen.getByText(/· 2 pagina’s zonder tekstlaag$/)).toBeTruthy();

    cleanup();
    resetTextState();
    await open('kort.pdf');
    fireEvent.click(button(p.extract));
    expect(screen.getByText(format(p.lowPages, { list: 'pagina 1' }))).toBeTruthy();
    expect(screen.queryByText(/Geen tekstlaag/)).toBeNull();
  });

  it('een PDF zonder enige tekst: een melding, en niets te kopiëren', async () => {
    await open('leeg.pdf');
    fireEvent.click(button(p.extract));
    expect(screen.getByText(p.empty)).toBeTruthy();
    expect(button(p.copy).disabled).toBe(true);
    expect(button(p.download).disabled).toBe(true);
  });

  it('kopieert de tekst; de melding verdwijnt bij een nieuwe tekst', async () => {
    await open('brief.pdf');
    fireEvent.click(button(p.extract));
    fireEvent.click(button(p.copy));
    await waitFor(() => expect(screen.getByText(p.copied)).toBeTruthy());
    expect(copyText).toHaveBeenCalledWith(LETTER_TEXT);
    fireEvent.click(button(p.extract));
    expect(screen.queryByText(p.copied)).toBeNull();
  });

  it('meldt het als kopiëren niet lukt', async () => {
    vi.mocked(copyText).mockResolvedValueOnce(false);
    await open('brief.pdf');
    fireEvent.click(button(p.extract));
    fireEvent.click(button(p.copy));
    await waitFor(() => expect(screen.getByText(p.copyFailed)).toBeTruthy());
  });

  it('de tekst is aan te passen: kopiëren en downloaden nemen het mee, opnieuw extraheren zet terug', async () => {
    await open('brief.pdf');
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe(LETTER_TEXT);
    expect(screen.getByRole('textbox', { name: p.outputLabel })).toBe(output());
    expect(screen.queryByText(p.edited)).toBeNull();
    fireEvent.input(output()!, { target: { value: 'Mijn eigen tekst.' } });
    expect(output()!.value).toBe('Mijn eigen tekst.');
    expect(screen.getByText(p.edited)).toBeTruthy();
    fireEvent.click(button(p.copy));
    await waitFor(() => expect(copyText).toHaveBeenLastCalledWith('Mijn eigen tekst.'));
    fireEvent.click(button(p.download));
    const [data] = vi.mocked(downloadFile).mock.calls.at(-1)!;
    expect(new TextDecoder().decode(data as Uint8Array)).toBe('Mijn eigen tekst.');
    // Weer precies de tekst uit de PDF: geen melding over aanpassingen.
    fireEvent.input(output()!, { target: { value: LETTER_TEXT } });
    expect(screen.queryByText(p.edited)).toBeNull();
    // Alles weggehaald: niets te kopiëren of te downloaden.
    fireEvent.input(output()!, { target: { value: '' } });
    expect(button(p.copy).disabled).toBe(true);
    expect(button(p.download).disabled).toBe(true);
    // Opnieuw extraheren zet de tekst terug (na een vraag: de aanpassing is niet bewaard).
    fireEvent.click(button(p.extract));
    fireEvent.click(screen.getByRole('button', { name: p.discard.confirmExtract }));
    expect(output()!.value).toBe(LETTER_TEXT);
    expect(getTextState().edited).toBeNull();
    // Een andere PDF begint ook zonder aanpassingen.
    fireEvent.input(output()!, { target: { value: 'weer anders' } });
    choose('tweede.pdf');
    fireEvent.click(screen.getByRole('button', { name: p.discard.confirmReplace }));
    await waitFor(() => expect(getTextState().edited).toBeNull());
  });

  it('waarschuwt bij sluiten zolang een aangepaste tekst niet gedownload of gekopieerd is', async () => {
    await open('brief.pdf');
    fireEvent.click(button(p.extract));
    // Alleen extraheren is geen werk dat weg kan: dat doe je zo opnieuw.
    expect(unsavedSources()).not.toContain('text');
    fireEvent.input(output()!, { target: { value: 'Mijn eigen tekst.' } });
    expect(unsavedSources()).toContain('text');
    fireEvent.click(button(p.download));
    expect(unsavedSources()).not.toContain('text');
    fireEvent.input(output()!, { target: { value: 'Nog eens anders.' } });
    expect(unsavedSources()).toContain('text');
    // Kopiëren telt ook, maar alleen als het lukte.
    vi.mocked(copyText).mockResolvedValueOnce(false);
    fireEvent.click(button(p.copy));
    await waitFor(() => expect(screen.getByText(p.copyFailed)).toBeTruthy());
    expect(unsavedSources()).toContain('text');
    fireEvent.click(button(p.copy));
    await waitFor(() => expect(unsavedSources()).not.toContain('text'));
    // Weer precies de tekst uit de PDF, of opnieuw extraheren: niets te verliezen.
    fireEvent.input(output()!, { target: { value: 'Derde versie.' } });
    fireEvent.click(button(p.extract));
    fireEvent.click(screen.getByRole('button', { name: p.discard.confirmExtract }));
    expect(unsavedSources()).not.toContain('text');
  });

  it('downloadt de tekst als <naam>_extract.txt', async () => {
    await open('brief.pdf');
    fireEvent.click(button(p.extract));
    fireEvent.click(button(p.download));
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const [data, name, type] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(name).toBe('brief_extract.txt');
    expect(type).toBe('text/plain;charset=utf-8');
    expect(new TextDecoder().decode(data as Uint8Array)).toBe(LETTER_TEXT);
    expect(screen.getByText(format(p.downloaded, { name: 'brief_extract.txt' }))).toBeTruthy();
  });
});

describe('PDF → Platte tekst: indeling', () => {
  it('de blokken links klappen in en uit, en blijven zo staan (ook na Wissen)', async () => {
    await open('brief.pdf');
    const block = (title: string) =>
      screen.getByText(title, { selector: 'summary' }).closest('details')!;
    // In de volgorde van de extractor (Instellingen bewaren is nieuw, onderaan).
    expect([...document.querySelectorAll('summary')].map((s) => s.textContent)).toEqual([
      p.zones.title,
      p.settings.title,
      p.header.title,
      p.pages.title,
      p.batch.title,
      p.save.title,
    ]);
    expect(block(p.zones.title).open).toBe(true);
    expect(block(p.settings.title).open).toBe(true);
    // Zoals in de extractor: de documentkop en metadata standaard dicht.
    expect(block(p.header.title).open).toBe(false);
    expect(block(p.pages.title).open).toBe(true);
    expect(block(p.batch.title).open).toBe(false);
    expect(block(p.save.title).open).toBe(false);
    // Zoals de browser het doet als je op de kop klikt: dicht, en dan het toggle-event.
    act(() => {
      block(p.settings.title).open = false;
      block(p.settings.title).dispatchEvent(new Event('toggle'));
    });
    expect(getTextState().blocks).toEqual({
      zones: true,
      clean: false,
      meta: false,
      pages: true,
      batch: false,
      save: false,
    });
    fireEvent.click(button(p.clear));
    cleanup();
    setup();
    expect(block(p.settings.title).open).toBe(false);
    expect(block(p.zones.title).open).toBe(true);
  });

  it('de balk rechts: voorbeeld of resultaat, met bladeren en zoomen of kopiëren en downloaden', async () => {
    await open('artikel.pdf');
    const bar = document.querySelector<HTMLElement>('.plaintext-bar')!;
    expect(within(bar).getByRole('group', { name: p.views.label })).toBeTruthy();
    expect(within(bar).getByRole('group', { name: p.preview.nav })).toBeTruthy();
    expect(within(bar).getByRole('group', { name: p.preview.zoom })).toBeTruthy();
    expect(within(bar).getByText('1 / 3')).toBeTruthy();
    expect(within(bar).queryByRole('button', { name: p.copy })).toBeNull();
    fireEvent.click(button(p.extract));
    const result = document.querySelector<HTMLElement>('.plaintext-bar')!;
    expect(within(result).getByRole('button', { name: p.copy })).toBeTruthy();
    expect(within(result).getByRole('button', { name: p.download })).toBeTruthy();
    expect(within(result).queryByRole('group', { name: p.preview.nav })).toBeNull();
  });
});

describe('PDF → Platte tekst: wissen', () => {
  it('haalt de PDF en de vakken weg; de instellingen blijven, de leesvakken gaan uit', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.settings.dehyphen));
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...LEFT_BOX);
    fireEvent.click(button(p.extract));
    fireEvent.click(button(p.clear));
    expect(screen.getByText(p.placeholder)).toBeTruthy();
    expect(pressed(p.views.preview)).toBe('true');
    expect(check(p.settings.dehyphen).checked).toBe(false);
    expect(check(p.zones.use).checked).toBe(false);
    expect(getTextState().zones).toEqual([]);
    expect(getTextState().result).toBeNull();
    expect(button(p.clear).disabled).toBe(true);
    expect(closeVisual).toHaveBeenCalled();
    expect(
      within(document.querySelector('.plaintext-slot')!).getByText(p.slot.choose),
    ).toBeTruthy();
  });

  it('tijdens het lezen: de PDF komt er niet meer bij', async () => {
    let release!: () => void;
    gates['brief.pdf'] = new Promise((resolve) => (release = resolve));
    setup();
    choose('brief.pdf');
    await waitFor(() => expect(button(p.clear).disabled).toBe(false));
    fireEvent.click(button(p.clear));
    release();
    await settle();
    expect(button(p.extract).disabled).toBe(true);
    expect(screen.getByText(p.placeholder)).toBeTruthy();
  });
});

describe('PDF → Platte tekst: niets weggooien', () => {
  /** Het artikel open, met een vak, de tekst geëxtraheerd en aangepast (en gedownload). */
  async function work() {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...LEFT_BOX);
    fireEvent.click(button(p.extract));
    fireEvent.input(output()!, { target: { value: 'Mijn eigen tekst.' } });
  }

  const dialog = () => screen.queryByRole('dialog', { name: p.discard.title });

  it('een andere PDF die niet opent: de vorige PDF, de vakken en de tekst blijven, met een melding', async () => {
    await work();
    // Gedownload: niets te verliezen, dus geen vraag.
    fireEvent.click(button(p.download));
    choose('geheim.pdf');
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        format(c.replaceFailed, {
          name: 'geheim.pdf',
          reason: c.errors.password,
          old: 'artikel.pdf',
        }),
      ),
    );
    expect(output()!.value).toBe('Mijn eigen tekst.');
    expect(zoneList()).toEqual(['Vak 1']);
    expect(getTextState().slot.status).toBe('ready');
    expect(button(p.extract).disabled).toBe(false);
    expect(closeVisual).not.toHaveBeenCalled();
    // De PDF blijft dezelfde: de naam in het vak, en de pagina's.
    expect(
      within(document.querySelector('.plaintext-slot')!).getByText('artikel.pdf'),
    ).toBeTruthy();
    // Een volgende PDF die wel opent: de melding is weg.
    choose('brief.pdf');
    await waitFor(() =>
      expect(screen.getByText(format(p.preview.page, { n: 1, total: 1 }))).toBeTruthy(),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(closeVisual).toHaveBeenCalled();
  });

  it('tijdens het lezen van een andere PDF blijft de vorige staan, met de voortgang', async () => {
    await open('brief.pdf');
    let release!: () => void;
    gates['tweede.pdf'] = new Promise((resolve) => (release = resolve));
    choose('tweede.pdf');
    await waitFor(() =>
      expect(
        screen.getByText(format(c.replacingPage, { name: 'tweede.pdf', n: 0, total: 1 })),
      ).toBeTruthy(),
    );
    expect(button(p.extract).disabled).toBe(false);
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe(LETTER_TEXT);
    release();
    await waitFor(() => expect(getTextState().result).toBeNull());
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe('De tweede PDF.');
  });

  it('Wissen tijdens het lezen van een andere PDF: die komt er niet meer bij', async () => {
    await open('brief.pdf');
    let release!: () => void;
    gates['tweede.pdf'] = new Promise((resolve) => (release = resolve));
    choose('tweede.pdf');
    await waitFor(() => expect(screen.getByText(/^tweede\.pdf wordt gelezen/)).toBeTruthy());
    fireEvent.click(button(p.clear));
    release();
    await settle();
    expect(getTextState().slot.status).toBe('empty');
  });

  it('aangepaste tekst die nog niet bewaard is: eerst een vraag; annuleren laat alles staan', async () => {
    await work();
    fireEvent.click(button(p.clear));
    expect(within(dialog()!).getByText(p.discard.clear)).toBeTruthy();
    fireEvent.click(within(dialog()!).getByRole('button', { name: p.save.cancel }));
    expect(dialog()).toBeNull();

    fireEvent.click(button(p.extract));
    expect(within(dialog()!).getByText(p.discard.extract)).toBeTruthy();
    fireEvent.click(within(dialog()!).getByRole('button', { name: p.save.cancel }));

    choose('brief.pdf');
    expect(within(dialog()!).getByText(p.discard.replace)).toBeTruthy();
    fireEvent.click(within(dialog()!).getByRole('button', { name: p.save.cancel }));
    await settle();

    expect(dialog()).toBeNull();
    expect(readPdf).toHaveBeenCalledTimes(1);
    expect(output()!.value).toBe('Mijn eigen tekst.');
    expect(zoneList()).toEqual(['Vak 1']);
  });

  it('na de vraag: Wissen, opnieuw extraheren en een andere PDF gaan door', async () => {
    await work();
    fireEvent.click(button(p.extract));
    fireEvent.click(within(dialog()!).getByRole('button', { name: p.discard.confirmExtract }));
    expect(getTextState().edited).toBeNull();
    expect(output()!.value).not.toBe('Mijn eigen tekst.');

    fireEvent.input(output()!, { target: { value: 'Weer anders.' } });
    choose('brief.pdf');
    fireEvent.click(within(dialog()!).getByRole('button', { name: p.discard.confirmReplace }));
    await waitFor(() =>
      expect(screen.getByText(format(p.preview.page, { n: 1, total: 1 }))).toBeTruthy(),
    );
    expect(getTextState().edited).toBeNull();

    // De leesvakken staan nog aan, maar brief.pdf heeft er geen: uit, dan is er tekst.
    fireEvent.click(check(p.zones.use));
    fireEvent.click(button(p.extract));
    fireEvent.input(output()!, { target: { value: 'Derde keer.' } });
    fireEvent.click(button(p.clear));
    fireEvent.click(within(dialog()!).getByRole('button', { name: p.discard.confirmClear }));
    expect(getTextState().slot.status).toBe('empty');
    expect(dialog()).toBeNull();
  });

  it('een andere PDF met onthouden instellingen: de onbekende opties van de vorige gaan niet mee', async () => {
    await open('brief.pdf');
    fireEvent.click(check(p.settings.dehyphen));
    choose('artikel.pdf');
    await waitFor(() =>
      expect(screen.getByText(format(p.preview.page, { n: 1, total: 3 }))).toBeTruthy(),
    );
    await loadSettings(json('later.json', { options: { laterNieuw: true } }));
    expect(getTextState().extra.options).toEqual({ laterNieuw: true });
    choose('brief.pdf');
    await waitFor(() => expect(screen.getByText(/· instellingen hersteld$/)).toBeTruthy());
    expect(getTextState().extra.options).toEqual({});
  });

  it('geen vraag zonder aanpassing, of als de aanpassing gedownload of gekopieerd is', async () => {
    await open('brief.pdf');
    fireEvent.click(button(p.extract));
    fireEvent.click(button(p.extract));
    expect(dialog()).toBeNull();
    fireEvent.input(output()!, { target: { value: 'Mijn eigen tekst.' } });
    fireEvent.click(button(p.copy));
    await waitFor(() => expect(screen.getByText(p.copied)).toBeTruthy());
    fireEvent.click(button(p.extract));
    expect(dialog()).toBeNull();
    expect(output()!.value).toBe(LETTER_TEXT);
    fireEvent.click(button(p.clear));
    expect(dialog()).toBeNull();
    expect(getTextState().slot.status).toBe('empty');
  });
});

/** De tekst van één pagina van het artikel: elk vak (in volgorde) als eigen alinea. */
const columnText = (side: 'links' | 'rechts', no: number) => rows(side, no).join(' ');

/** Een instellingenbestand, als bestand om te kiezen. */
const json = (name: string, value: unknown) =>
  new File([typeof value === 'string' ? value : JSON.stringify(value)], name, {
    type: 'application/json',
  });

async function loadSettings(file: File) {
  fireEvent.change(document.querySelector('#plaintext-settings-file')!, {
    target: { files: [file] },
  });
  await settle();
}

const stored = () => Object.keys(localStorage).filter((k) => k.startsWith(SETTINGS_PREFIX));

describe('PDF → Platte tekst: vakken per pagina', () => {
  it('een pagina met eigen vakken: begint met een kopie, en leest dan alleen die', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    expect(check(p.zones.own).checked).toBe(false);
    expect(screen.getByText(p.zones.ownOff)).toBeTruthy();
    draw(...LEFT_BOX);

    fireEvent.click(button(p.preview.next));
    await settle();
    fireEvent.click(check(p.zones.own));
    expect(screen.getByText(format(p.zones.ownOn, { n: 2 }))).toBeTruthy();
    // Een kopie van de standaardvakken, in de kleur van eigen vakken.
    expect(zoneList()).toEqual(['Vak 1']);
    expect(document.querySelector('.plaintext-zones--own')).toBeTruthy();
    expect(document.querySelector('.plaintext-zone--own')).toBeTruthy();
    fireEvent.click(button(p.zones.clearAll));
    expect(screen.getByText(format(p.zones.emptyOwn, { n: 2 }))).toBeTruthy();
    await settle();
    draw(...RIGHT_BOX);

    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe(
      [columnText('links', 1), columnText('rechts', 2), columnText('links', 3)].join('\n\n'),
    );

    // Pagina 1 heeft nog steeds de standaardvakken.
    fireEvent.click(button(p.views.preview));
    fireEvent.click(button(p.preview.first));
    expect(check(p.zones.own).checked).toBe(false);
    expect(document.querySelector('.plaintext-zone--own')).toBeNull();

    // Uitvinken op pagina 2: terug naar de standaardvakken.
    fireEvent.click(button(p.preview.next));
    fireEvent.click(check(p.zones.own));
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe([1, 2, 3].map((no) => columnText('links', no)).join('\n\n'));
  });

  it('een lege eigen set slaat de pagina over, of leest hem helemaal', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...LEFT_BOX);
    fireEvent.click(button(p.preview.next));
    fireEvent.click(check(p.zones.own));
    fireEvent.click(button(p.zones.clearAll));
    fireEvent.click(button(p.extract));
    expect(screen.getByText(format(p.skippedPages, { list: 'pagina 2' }))).toBeTruthy();
    expect(output()!.value).toBe([1, 3].map((no) => columnText('links', no)).join('\n\n'));

    // Kolommen doen dan weer mee (voor die pagina's), kop/voet weglaten niet.
    expect(check(p.settings.columns).disabled).toBe(true);
    fireEvent.click(check(p.zones.readEmpty));
    expect(check(p.settings.columns).disabled).toBe(false);
    expect(check(p.settings.strip).disabled).toBe(true);
    expect(screen.getByText(p.settings.zonesOffRead)).toBeTruthy();
    fireEvent.click(button(p.extract));
    expect(screen.queryByText(/Overgeslagen/)).toBeNull();
    expect(output()!.value).toBe(
      [
        columnText('links', 1),
        // De hele pagina: kop, linkerkolom, rechterkolom en voet, elk een eigen alinea.
        'Tijdschrift voor proeven',
        columnText('links', 2),
        columnText('rechts', 2),
        'Pagina 2',
        columnText('links', 3),
      ].join('\n\n'),
    );
  });

  it('alle pagina’s eigen vakken, en dat kan ongedaan', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...LEFT_BOX);
    fireEvent.click(button(p.zones.allOwn));
    for (let no = 1; no <= 3; no++) {
      expect(check(p.zones.own).checked, `pagina ${no}`).toBe(true);
      expect(zoneList()).toEqual(['Vak 1']);
      fireEvent.click(button(p.preview.next));
    }
    expect(Object.keys(getTextState().pages)).toEqual(['1', '2', '3']);
    fireEvent.click(button(p.zones.undo));
    expect(getTextState().pages).toEqual({});
    expect(check(p.zones.own).checked).toBe(false);
  });

  it('ongedaan maken geldt ook voor eigen vakken', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    fireEvent.click(check(p.zones.own));
    draw(...RIGHT_BOX);
    expect(getTextState().pages).toEqual({ 1: [expect.any(Object)] });
    expect(getTextState().zones).toEqual([]);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(getTextState().pages).toEqual({ 1: [] });
    fireEvent.click(button(p.zones.undo));
    expect(getTextState().pages).toEqual({});
  });

  it('zonder PDF of zonder leesvakken staan de knoppen voor eigen vakken uit', async () => {
    setup();
    expect(check(p.zones.own).disabled).toBe(true);
    expect(button(p.zones.allOwn).disabled).toBe(true);
    expect(check(p.zones.readEmpty).disabled).toBe(true);
    cleanup();
    await open('artikel.pdf');
    expect(check(p.zones.own).disabled).toBe(true);
    fireEvent.click(check(p.zones.use));
    expect(check(p.zones.own).disabled).toBe(false);
    expect(button(p.zones.allOwn).disabled).toBe(false);
    expect(check(p.zones.readEmpty).disabled).toBe(false);
  });

  it('lange paginalijsten worden reeksen', async () => {
    await open('scans.pdf');
    fireEvent.click(button(p.extract));
    expect(screen.getByText(format(p.noTextPages, { list: 'pagina’s 1–4 en 6' }))).toBeTruthy();
    // Twee op een rij is nog geen reeks.
    cleanup();
    resetTextState();
    await open('twee-scans.pdf');
    fireEvent.click(button(p.extract));
    expect(screen.getByText(format(p.noTextPages, { list: 'pagina’s 1 en 2' }))).toBeTruthy();
  });

  it('alle pagina’s eigen vakken laat een eigen set die er al is staan', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...LEFT_BOX);
    fireEvent.click(button(p.preview.next));
    fireEvent.click(check(p.zones.own));
    fireEvent.click(button(p.zones.clearAll));
    await settle();
    draw(...RIGHT_BOX);
    const own = getTextState().pages[2];
    fireEvent.click(button(p.zones.allOwn));
    expect(getTextState().pages[2]).toBe(own);
    expect(getTextState().pages[1]).toEqual(getTextState().zones);
    expect(getTextState().pages[1]).not.toBe(getTextState().zones);
  });
});

describe('PDF → Platte tekst: instellingen bewaren', () => {
  it('onthoudt per bestandsnaam en herstelt bij opnieuw openen', async () => {
    await open('artikel.pdf');
    expect(screen.queryByText(/instellingen hersteld/)).toBeNull();
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...LEFT_BOX);
    fireEvent.click(button(p.preview.next));
    fireEvent.click(check(p.zones.own));
    fireEvent.click(check(p.settings.dehyphen));
    expect(stored()).toEqual([`${SETTINGS_PREFIX}artikel.pdf`]);

    fireEvent.click(button(p.clear));
    expect(check(p.zones.use).checked).toBe(false);
    choose('artikel.pdf');
    await waitFor(() => expect(screen.getByText(/· instellingen hersteld$/)).toBeTruthy());
    expect(check(p.zones.use).checked).toBe(true);
    expect(check(p.settings.dehyphen).checked).toBe(false);
    expect(zoneList()).toEqual(['Vak 1']);
    expect(getTextState().pages).toEqual({ 2: [expect.any(Object)] });

    // Een andere PDF: niets hersteld (de instellingen van nu blijven staan).
    choose('brief.pdf');
    await waitFor(() =>
      expect(screen.getByText(format(p.preview.page, { n: 1, total: 1 }))).toBeTruthy(),
    );
    expect(screen.queryByText(/instellingen hersteld/)).toBeNull();
    expect(getTextState().zones).toEqual([]);
  });

  it('slaat de instellingen op als .json, in het formaat van de extractor', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    fireEvent.click(check(p.zones.readEmpty));
    await settle();
    draw(...LEFT_BOX);
    fireEvent.click(button(p.save.export));
    const [data, name, type] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(name).toBe('artikel_instellingen.json');
    expect(type).toBe('application/json');
    const saved = JSON.parse(new TextDecoder().decode(data as Uint8Array));
    expect(saved).toMatchObject({
      v: 2,
      pdf: 'artikel.pdf',
      zones: { d: [expect.any(Object)], p: {} },
      options: { useCrop: true, readEmpty: true, paraGap: '1.3', strip: true },
    });
    expect(screen.getByText(format(p.save.exported, { name }))).toBeTruthy();
  });

  it('laadt een instellingenbestand van de extractor, en dat kan ongedaan', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...RIGHT_BOX);
    const zone = { x0: 0.05, y0: 0.1, x1: 0.5, y1: 0.3 };
    await loadSettings(
      json('artikel_instellingen.json', {
        v: 2,
        pdf: 'artikel.pdf',
        zones: { d: [zone], p: { '3': [] } },
        options: { useCrop: true, paraGap: '1.6', readEmpty: true, tables: true },
      }),
    );
    expect(
      screen.getByText(format(p.save.imported, { name: 'artikel_instellingen.json' })),
    ).toBeTruthy();
    expect(getTextState().zones).toEqual([zone]);
    expect(getTextState().pages).toEqual({ 3: [] });
    expect(check(p.zones.readEmpty).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('slider', { name: p.settings.gap }).value).toBe(
      '1.6',
    );
    // Wat deze tool nog niet kent, gaat mee bij opslaan.
    fireEvent.click(button(p.save.export));
    const [data] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(JSON.parse(new TextDecoder().decode(data as Uint8Array)).options.tables).toBe(true);
    // Ongedaan: de vakken van daarvoor terug.
    fireEvent.click(button(p.zones.undo));
    expect(getTextState().zones).toHaveLength(1);
    expect(getTextState().zones[0]).not.toEqual(zone);
  });

  it('een bestand dat geen instellingen bevat, verandert niets', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...RIGHT_BOX);
    const before = getTextState().zones;
    await loadSettings(json('kapot.json', '{niet goed'));
    expect(screen.getByText(format(p.save.importFailed, { name: 'kapot.json' }))).toBeTruthy();
    await loadSettings(json('lijst.json', [1, 2, 3]));
    expect(screen.getByText(format(p.save.importFailed, { name: 'lijst.json' }))).toBeTruthy();
    expect(getTextState().zones).toBe(before);
  });

  it('ander JSON (zoals de database van Slim hernoemen): niets verandert, met een melding', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...RIGHT_BOX);
    setJoin(2, 'join');
    const before = getTextState();
    const remembered = localStorage.getItem(`${SETTINGS_PREFIX}artikel.pdf`);
    await loadSettings(json('pdf-hernoemer-database.json', { afzenders: [], onderwerpen: [] }));
    expect(screen.getByRole('alert').textContent).toBe(
      format(p.save.importFailed, { name: 'pdf-hernoemer-database.json' }),
    );
    expect(getTextState().zones).toBe(before.zones);
    expect(getTextState().joins).toBe(before.joins);
    expect(getTextState().undo).toBe(before.undo);
    expect(localStorage.getItem(`${SETTINGS_PREFIX}artikel.pdf`)).toBe(remembered);
    // Een goed bestand daarna: de melding is geen waarschuwing meer.
    await loadSettings(json('goed.json', { options: { dehyphen: false } }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(format(p.save.imported, { name: 'goed.json' }))).toBeTruthy();
  });

  it('Ongedaan na laden haalt ook de keuzes per overgang terug; bij vakken blijven ze staan', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...RIGHT_BOX);
    setJoin(2, 'join');
    await loadSettings(
      json('ander.json', { zones: { d: [] }, joinOverride: { 3: 'break' }, options: {} }),
    );
    expect(getTextState().joins).toEqual({ 3: 'break' });
    expect(getTextState().zones).toEqual([]);
    fireEvent.click(button(p.zones.undo));
    expect(getTextState().joins).toEqual({ 2: 'join' });
    expect(getTextState().zones).toHaveLength(1);
    // Een vak tekenen en weer ongedaan maken: de keuze per overgang van daarna blijft.
    draw(...LEFT_BOX);
    setJoin(3, 'break');
    fireEvent.click(button(p.zones.undo));
    expect(getTextState().zones).toHaveLength(1);
    expect(getTextState().joins).toEqual({ 2: 'join', 3: 'break' });
  });

  it('opslaan en laden kan pas met een PDF', () => {
    setup();
    expect(button(p.save.export).disabled).toBe(true);
    expect(button(p.save.import).disabled).toBe(true);
    expect(button(p.save.forget).disabled).toBe(false);
  });

  it('vergeten vraagt eerst; annuleren laat alles staan', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.settings.dehyphen));
    localStorage.setItem('nondumscio:lang', 'nl');
    expect(stored()).toHaveLength(1);

    fireEvent.click(button(p.save.forget));
    const dialog = screen.getByRole('dialog', { name: p.save.forgetTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: p.save.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stored()).toHaveLength(1);

    fireEvent.click(button(p.save.forget));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: p.save.forgetConfirm }),
    );
    expect(screen.getByText(p.save.forgottenOne)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(stored()).toEqual([]);
    expect(localStorage.getItem('nondumscio:lang')).toBe('nl');
    // Wat open staat, blijft staan.
    expect(check(p.settings.dehyphen).checked).toBe(false);

    fireEvent.click(button(p.save.forget));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: p.save.forgetConfirm }),
    );
    expect(screen.getByText(p.save.forgottenNone)).toBeTruthy();
  });

  it('standaardinstellingen: na een vraag alle opties terug, de vakken en velden blijven', async () => {
    await open('brief.pdf');
    const s = p.settings;
    const v = p.save;
    // Alles anders dan de standaard.
    for (const name of [s.dehyphen, s.columns, s.strip, s.structure, s.tables, p.pages.anchors])
      fireEvent.click(check(name));
    fireEvent.click(check(p.header.use));
    fireEvent.click(check(p.header.conventions));
    fireEvent.click(check(p.zones.use));
    fireEvent.click(check(p.zones.readEmpty));
    fireEvent.input(screen.getByRole('slider', { name: s.gap }), { target: { value: '2.2' } });
    fireEvent.input(screen.getByRole('textbox', { name: p.header.fields.title }), {
      target: { value: 'Eigen titel' },
    });
    await settle();
    draw(...LEFT_BOX);
    fireEvent.click(button(p.extract));
    expect(getTextState().options).not.toEqual(DEFAULT_TEXT_OPTIONS);

    // Annuleren laat alles staan.
    fireEvent.click(button(v.defaults));
    const dialog = screen.getByRole('dialog', { name: v.defaultsTitle });
    fireEvent.click(within(dialog).getByRole('button', { name: v.cancel }));
    expect(check(s.dehyphen).checked).toBe(false);

    fireEvent.click(button(v.defaults));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: v.defaultsConfirm }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(v.defaultsDone)).toBeTruthy();
    expect(getTextState().options).toEqual(DEFAULT_TEXT_OPTIONS);
    expect(getTextState().readEmpty).toBe(false);
    expect(check(s.dehyphen).checked).toBe(true);
    expect(check(p.header.use).checked).toBe(false);
    expect(screen.getByRole<HTMLInputElement>('slider', { name: s.gap }).value).toBe('1.3');
    // De vakken, de leesvakken zelf en de velden blijven; de tekst is niet meer bij.
    expect(check(p.zones.use).checked).toBe(true);
    expect(getTextState().zones).toHaveLength(1);
    expect(getTextState().meta.title).toBe('Eigen titel');
    expect(getTextState().stale).toBe(true);
    // En zo onthouden voor deze PDF.
    fireEvent.click(button(p.clear));
    choose('brief.pdf');
    await waitFor(() => expect(screen.getByText(/instellingen hersteld/)).toBeTruthy());
    expect(getTextState().options).toEqual(DEFAULT_TEXT_OPTIONS);
  });

  it('meldt hoeveel PDF’s er vergeten zijn', async () => {
    localStorage.setItem(`${SETTINGS_PREFIX}a.pdf`, '{}');
    localStorage.setItem(`${SETTINGS_PREFIX}b.pdf`, '{}');
    setup();
    fireEvent.click(button(p.save.forget));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: p.save.forgetConfirm }),
    );
    expect(screen.getByText(format(p.save.forgotten, { n: 2 }))).toBeTruthy();
  });
});

describe('PDF → Platte tekst: opsommingen, koppen en tabellen', () => {
  const s = p.settings;

  it('staan zoals in de extractor: opsommingen en koppen aan, {H} en tabellen uit', async () => {
    await open('contract.pdf');
    expect(check(s.structure).checked).toBe(true);
    expect(check(s.headingMarker).checked).toBe(false);
    expect(check(s.tables).checked).toBe(false);
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe(
      'Partijen komen het volgende overeen over de woning aan de straat.\n\n\nArtikel 1 Huurprijs\n\nDe huur bedraagt vijfhonderd euro per maand, vooraf te betalen.',
    );
  });

  it('{H} vóór een kop, en zonder opsommingen en koppen loopt de tekst door', async () => {
    await open('contract.pdf');
    fireEvent.click(check(s.headingMarker));
    fireEvent.click(button(p.extract));
    expect(output()!.value).toContain('\n\n\n{H} Artikel 1 Huurprijs\n\n');
    fireEvent.click(check(s.structure));
    expect(check(s.headingMarker).disabled).toBe(true);
    fireEvent.click(button(p.extract));
    expect(output()!.value!.split('\n\n')).toHaveLength(1);
  });

  it('wanneer een vinkje niets doet, staat het uit', async () => {
    await open('contract.pdf');
    // Tabellen: dan geen kolommen.
    fireEvent.click(check(s.tables));
    expect(check(s.columns).disabled).toBe(true);
    fireEvent.click(check(s.tables));
    expect(check(s.columns).disabled).toBe(false);
    // Zonder samenvoegen: geen opsommingen, koppen of tabellen.
    fireEvent.click(check(s.joinLines));
    for (const name of [s.structure, s.headingMarker, s.tables])
      expect(check(name).disabled).toBe(true);
    fireEvent.click(check(s.joinLines));
    expect(check(s.structure).disabled).toBe(false);
    expect(check(s.headingMarker).disabled).toBe(false);
  });

  it('worden onthouden en opgeslagen', async () => {
    await open('contract.pdf');
    fireEvent.click(check(s.tables));
    fireEvent.click(check(s.headingMarker));
    fireEvent.click(button(p.save.export));
    const [data] = vi.mocked(downloadFile).mock.calls[0]!;
    expect(JSON.parse(new TextDecoder().decode(data as Uint8Array)).options).toMatchObject({
      structure: true,
      headingMarker: true,
      tables: true,
    });
    fireEvent.click(button(p.clear));
    fireEvent.click(check(s.tables));
    choose('contract.pdf');
    await waitFor(() => expect(screen.getByText(/instellingen hersteld/)).toBeTruthy());
    expect(check(s.tables).checked).toBe(true);
  });
});

describe('PDF → Platte tekst: pagina-overgangen', () => {
  const g = p.pages;
  /** De standaard terug (de tests hierboven zetten ankers en doorlopende zinnen uit). */
  beforeEach(() => setOptions({ anchors: true, crossPage: true }));

  it('standaard: {p#} vóór elke pagina, de zin loopt door, en de concordantie onderaan', async () => {
    await open('boek.pdf');
    expect(check(g.anchors).checked).toBe(true);
    expect(check(g.crossPage).checked).toBe(true);
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe(
      [
        '{p1} De titel van het boek.',
        '',
        '{p2} Het voorwoord van het boek.',
        '',
        '{p3} En dan loopt de zin door op de {p4} volgende pagina en eindigt hier.',
        '',
        '---',
        'Paginaconcordantie:',
        'PDF-pagina 1 = geen documentpaginanummer (titelblad)',
        'PDF-pagina 2 = documentpagina 1',
        'PDF-pagina 3 = documentpagina 2',
        'PDF-pagina 4 = documentpagina 3',
      ].join('\n'),
    );
  });

  it('zonder ankers en doorlopende zinnen: zoals eerst', async () => {
    await open('boek.pdf');
    fireEvent.click(check(g.anchors));
    fireEvent.click(check(g.crossPage));
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe(
      'De titel van het boek.\n\nHet voorwoord van het boek.\n\nEn dan loopt de zin door op de\n\nvolgende pagina en eindigt hier.',
    );
  });

  it('per overgang: aaneen of gescheiden, en weer automatisch', async () => {
    await open('boek.pdf');
    fireEvent.click(check(g.anchors));
    // Op pagina 1 valt er niets te kiezen.
    expect(screen.getByText(g.joinFirst)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(button(p.preview.last));
    const select = screen.getByRole<HTMLSelectElement>('combobox', {
      name: format(g.join, { n: 4 }),
    });
    expect(select.value).toBe('auto');
    fireEvent.change(select, { target: { value: 'break' } });
    expect(getTextState().joins).toEqual({ 4: 'break' });
    fireEvent.click(button(p.extract));
    expect(output()!.value).toContain('op de\n\nvolgende pagina');
    // Pagina 2 aaneen met pagina 1.
    fireEvent.click(button(p.views.preview));
    fireEvent.click(button(p.preview.first));
    fireEvent.click(button(p.preview.next));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'join' } });
    fireEvent.click(button(p.extract));
    expect(output()!.value!.startsWith('De titel van het boek. Het voorwoord')).toBe(true);
    // Terug naar automatisch: de keuze verdwijnt.
    fireEvent.click(button(p.views.preview));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'auto' } });
    expect(getTextState().joins).toEqual({ 4: 'break' });
    // Zonder doorlopende alinea's geen keuze.
    fireEvent.click(check(g.crossPage));
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(g.joinFirst)).toBeNull();
  });

  it('de keuzes per overgang worden onthouden en opgeslagen', async () => {
    await open('boek.pdf');
    fireEvent.click(button(p.preview.last));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'break' } });
    fireEvent.click(button(p.save.export));
    const [data] = vi.mocked(downloadFile).mock.calls[0]!;
    const saved = JSON.parse(new TextDecoder().decode(data as Uint8Array));
    expect(saved.joinOverride).toEqual({ 4: 'break' });
    expect(saved.options).toMatchObject({ anchors: true, crossPage: true });
    fireEvent.click(button(p.clear));
    choose('boek.pdf');
    await waitFor(() => expect(screen.getByText(/instellingen hersteld/)).toBeTruthy());
    expect(getTextState().joins).toEqual({ 4: 'break' });
  });

  it('een andere PDF begint zonder keuzes per overgang', async () => {
    await open('boek.pdf');
    fireEvent.click(button(p.preview.last));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'break' } });
    expect(getTextState().joins).toEqual({ 4: 'break' });
    choose('brief.pdf');
    await waitFor(() =>
      expect(screen.getByText(format(p.preview.page, { n: 1, total: 1 }))).toBeTruthy(),
    );
    expect(getTextState().joins).toEqual({});
  });

  it('het afgedrukte paginanummer staat in de balk', async () => {
    await open('boek.pdf');
    const bar = () => document.querySelector<HTMLElement>('.plaintext-nav__page')!;
    expect(bar().textContent).toContain('1 / 4');
    expect(document.querySelector('.plaintext-nav__printed')).toBeNull();
    fireEvent.click(button(p.preview.next));
    expect(within(bar()).getByText('· 1', { exact: false })).toBeTruthy();
    expect(screen.getByText(format(p.preview.pageDoc, { n: 2, total: 4, p: '1' }))).toBeTruthy();
  });

  it('de concordantie in de taal van de app', async () => {
    render(
      <LanguageProvider initial="en">
        <TextTool />
      </LanguageProvider>,
    );
    choose('boek.pdf');
    const en = messages.en.plainText;
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: en.extract }).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: en.extract }));
    expect(output()!.value).toContain(
      '---\nPage concordance:\nPDF page 1 = no document page number (title page)\nPDF page 2 = document page 1',
    );
  });
});

describe('PDF → Platte tekst: documentkop en metadata', () => {
  const h = p.header;
  const f = h.fields;
  const field = (name: string) => screen.getByRole<HTMLInputElement>('textbox', { name });
  const type = (name: string, value: string) => fireEvent.input(field(name), { target: { value } });
  const HEADER = [
    'Bestand: brief.pdf',
    'Titel: Nieuwe huurovereenkomst',
    'Auteur: Woningstichting Voorbeeld',
    'Onderwerp: Huur',
    'Datum: 2018-06-04',
  ].join('\n');

  it('vult de velden met de gegevens uit de PDF; zonder PDF staan ze uit', async () => {
    setup();
    for (const name of [f.title, f.author, f.subject, f.date]) {
      expect(field(name).disabled).toBe(true);
      expect(field(name).value).toBe('');
    }
    expect(check(h.use).checked).toBe(false);
    expect(check(h.conventions).checked).toBe(false);
    choose('brief.pdf');
    await waitFor(() => expect(field(f.title).value).toBe('Nieuwe huurovereenkomst'));
    expect(field(f.title).disabled).toBe(false);
    expect(field(f.author).value).toBe('Woningstichting Voorbeeld');
    expect(field(f.subject).value).toBe('Huur');
    expect(field(f.date).value).toBe('2018-06-04');
    expect(screen.getByText('PDF-producent (Producer): Voorbeeld PDF 2.0')).toBeTruthy();
    expect(screen.getByText('Toepassing (Creator): Tekstverwerker')).toBeTruthy();
  });

  it('een PDF zonder gegevens: lege velden, en geen Producer of Creator', async () => {
    await open('kort.pdf');
    for (const name of [f.title, f.author, f.subject, f.date]) {
      expect(field(name).value).toBe('');
      expect(field(name).disabled).toBe(false);
    }
    expect(screen.queryByText(/Producer/)).toBeNull();
    expect(screen.queryByText(/Creator/)).toBeNull();
  });

  it('de kop staat bovenaan de tekst, pas na opnieuw extraheren, met de velden zoals ze staan', async () => {
    await open('brief.pdf');
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe(LETTER_TEXT);
    fireEvent.click(check(h.use));
    expect(screen.getByText(p.stale)).toBeTruthy();
    expect(output()!.value).toBe(LETTER_TEXT);
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe(`${HEADER}\n\n${LETTER_TEXT}`);
    // Een aangepast veld, en een leeg veld valt weg; ook dat pas bij opnieuw extraheren.
    type(f.title, 'Huurcontract');
    type(f.subject, '');
    expect(getTextState().meta).toEqual({
      title: 'Huurcontract',
      author: 'Woningstichting Voorbeeld',
      subject: '',
      date: '2018-06-04',
    });
    expect(screen.getByText(p.stale)).toBeTruthy();
    fireEvent.click(button(p.extract));
    expect(output()!.value).toBe(
      `Bestand: brief.pdf\nTitel: Huurcontract\nAuteur: Woningstichting Voorbeeld\nDatum: 2018-06-04\n\n${LETTER_TEXT}`,
    );
  });

  it('het conventieblok staat vóór de kop; met {H} ook de regel over {H}', async () => {
    await open('contract.pdf');
    fireEvent.click(check(h.conventions));
    fireEvent.click(button(p.extract));
    const text = () => output()!.value!;
    // Zonder pagina-ankers (zie beforeEach) geen regels over {p#} en de concordantie.
    expect(text()).toBe(
      [
        '=== Conventies ===',
        'Platte tekst geëxtraheerd uit een PDF; opmaak en afbeeldingen zijn weggelaten.',
        '==================',
        '',
        'Partijen komen het volgende overeen over de woning aan de straat.',
        '',
        '',
        'Artikel 1 Huurprijs',
        '',
        'De huur bedraagt vijfhonderd euro per maand, vooraf te betalen.',
      ].join('\n'),
    );
    fireEvent.click(check(p.settings.headingMarker));
    fireEvent.click(check(h.use));
    fireEvent.click(button(p.extract));
    expect(text()).toContain(
      `\n${p.conventions.heading}\n==================\n\nBestand: contract.pdf\n\nPartijen komen`,
    );
    expect(text()).toContain('\n{H} Artikel 1 Huurprijs\n');
  });

  it('de velden horen bij de PDF: Wissen maakt ze leeg, een andere PDF vult ze; de vinkjes blijven', async () => {
    await open('brief.pdf');
    fireEvent.click(check(h.use));
    fireEvent.click(check(h.conventions));
    type(f.title, 'Eigen titel');
    fireEvent.click(button(p.clear));
    expect(field(f.title).value).toBe('');
    expect(field(f.title).disabled).toBe(true);
    expect(check(h.use).checked).toBe(true);
    expect(check(h.conventions).checked).toBe(true);
    expect(screen.queryByText(/Producer/)).toBeNull();
    choose('tweede.pdf');
    await waitFor(() => expect(field(f.title).value).toBe('De tweede'));
    expect(field(f.author).value).toBe('');
    expect(field(f.date).value).toBe('2020-05-01');
  });

  it('worden onthouden en opgeslagen; onthouden velden gaan voor die uit de PDF', async () => {
    await open('brief.pdf');
    fireEvent.click(check(h.use));
    type(f.title, 'Eigen titel');
    fireEvent.click(button(p.save.export));
    const [data] = vi.mocked(downloadFile).mock.calls[0]!;
    const saved = JSON.parse(new TextDecoder().decode(data as Uint8Array));
    expect(saved.options).toMatchObject({ metaHeader: true, conventions: false });
    expect(saved.meta).toEqual({
      title: 'Eigen titel',
      author: 'Woningstichting Voorbeeld',
      subject: 'Huur',
      date: '2018-06-04',
    });
    fireEvent.click(button(p.clear));
    fireEvent.click(check(h.use));
    expect(check(h.use).checked).toBe(false);
    choose('brief.pdf');
    await waitFor(() => expect(screen.getByText(/instellingen hersteld/)).toBeTruthy());
    expect(field(f.title).value).toBe('Eigen titel');
    expect(field(f.author).value).toBe('Woningstichting Voorbeeld');
    expect(check(h.use).checked).toBe(true);
  });

  it('onthouden instellingen zonder gegevens (van vóór de documentkop): de velden uit de PDF', async () => {
    localStorage.setItem(
      `${SETTINGS_PREFIX}brief.pdf`,
      JSON.stringify({
        v: 2,
        pdf: 'brief.pdf',
        zones: { d: [], p: {} },
        options: { dehyphen: false },
      }),
    );
    await open('brief.pdf');
    expect(screen.getByText(/instellingen hersteld/)).toBeTruthy();
    expect(check(p.settings.dehyphen).checked).toBe(false);
    expect(field(f.title).value).toBe('Nieuwe huurovereenkomst');
    expect(field(f.date).value).toBe('2018-06-04');
  });

  it('een onthouden datum in de vorm van eerder ("4 juni 2018") wordt ISO; een eigen datum blijft', async () => {
    const stored = (date: string) =>
      localStorage.setItem(
        `${SETTINGS_PREFIX}brief.pdf`,
        JSON.stringify({
          v: 2,
          pdf: 'brief.pdf',
          meta: { title: 'Eigen titel', author: '', subject: '', date },
        }),
      );
    stored('4 juni 2018');
    await open('brief.pdf');
    expect(field(f.date).value).toBe('2018-06-04');
    expect(field(f.title).value).toBe('Eigen titel');
    cleanup();
    stored('4 June 2018');
    await open('brief.pdf');
    expect(field(f.date).value).toBe('2018-06-04');
    cleanup();
    stored('begin juni');
    await open('brief.pdf');
    expect(field(f.date).value).toBe('begin juni');
    // Ook uit een instellingenbestand van de extractor.
    await loadSettings(
      json('brief_instellingen.json', {
        v: 2,
        meta: { title: '', author: '', subject: '', date: '4 juni 2018' },
      }),
    );
    expect(field(f.date).value).toBe('2018-06-04');
  });

  it('een instellingenbestand van de extractor zet ook de velden en de vinkjes', async () => {
    await open('brief.pdf');
    await loadSettings(
      json('brief_instellingen.json', {
        v: 2,
        pdf: 'brief.pdf',
        zones: { d: [], p: {} },
        options: { metaHeader: true, conventions: true },
        meta: { title: 'Uit het bestand', author: '', subject: 'Huur', date: '5 juni 2018' },
      }),
    );
    expect(check(h.use).checked).toBe(true);
    expect(check(h.conventions).checked).toBe(true);
    expect(field(f.title).value).toBe('Uit het bestand');
    expect(field(f.author).value).toBe('');
    expect(field(f.date).value).toBe('5 juni 2018');
  });

  it('bladeren met de toetsen gebeurt niet terwijl je in een veld typt', async () => {
    await open('artikel.pdf');
    fireEvent.keyDown(field(f.title), { key: 'ArrowRight' });
    expect(getTextState().page).toBe(1);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(getTextState().page).toBe(2);
  });

  it('een PDF zonder enige tekst: ook geen kop, en niets te kopiëren', async () => {
    await open('leeg.pdf');
    fireEvent.click(check(h.use));
    fireEvent.click(check(h.conventions));
    fireEvent.click(button(p.extract));
    expect(output()).toBeNull();
    expect(screen.getByText(p.empty)).toBeTruthy();
    expect(button(p.copy).disabled).toBe(true);
    expect(getTextState().result!.text).toBe('');
  });

  it('in de taal van de app: de datum, de kop en het conventieblok', async () => {
    render(
      <LanguageProvider initial="en">
        <TextTool />
      </LanguageProvider>,
    );
    choose('brief.pdf');
    const en = messages.en.plainText;
    await waitFor(() => expect(field(en.header.fields.date).value).toBe('2018-06-04'));
    fireEvent.click(screen.getByRole('checkbox', { name: en.header.use }));
    fireEvent.click(screen.getByRole('checkbox', { name: en.header.conventions }));
    fireEvent.click(screen.getByRole('button', { name: en.extract }));
    expect(output()!.value).toBe(
      [
        '=== Conventions ===',
        en.conventions.intro,
        '===================',
        '',
        'File: brief.pdf',
        'Title: Nieuwe huurovereenkomst',
        'Author: Woningstichting Voorbeeld',
        'Subject: Huur',
        'Date: 2018-06-04',
        '',
        LETTER_TEXT,
      ].join('\n'),
    );
    expect(screen.getByText('PDF producer (Producer): Voorbeeld PDF 2.0')).toBeTruthy();
    expect(screen.getByText('Application (Creator): Tekstverwerker')).toBeTruthy();
  });
});

describe('PDF → Platte tekst: batch', () => {
  const b = p.batch;
  /** PDF's onderaan de lijst van de batch zetten, zoals met de knop of door te slepen. */
  const add = (...names: string[]) =>
    fireEvent.change(document.querySelector('#plaintext-batch-files')!, {
      target: { files: names.map(pdf) },
    });
  const run = () => fireEvent.click(document.querySelector('.plaintext-batch__run')!);
  /** Een nieuwe lijst met deze PDF's, de batch starten, en wachten tot hij klaar is. */
  async function batch(...names: string[]) {
    act(() => clearBatchFiles());
    add(...names);
    run();
    await waitFor(() => expect(getTextState().batch.status).toBe('done'));
  }
  const listed = () =>
    [...document.querySelectorAll('.plaintext-batch-list .merge-list__name')].map(
      (el) => el.textContent,
    );
  const message = () => document.querySelector('.plaintext-batch__message')!.textContent;
  /** De bestanden in de gedownloade ZIP, als tekst. */
  async function zipped() {
    const [data, name, type] = vi.mocked(downloadFile).mock.calls.at(-1)!;
    expect(name).toBe('batch_extract.zip');
    expect(type).toBe('application/zip');
    const files = unzipSync(new Uint8Array(await (data as Blob).arrayBuffer()));
    return Object.fromEntries(
      Object.entries(files).map(([file, bytes]) => [file, new TextDecoder().decode(bytes)]),
    );
  }

  it('het blok staat dicht, met Combineer uit; het werkt ook zonder open PDF', async () => {
    setup();
    const block = screen.getByText(b.title, { selector: 'summary' }).closest('details')!;
    expect(block.open).toBe(false);
    expect(check(b.combine).checked).toBe(false);
    // Een lege lijst: niets te extraheren.
    expect(screen.getByText(b.empty)).toBeTruthy();
    expect(button(b.run).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: b.clearList })).toBeNull();
    await batch('brief.pdf', 'tweede.pdf');
    expect(Object.keys(await zipped())).toEqual(['brief_extract.txt', 'tweede_extract.txt']);
  });

  it('als zip: per PDF een .txt; een kapotte PDF wordt overgeslagen en genoemd', async () => {
    setup();
    await batch('brief.pdf', 'kapot.pdf', 'tweede.pdf');
    expect(await zipped()).toEqual({
      'brief_extract.txt': LETTER_TEXT,
      'tweede_extract.txt': 'De tweede PDF.',
    });
    expect(message()).toBe(
      `${format(b.doneZip, { ok: 2, failed: format(b.failedCount, { n: 1 }) })} ${format(b.downloaded, { name: 'batch_extract.zip' })}` +
        format(b.failed, { list: `kapot.pdf: ${b.reasons.damaged}` }),
    );
    // Zonder plaatje: dat is voor een batch niet nodig.
    expect(readPdf).toHaveBeenCalledWith(expect.any(File), expect.any(Function), { thumb: false });
  });

  it('met de kop en het conventieblok per PDF, met de gegevens van die PDF', async () => {
    setOptions({ header: true, conventions: true });
    setup();
    await batch('brief.pdf');
    const text = (await zipped())['brief_extract.txt']!;
    expect(text).toBe(
      [
        '=== Conventies ===',
        p.conventions.intro,
        '==================',
        '',
        'Bestand: brief.pdf',
        'Titel: Nieuwe huurovereenkomst',
        'Auteur: Woningstichting Voorbeeld',
        'Onderwerp: Huur',
        'Datum: 2018-06-04',
        '',
        LETTER_TEXT,
      ].join('\n'),
    );
  });

  it('gelijke namen: allemaal een volgnummer; een mislukte houdt het zijne', async () => {
    DOCS['Brief.PDF'] = DOCS['brief.pdf']!;
    setup();
    await batch('brief.pdf', 'Brief.PDF', 'tweede.pdf');
    expect(Object.keys(await zipped())).toEqual([
      'brief_extract (01).txt',
      'Brief_extract (02).txt',
      'tweede_extract.txt',
    ]);
    // Een mislukte met dezelfde naam: het nummer valt weg in de zip, de melding noemt het.
    DOCS['dubbel.pdf'] = DOCS['brief.pdf']!;
    vi.mocked(readPdf).mockImplementationOnce(async () => {
      throw new PdfLoadError('password');
    });
    await batch('dubbel.pdf', 'dubbel.pdf');
    expect(Object.keys(await zipped())).toEqual(['dubbel_extract (02).txt']);
    expect(message()).toContain(
      format(b.failed, { list: `dubbel.pdf (01): ${b.reasons.password}` }),
    );
    delete DOCS['Brief.PDF'];
    delete DOCS['dubbel.pdf'];
  });

  it('in één bestand: "Bestand N start/einde" om elk document, het nummer is de plek in de keuze', async () => {
    setOptions({ conventions: true });
    setup();
    fireEvent.click(check(b.combine));
    await batch('kapot.pdf', 'brief.pdf', 'scan.pdf');
    const [data, name, type] = vi.mocked(downloadFile).mock.calls.at(-1)!;
    expect(name).toBe('batch_extract.txt');
    expect(type).toBe('text/plain;charset=utf-8');
    expect(new TextDecoder().decode(data as Uint8Array)).toBe(
      [
        '=== Conventies ===',
        p.conventions.intro,
        p.conventions.files,
        '==================',
        '',
        'Bestand 2 start: brief.pdf',
        'Titel: Nieuwe huurovereenkomst',
        'Auteur: Woningstichting Voorbeeld',
        'Onderwerp: Huur',
        'Datum: 2018-06-04',
        '',
        LETTER_TEXT,
        '',
        'Bestand 2 einde: brief.pdf',
        '',
        'Bestand 3 start: scan.pdf',
        '',
        'Alleen hier staat een hele zin met tekst.',
        '',
        'Bestand 3 einde: scan.pdf',
      ].join('\n'),
    );
    expect(message()).toContain(
      format(b.doneCombined, { ok: 2, failed: format(b.failedCount, { n: 1 }) }),
    );
  });

  it('een PDF zonder tekstlaag: een leeg bestand in de zip, en de melding noemt hem', async () => {
    setup();
    await batch('brief.pdf', 'leeg.pdf');
    expect(await zipped()).toEqual({ 'brief_extract.txt': LETTER_TEXT, 'leeg_extract.txt': '' });
    expect(message()).toContain(format(b.noText, { list: 'leeg.pdf' }));
  });

  it('niets bruikbaars: geen download, alleen de melding', async () => {
    setup();
    await batch('leeg.pdf');
    expect(downloadFile).not.toHaveBeenCalled();
    expect(message()).toContain(b.nothing);
    await batch('kapot.pdf', 'geheim.pdf');
    expect(downloadFile).not.toHaveBeenCalled();
    expect(message()).toContain(b.nothingRead);
    expect(message()).toContain(
      format(b.failed, {
        list: `kapot.pdf: ${b.reasons.damaged}; geheim.pdf: ${b.reasons.password}`,
      }),
    );
  });

  it('een te grote zip: niets gedownload, met een melding', async () => {
    zip.tiny = true;
    try {
      setup();
      await batch('brief.pdf');
      expect(downloadFile).not.toHaveBeenCalled();
      expect(message()).toContain(b.tooLarge);
    } finally {
      zip.tiny = false;
    }
  });

  it('tijdens het verwerken: de voortgang met de pagina, en de knop staat uit', async () => {
    let release!: () => void;
    gates['artikel.pdf'] = new Promise((resolve) => (release = resolve));
    setup();
    add('brief.pdf', 'artikel.pdf');
    run();
    await waitFor(() =>
      expect(
        screen.getByText(
          format(b.readingPage, { i: 2, n: 2, name: 'artikel.pdf', page: 0, pages: 3 }),
        ),
      ).toBeTruthy(),
    );
    expect(button(b.run).disabled).toBe(true);
    expect(button(b.clearList).disabled).toBe(true);
    expect(button(format(messages.nl.merge.remove, { name: 'brief.pdf' })).disabled).toBe(true);
    // Nog een batch beginnen doet niets zolang hij bezig is; de lijst blijft zoals hij was.
    await runBatch();
    act(() => clearBatchFiles());
    act(() => moveBatchFile(getTextState().batchFiles[0]!.id, 1));
    act(() => removeBatchFile(getTextState().batchFiles[0]!.id));
    expect(readPdf).toHaveBeenCalledTimes(2);
    expect(listed()).toEqual(['brief.pdf', 'artikel.pdf']);
    release();
    await waitFor(() => expect(getTextState().batch.status).toBe('done'));
    expect(button(b.run).disabled).toBe(false);
    expect(Object.keys(await zipped())).toEqual(['brief_extract.txt', 'artikel_extract.txt']);
    expect(downloadFile).toHaveBeenCalledTimes(1);
  });

  it('eerst een lijst: toevoegen, ook meerdere keren en dezelfde PDF; pas extraheren na de knop', async () => {
    setup();
    add('brief.pdf', 'tweede.pdf');
    add('artikel.pdf', 'brief.pdf');
    expect(listed()).toEqual(['brief.pdf', 'tweede.pdf', 'artikel.pdf', 'brief.pdf']);
    expect(readPdf).not.toHaveBeenCalled();
    expect(downloadFile).not.toHaveBeenCalled();
    expect(button(b.run).disabled).toBe(false);
    run();
    await waitFor(() => expect(getTextState().batch.status).toBe('done'));
    expect(Object.keys(await zipped())).toEqual([
      'brief_extract (01).txt',
      'tweede_extract.txt',
      'artikel_extract.txt',
      'brief_extract (02).txt',
    ]);
    // De lijst blijft staan, voor nog een keer met andere instellingen.
    expect(listed()).toEqual(['brief.pdf', 'tweede.pdf', 'artikel.pdf', 'brief.pdf']);
  });

  it('de volgorde: omhoog, omlaag en weghalen, en de batch volgt de lijst', async () => {
    setup();
    add('brief.pdf', 'tweede.pdf', 'artikel.pdf');
    const m = messages.nl.merge;
    expect(button(format(m.moveUp, { name: 'brief.pdf' })).disabled).toBe(true);
    expect(button(format(m.moveDown, { name: 'artikel.pdf' })).disabled).toBe(true);
    fireEvent.click(button(format(m.moveUp, { name: 'artikel.pdf' })));
    expect(listed()).toEqual(['brief.pdf', 'artikel.pdf', 'tweede.pdf']);
    fireEvent.click(button(format(m.moveDown, { name: 'brief.pdf' })));
    expect(listed()).toEqual(['artikel.pdf', 'brief.pdf', 'tweede.pdf']);
    fireEvent.click(button(format(m.remove, { name: 'tweede.pdf' })));
    expect(listed()).toEqual(['artikel.pdf', 'brief.pdf']);
    fireEvent.click(check(b.combine));
    run();
    await waitFor(() => expect(getTextState().batch.status).toBe('done'));
    const [data] = vi.mocked(downloadFile).mock.calls.at(-1)!;
    const text = new TextDecoder().decode(data as Uint8Array);
    expect(text.indexOf('Bestand 1 start: artikel.pdf')).toBe(0);
    expect(text).toContain('Bestand 2 start: brief.pdf');
    expect(text).not.toContain('tweede.pdf');
    fireEvent.click(button(b.clearList));
    expect(listed()).toEqual([]);
    expect(screen.getByText(b.empty)).toBeTruthy();
  });

  it('slepen: een PDF naar een andere plek (de plek vóór het onderdeel, of onderaan)', () => {
    setup();
    add('a.pdf', 'b.pdf', 'c.pdf', 'd.pdf');
    const id = (name: string) =>
      getTextState().batchFiles.find((entry) => entry.file.name === name)!.id;
    act(() => moveBatchFileTo(id('c.pdf'), 0));
    expect(listed()).toEqual(['c.pdf', 'a.pdf', 'b.pdf', 'd.pdf']);
    act(() => moveBatchFileTo(id('c.pdf'), 4));
    expect(listed()).toEqual(['a.pdf', 'b.pdf', 'd.pdf', 'c.pdf']);
    act(() => moveBatchFileTo(id('a.pdf'), 3));
    expect(listed()).toEqual(['b.pdf', 'd.pdf', 'a.pdf', 'c.pdf']);
    // Op dezelfde plek loslaten verandert niets.
    act(() => moveBatchFileTo(id('d.pdf'), 1));
    act(() => moveBatchFileTo(id('d.pdf'), 2));
    expect(listed()).toEqual(['b.pdf', 'd.pdf', 'a.pdf', 'c.pdf']);
  });

  it('een veranderde lijst haalt de melding van de vorige batch weg', async () => {
    setup();
    await batch('brief.pdf');
    expect(document.querySelector('.plaintext-batch__message')).not.toBeNull();
    add('tweede.pdf');
    expect(document.querySelector('.plaintext-batch__message')).toBeNull();
  });

  it('raakt de open PDF niet, onthoudt niets, en Combineer blijft staan bij Wissen', async () => {
    await open('artikel.pdf');
    fireEvent.click(check(p.zones.use));
    await settle();
    draw(...LEFT_BOX);
    fireEvent.click(button(p.extract));
    const before = getTextState();
    localStorage.clear();
    fireEvent.click(check(b.combine));
    // Met leesvakken aan: de uitleg dat kolommen en kop/voet in de batch toch meedoen.
    expect(screen.getByText(b.zonesHint)).toBeTruthy();
    await batch('brief.pdf');
    const after = getTextState();
    expect(after.slot).toBe(before.slot);
    expect(after.zones).toBe(before.zones);
    expect(after.result).toBe(before.result);
    expect(after.stale).toBe(false);
    expect(localStorage.length).toBe(0);
    fireEvent.click(button(p.clear));
    expect(check(b.combine).checked).toBe(true);
  });

  it('meer dan één PDF bovenaan gekozen: de melding verwijst naar Batch', async () => {
    setup();
    choose('brief.pdf', 'tweede.pdf');
    await waitFor(() => expect(screen.getByText(p.tooMany)).toBeTruthy());
    expect(p.tooMany).toContain('Batch');
  });

  it('in de taal van de app', async () => {
    render(
      <LanguageProvider initial="en">
        <TextTool />
      </LanguageProvider>,
    );
    const en = messages.en.plainText;
    fireEvent.click(screen.getByRole('checkbox', { name: en.batch.combine }));
    await batch('brief.pdf');
    const [data] = vi.mocked(downloadFile).mock.calls.at(-1)!;
    expect(
      new TextDecoder()
        .decode(data as Uint8Array)
        .split('\n')
        .slice(0, 5),
    ).toEqual([
      'File 1 start: brief.pdf',
      'Title: Nieuwe huurovereenkomst',
      'Author: Woningstichting Voorbeeld',
      'Subject: Huur',
      'Date: 2018-06-04',
    ]);
    expect(message()).toContain(format(en.batch.doneCombined, { ok: 1, failed: '' }));
  });
});
