import { describe, expect, it } from 'vitest';
import type { PageText, Piece } from '../compare/layout';
import {
  DEFAULT_TEXT_OPTIONS,
  LOW_TEXT,
  clampZone,
  exportName,
  extractText,
  hasOwnZones,
  zonesFor,
  moveZone,
  quality,
  resizeZone,
  zoneItems,
  type PageResult,
  type Zone,
  type ZoneSetup,
} from './extract';

/** De standaard zonder pagina-ankers en doorlopende zinnen: die staan in `pages.test.ts`. */
const PLAIN = { ...DEFAULT_TEXT_OPTIONS, anchors: false, crossPage: false };

/** Een pagina met regels (elk een eigen tekststukje), van boven naar beneden; `gap` na een alinea. */
function page(
  no: number,
  paragraphs: string[][],
  {
    head,
    foot,
    line = 12,
    gap = 24,
  }: { head?: string; foot?: string; line?: number; gap?: number } = {},
): PageText {
  const items: Piece[] = [];
  const add = (str: string, y: number) => items.push({ str, x: 50, y, fh: 10, w: str.length * 5 });
  if (head) add(head, 800);
  let y = 740;
  for (const lines of paragraphs) {
    for (const str of lines) {
      add(str, y);
      y -= line;
    }
    y -= gap - line;
  }
  if (foot) add(foot, 40);
  return { no, w: 595, h: 842, items, chars: items.reduce((n, i) => n + i.str.length, 0) };
}

const empty = (no: number): PageText => ({ no, w: 595, h: 842, items: [], chars: 0 });

