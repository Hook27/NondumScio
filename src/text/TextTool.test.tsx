// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PageText, Piece } from '../compare/layout';
import { readPdf } from '../compare/readPdf';
import { copyText } from '../compare/report';
import { closeVisual, renderPage } from '../compare/visual';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { PdfLoadError } from '../pdf/loader';
import { downloadFile } from '../pdf/save';
import { TextTool } from './TextTool';
import { UNDO_LIMIT, getTextState, resetTextState, undoZones } from './store';

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

const output = () => document.querySelector('pre.plaintext__output');
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

afterEach(() => {
  cleanup();
  resetTextState();
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
    expect(output()!.textContent).toBe(LETTER_TEXT);
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
    expect(output()!.textContent).toBe('De tweede PDF.');
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
    expect(output()!.textContent!.split('\n\n')[0]).toBe(
      `${rows('links', 1).join(' ')}\n\n${rows('rechts', 1).join(' ')}`.split('\n\n')[0],
    );
    expect(output()!.textContent).not.toContain('Tijdschrift');

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
    expect(output()!.textContent).toBe([1, 2, 3].map(pageText).join('\n\n'));
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
    expect(output()!.textContent!.split('\n\n')[0]).toBe(rows('rechts', 1).join(' '));

    // De onderrand omhoog: alleen de bovenste twee regels.
    fireEvent.click(button(p.views.preview));
    await settle();
    layer();
    const bottom = document.querySelector('.plaintext-zone__handle--s')!;
    drag(bottom, [430, 600], [430, 686]);
    fireEvent.click(button(p.extract));
    expect(output()!.textContent!.split('\n\n')[0]).toBe(rows('rechts', 1).slice(0, 2).join(' '));
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
    expect(output()!.textContent!.split('\n\n')[0]).toBe(rows('rechts', 1).join(' '));
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
    const before = output()!.textContent;
    expect(screen.queryByText(p.stale)).toBeNull();
    fireEvent.click(check(p.settings.strip));
    expect(screen.getByText(p.stale)).toBeTruthy();
    expect(output()!.textContent).toBe(before);
    fireEvent.click(button(p.extract));
    expect(screen.queryByText(p.stale)).toBeNull();
    expect(output()!.textContent).toContain('Tijdschrift voor proeven');

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
    expect(output()!.textContent).toBe(LETTER_TEXT.replace(/\n\n/g, ' '));
    fireEvent.click(check(p.settings.joinLines));
    expect(slider.disabled).toBe(true);
    fireEvent.click(button(p.extract));
    expect(output()!.textContent).toBe(LETTER.flat().join('\n'));
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
    expect(block(p.zones.title).open).toBe(true);
    expect(block(p.settings.title).open).toBe(true);
    // Zoals de browser het doet als je op de kop klikt: dicht, en dan het toggle-event.
    act(() => {
      block(p.settings.title).open = false;
      block(p.settings.title).dispatchEvent(new Event('toggle'));
    });
    expect(getTextState().blocks).toEqual({ zones: true, clean: false });
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