describe('extractText', () => {
  it('heeft standaard pagina-ankers en doorlopende zinnen, zoals de extractor', () => {
    expect(DEFAULT_TEXT_OPTIONS.anchors).toBe(true);
    expect(DEFAULT_TEXT_OPTIONS.crossPage).toBe(true);
    const { text } = extractText(
      [page(1, [['Deze zin loopt door op de']]), page(2, [['volgende pagina.']])],
      DEFAULT_TEXT_OPTIONS,
    );
    expect(text).toBe(
      '{p1} Deze zin loopt door op de {p2} volgende pagina.\n\n---\nPaginaconcordantie:\nPDF-pagina 1 = geen documentpaginanummer (titelblad)\nPDF-pagina 2 = geen documentpaginanummer',
    );
  });

  it('heeft standaard geen documentkop en geen conventieblok, zoals de extractor', () => {
    expect(DEFAULT_TEXT_OPTIONS.header).toBe(false);
    expect(DEFAULT_TEXT_OPTIONS.conventions).toBe(false);
    const meta = { title: 'Brief', author: 'Jansen', subject: '', date: '4 juni 2018' };
    const { text } = extractText([page(1, [['Een korte brief.']])], PLAIN, null, {
      name: 'brief.pdf',
      meta,
    });
    expect(text).toBe('Een korte brief.');
  });

  it('met documentkop en conventieblok: die bovenaan, met de naam en de gegevens', () => {
    const meta = { title: 'Brief', author: 'Jansen', subject: '', date: '4 juni 2018' };
    const pages = [page(1, [['Een korte brief.']])];
    const opts = { ...DEFAULT_TEXT_OPTIONS, header: true, conventions: true };
    expect(extractText(pages, opts, null, { name: 'brief.pdf', meta }).text).toBe(
      [
        '=== Conventies ===',
        'Platte tekst geëxtraheerd uit een PDF; opmaak en afbeeldingen zijn weggelaten.',
        '{p#} = begin van PDF-pagina #. Kan midden in een zin staan als een alinea over de pagina-overgang doorloopt.',
        'Onderaan staat een paginaconcordantie die fysieke PDF-pagina’s koppelt aan afgedrukte documentpaginanummers.',
        '==================',
        '',
        'Bestand: brief.pdf',
        'Titel: Brief',
        'Auteur: Jansen',
        'Datum: 4 juni 2018',
        '',
        '{p1} Een korte brief.',
        '',
        '---',
        'Paginaconcordantie:',
        'PDF-pagina 1 = geen documentpaginanummer (titelblad)',
      ].join('\n'),
    );
    // Met de woorden van een andere taal.
    const head = {
      fields: { file: 'File', title: 'Title', author: 'Author', subject: 'Subject', date: 'Date' },
      conventions: {
        title: 'C',
        intro: 'I',
        anchors: 'A',
        concordance: 'K',
        concordanceBatch: 'B',
        files: 'F',
        heading: 'H',
      },
    };
    const english = extractText(pages, { ...PLAIN, header: true, conventions: true }, null, {
      name: 'letter.pdf',
      meta,
      head,
    }).text;
    expect(english).toBe(
      '=== C ===\nI\n=========\n\nFile: letter.pdf\nTitle: Brief\nAuthor: Jansen\nDate: 4 juni 2018\n\nEen korte brief.',
    );
  });

  it('zet de pagina’s na elkaar, met een witregel ertussen, en laat pagina’s zonder tekst weg', () => {
    const { text, pages } = extractText(
      [
        page(1, [['De eerste alinea loopt', 'over twee regels.'], ['De tweede alinea.']]),
        empty(2),
        page(3, [['Op pagina drie.']]),
      ],
      PLAIN,
    );
    expect(text).toBe(
      'De eerste alinea loopt over twee regels.\n\nDe tweede alinea.\n\nOp pagina drie.',
    );
    expect(pages.map((p) => [p.no, p.status])).toEqual([
      [1, 'read'],
      [2, 'notext'],
      [3, 'read'],
    ]);
  });

  it('laat terugkerende kop- en voetteksten standaard weg, en houdt ze als dat uit staat', () => {
    const pages = [1, 2, 3].map((no) =>
      page(no, [['Gewone tekst op de pagina.'], ['Nog een alinea.'], ['En een derde.']], {
        head: 'Rapport 2026',
        foot: `Pagina ${no} van 3`,
      }),
    );
    expect(DEFAULT_TEXT_OPTIONS.strip).toBe(true);
    const stripped = extractText(pages, PLAIN).text;
    expect(stripped).not.toContain('Rapport 2026');
    expect(stripped).not.toMatch(/Pagina \d van 3/);

    const kept = extractText(pages, { ...PLAIN, strip: false }).text;
    expect(kept).toContain('Rapport 2026');
    expect(kept).toContain('Pagina 2 van 3');
  });

  it('herkent standaard de alinea’s van Word (8 pt na een alinea), en bij 1,6 niet meer', () => {
    // 11 pt, regelafstand 14,5 pt, 22,4 pt tussen twee alinea's: 1,55 keer de regelafstand.
    const items: Piece[] = [];
    let y = 760;
    for (const lines of [
      ['De eerste alinea loopt over', 'twee regels.'],
      ['De tweede alinea, ook over', 'twee regels.'],
    ]) {
      for (const str of lines) {
        items.push({ str, x: 71, y, fh: 11, w: str.length * 5.5 });
        y -= 14.5;
      }
      y -= 22.4 - 14.5;
    }
    const word: PageText = { no: 1, w: 595, h: 842, items, chars: 0 };
    expect(DEFAULT_TEXT_OPTIONS.gapFactor).toBe(1.3);
    expect(extractText([word], PLAIN).text).toBe(
      'De eerste alinea loopt over twee regels.\n\nDe tweede alinea, ook over twee regels.',
    );
    expect(extractText([word], { ...PLAIN, gapFactor: 1.6 }).text).toBe(
      'De eerste alinea loopt over twee regels. De tweede alinea, ook over twee regels.',
    );
  });

  it('laat elke regel los als regels niet worden samengevoegd', () => {
    const doc = [page(1, [['Regel een', 'regel twee'], ['Regel drie']])];
    expect(extractText(doc, { ...PLAIN, joinLines: false }).text).toBe(
      'Regel een\nregel twee\nRegel drie',
    );
  });

  it('herstelt afgebroken woorden, behalve als dat uit staat', () => {
    const doc = [page(1, [['Dit is een verge-', 'lijking van tekst.']])];
    expect(extractText(doc, PLAIN).text).toBe('Dit is een vergelijking van tekst.');
    expect(extractText(doc, { ...PLAIN, dehyphen: false }).text).toBe(
      'Dit is een verge- lijking van tekst.',
    );
  });

  it('geeft lege tekst als geen enkele pagina een tekstlaag heeft', () => {
    expect(extractText([empty(1), empty(2)], PLAIN).text).toBe('');
  });
});

describe('quality', () => {
  const read = (no: number, text: string): PageResult => ({ no, text, status: 'read' });

  it('telt de gelezen pagina’s, het gemiddelde, pagina’s zonder tekstlaag en met nauwelijks tekst', () => {
    const long = 'x'.repeat(100);
    const short = 'y'.repeat(LOW_TEXT - 1);
    expect(
      quality([
        read(1, long),
        { no: 2, text: '', status: 'notext' },
        read(3, `  ${short}  `),
        read(4, 'z'.repeat(LOW_TEXT)),
        { no: 5, text: '', status: 'skipped' },
      ]),
    ).toEqual({
      read: 3,
      average: Math.round((100 + 24 + 25) / 3),
      noText: [2],
      skipped: [5],
      low: [3],
    });
  });

  it('heeft zonder gelezen pagina’s een gemiddelde van 0', () => {
    expect(quality([{ no: 1, text: '', status: 'notext' }])).toEqual({
      read: 0,
      average: 0,
      noText: [1],
      skipped: [],
      low: [],
    });
  });
});

describe('exportName', () => {
  it('zet _extract.txt achter de naam, zonder .pdf', () => {
    expect(exportName('brief.pdf')).toBe('brief_extract.txt');
    expect(exportName('BRIEF.PDF')).toBe('BRIEF_extract.txt');
    expect(exportName('notulen.pdf.pdf')).toBe('notulen.pdf_extract.txt');
    expect(exportName('zonder-extensie')).toBe('zonder-extensie_extract.txt');
    expect(exportName('.pdf')).toBe('pdf-tekst_extract.txt');
  });
});

/**
 * Een pagina met een kop, twee kolommen van zes regels en een voet (A4, in punten). Een vak in
 * delen van de pagina: (x in punten) / 595 en (842 − y in punten) / 842.
 */
const ROWS = 6;
const rows = (side: string) => Array.from({ length: ROWS }, (_, i) => `${side} ${i + 1}`);

function twoColumns(no = 1): PageText {
  const items: Piece[] = [];
  const add = (str: string, x: number, y: number) =>
    items.push({ str, x, y, fh: 10, w: str.length * 5 });
  add('Kop van het tijdschrift', 50, 800);
  for (let i = 0; i < ROWS; i++) {
    add(`links ${i + 1}`, 50, 700 - i * 12);
    add(`rechts ${i + 1}`, 320, 700 - i * 12);
  }
  add(`Pagina ${no}`, 280, 40);
  return { no, w: 595, h: 842, items, chars: items.reduce((n, i) => n + i.str.length, 0) };
}

/** Een vak in punten (links, boven, rechts, onder), omgerekend naar delen van de pagina. */
const pts = (left: number, top: number, right: number, bottom: number): Zone => ({
  x0: left / 595,
  y0: (842 - top) / 842,
  x1: right / 595,
  y1: (842 - bottom) / 842,
});

/** Leesvakken: standaardvakken, eigen vakken per pagina, en of lege pagina's gelezen worden. */
const setup = (zones: Zone[], pages: ZoneSetup['pages'] = {}, readEmpty = false): ZoneSetup => ({
  zones,
  pages,
  readEmpty,
});

const LEFT = pts(40, 720, 300, 600);
const RIGHT = pts(310, 720, 560, 600);

describe('leesvakken', () => {
  it('neemt een tekststukje mee als zijn midden in het vak ligt', () => {
    const p = twoColumns();
    expect(zoneItems(p, LEFT).map((i) => i.str)).toEqual(rows('links'));
    // "links 1" loopt van x 50 tot 85, midden 67,5: een vak tot x 70 pakt het nog, tot 65 niet.
    expect(zoneItems(p, pts(40, 720, 70, 698)).map((i) => i.str)).toEqual(['links 1']);
    expect(zoneItems(p, pts(40, 720, 65, 698))).toEqual([]);
    // In de hoogte ook het midden: "links 1" staat op y 700 (10 pt hoog, midden 705).
    expect(zoneItems(p, pts(40, 720, 300, 703)).map((i) => i.str)).toEqual(['links 1']);
    expect(zoneItems(p, pts(40, 720, 300, 706))).toEqual([]);
  });

  it('leest de vakken in hun volgorde, elk als eigen blok, en de rest van de pagina vervalt', () => {
    const opts = { ...PLAIN, joinLines: false };
    expect(extractText([twoColumns()], opts, setup([RIGHT, LEFT])).text).toBe(
      `${rows('rechts').join('\n')}\n\n${rows('links').join('\n')}`,
    );
  });

  it('splitst binnen een vak geen kolommen, en laat daar geen kop of voet weg', () => {
    const opts = { ...PLAIN, joinLines: false };
    const pages = [1, 2, 3].map(twoColumns);
    // Zonder vakken: kop en voet weg (ze komen op elke pagina terug), links en rechts na elkaar.
    expect(extractText(pages, opts).text.split('\n\n')[0]).toBe(
      [...rows('links'), ...rows('rechts')].join('\n'),
    );
    // Eén vak over de hele pagina: alles, regel voor regel over de volle breedte.
    const whole = extractText(pages, opts, setup([{ x0: 0, y0: 0, x1: 1, y1: 1 }])).text;
    expect(whole.split('\n\n')[0]).toBe(
      [
        'Kop van het tijdschrift',
        ...rows('links').map((l, i) => `${l} rechts ${i + 1}`),
        'Pagina 1',
      ].join('\n'),
    );
  });

  it('slaat elke pagina over als de leesvakken aan staan maar er geen vak is', () => {
    const result = extractText([twoColumns(1), empty(2), twoColumns(3)], PLAIN, setup([]));
    expect(result.text).toBe('');
    expect(result.pages.map((p) => p.status)).toEqual(['skipped', 'notext', 'skipped']);
  });

  it('geeft een lege pagina-tekst als er niets in de vakken staat', () => {
    const result = extractText([twoColumns()], PLAIN, setup([pts(0, 600, 595, 500)]));
    expect(result.pages[0]).toEqual({ no: 1, text: '', status: 'read' });
  });
});

describe('vakken verschuiven en vergroten', () => {
  const zone: Zone = { x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.4 };

  it('zet een andersom getekend vak recht en houdt het binnen de pagina', () => {
    expect(clampZone({ x0: 0.6, y0: 0.9, x1: -0.2, y1: 0.1 })).toEqual({
      x0: 0,
      y0: 0.1,
      x1: 0.6,
      y1: 0.9,
    });
    expect(clampZone({ x0: 0.5, y0: 0.5, x1: 1.4, y1: 1.2 })).toEqual({
      x0: 0.5,
      y0: 0.5,
      x1: 1,
      y1: 1,
    });
  });

  it('verschuift een vak zonder dat het de pagina uit gaat, en houdt zijn maat', () => {
    const moved = moveZone(zone, 0.1, 0.1);
    for (const [key, value] of Object.entries({ x0: 0.3, y0: 0.3, x1: 0.6, y1: 0.5 }))
      expect(moved[key as keyof Zone], key).toBeCloseTo(value);
    const right = moveZone(zone, 0.9, 0.9);
    expect(right.x1).toBeCloseTo(1);
    expect(right.y1).toBeCloseTo(1);
    expect(right.x1 - right.x0).toBeCloseTo(0.3);
    expect(right.y1 - right.y0).toBeCloseTo(0.2);
    expect(moveZone(zone, -1, -1)).toEqual({ x0: 0, y0: 0, x1: 0.3, y1: 0.2 });
  });

  it('versleept één kant of een hoek', () => {
    expect(resizeZone(zone, 'e', 0.7, 0.99)).toEqual({ x0: 0.2, y0: 0.2, x1: 0.7, y1: 0.4 });
    expect(resizeZone(zone, 'n', 0.99, 0.1)).toEqual({ x0: 0.2, y0: 0.1, x1: 0.5, y1: 0.4 });
    expect(resizeZone(zone, 'sw', 0.1, 0.6)).toEqual({ x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6 });
    expect(resizeZone(zone, 'nw', 0.1, 0.1)).toEqual({ x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.4 });
    expect(resizeZone(zone, 'ne', 0.6, 0.15)).toEqual({ x0: 0.2, y0: 0.15, x1: 0.6, y1: 0.4 });
    expect(resizeZone(zone, 'se', 0.6, 0.5)).toEqual({ x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.5 });
    expect(resizeZone(zone, 's', 0.99, 0.5)).toEqual({ x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.5 });
    expect(resizeZone(zone, 'w', 0.1, 0.99)).toEqual({ x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.4 });
    // Voorbij de andere kant: het vak klapt om en blijft recht.
    expect(resizeZone(zone, 'e', 0.1, 0)).toEqual({ x0: 0.1, y0: 0.2, x1: 0.2, y1: 0.4 });
  });
});

describe('vakken per pagina', () => {
  const opts = { ...PLAIN, joinLines: false };
  const doc = [1, 2, 3].map(twoColumns);
  const textOf = (result: { pages: { no: number; text: string }[] }, no: number) =>
    result.pages.find((p) => p.no === no)!.text;

  it('een pagina met eigen vakken leest die; de andere pagina’s de standaardvakken', () => {
    const result = extractText(doc, opts, setup([LEFT], { 2: [RIGHT] }));
    expect(textOf(result, 1)).toBe(rows('links').join('\n'));
    expect(textOf(result, 2)).toBe(rows('rechts').join('\n'));
    expect(textOf(result, 3)).toBe(rows('links').join('\n'));
  });

  it('een lege eigen set slaat de pagina over, ook als er standaardvakken zijn', () => {
    const result = extractText(doc, opts, setup([LEFT], { 2: [] }));
    expect(result.pages.map((p) => p.status)).toEqual(['read', 'skipped', 'read']);
  });

  it('met "helemaal lezen" wordt een pagina zonder vakken helemaal gelezen, met kolommen', () => {
    const result = extractText(doc, opts, setup([LEFT], { 2: [] }, true));
    expect(result.pages.map((p) => p.status)).toEqual(['read', 'read', 'read']);
    // Zoals in de extractor: de hele pagina, links dan rechts, en kop en voet blijven staan.
    expect(textOf(result, 2)).toBe(
      ['Kop van het tijdschrift', ...rows('links'), ...rows('rechts'), 'Pagina 2'].join('\n'),
    );
    // Zonder kolommen: regel voor regel over de volle breedte.
    const flat = extractText(doc, { ...opts, columns: false }, setup([], {}, true));
    expect(textOf(flat, 1).split('\n')[1]).toBe('links 1 rechts 1');
  });

  it('zonder standaardvakken en zonder eigen set: overslaan (of helemaal lezen)', () => {
    expect(extractText(doc, opts, setup([], { 3: [RIGHT] })).pages.map((p) => p.status)).toEqual([
      'skipped',
      'skipped',
      'read',
    ]);
  });

  it('weet welke vakken op een pagina gelden', () => {
    const s = setup([LEFT], { 2: [RIGHT], 3: [] });
    expect(hasOwnZones(s, 1)).toBe(false);
    expect(hasOwnZones(s, 2)).toBe(true);
    expect(hasOwnZones(s, 3)).toBe(true);
    expect(zonesFor(s, 1)).toEqual([LEFT]);
    expect(zonesFor(s, 2)).toEqual([RIGHT]);
    expect(zonesFor(s, 3)).toEqual([]);
  });
});
