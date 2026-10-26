import { describe, expect, it } from 'vitest';
import type { Annotation } from '../annotations/model';
import type { PageItem } from '../pages/plan';
import { foldChars, foldTerm } from './fold';
import { boxesFor, buildPageText, makeRun, visibleCount, type PageText } from './pageText';
import { findHits, parseTerms, type SearchSpec } from './patterns';
import {
  MAX_CANDIDATES,
  SearchCancelled,
  isScanned,
  runSearch,
  type PageTextProvider,
} from './run';
import { ocrWordsToPageText, textItemsToPageText, type TextItemLike } from './textLayer';

const spec = (over: Partial<SearchSpec>): SearchSpec => ({
  terms: [],
  patterns: [],
  wholeWords: false,
  ...over,
});

const hitsIn = (text: string, over: Partial<SearchSpec>) =>
  findHits([...text], spec(over)).map((hit) => [...text].slice(hit.start, hit.end).join(''));

describe('foldChars', () => {
  it('haalt accenten en ligaturen weg en houdt de plek bij', () => {
    const folded = foldChars([...'Joé oﬃce']);
    expect(folded.text).toBe('Joe office');
    // "ﬃ" wordt drie tekens, alle van dezelfde plek.
    expect(folded.origin.slice(5, 9)).toEqual([5, 5, 5, 6]);
  });

  it('maakt van alle witruimte één spatie en laat onzichtbare tekens weg', () => {
    expect(foldChars([...'a  \n b­c​']).text).toBe('a bc');
    expect(foldTerm('  Jan  de   Vries ')).toBe('Jan de Vries');
  });
});

describe('parseTerms', () => {
  it('geeft één term per regel, zonder lege regels of dubbelen', () => {
    expect(parseTerms('Jan\r\n\n  Piet  \nJan\n ​\n')).toEqual(['Jan', 'Piet']);
  });
});

describe('findHits: termen', () => {
  it('vindt een term zonder op hoofdletters of accenten te letten', () => {
    expect(hitsIn('Mevrouw JOSÉ Smit en josé', { terms: ['jose'] })).toEqual(['JOSÉ', 'josé']);
  });

  it('vindt een naam die over twee regels staat', () => {
    expect(hitsIn('Jan\nde Vries', { terms: ['Jan de Vries'] })).toEqual(['Jan\nde Vries']);
  });

  it('behandelt leestekens in een term letterlijk', () => {
    expect(hitsIn('prijs (a+b) of a.b?', { terms: ['(a+b)', 'a.b?'] })).toEqual(['(a+b)', 'a.b?']);
  });

  it('telt met "alleen hele woorden" een term in een langer woord niet mee', () => {
    expect(hitsIn('Jan Janssen Jan.', { terms: ['Jan'] })).toEqual(['Jan', 'Jan', 'Jan']);
    expect(hitsIn('Jan Janssen Jan.', { terms: ['Jan'], wholeWords: true })).toEqual([
      'Jan',
      'Jan',
    ]);
  });

  it('voegt overlappende treffers samen', () => {
    expect(hitsIn('abcdef', { terms: ['abcd', 'cdef'] })).toEqual(['abcdef']);
  });

  it('geeft niets bij een lege zoekopdracht', () => {
    expect(hitsIn('tekst', { terms: ['', '  '] })).toEqual([]);
  });
});

describe('findHits: patronen', () => {
  it('vindt e-mailadressen', () => {
    expect(
      hitsIn('Mail jan.de-vries+x@mail.example.nl, of a@b.c.', { patterns: ['email'] }),
    ).toEqual(['jan.de-vries+x@mail.example.nl']);
  });

  it('vindt alleen een IBAN met kloppend controlegetal', () => {
    expect(hitsIn('Rek NL91 ABNA 0417 1643 00 graag', { patterns: ['iban'] })).toEqual([
      'NL91 ABNA 0417 1643 00',
    ]);
    expect(hitsIn('Rek NL91ABNA0417164300.', { patterns: ['iban'] })).toEqual([
      'NL91ABNA0417164300',
    ]);
    // Verkeerd controlegetal: geen IBAN.
    expect(hitsIn('Rek NL92 ABNA 0417 1643 00 graag', { patterns: ['iban'] })).toEqual([]);
  });

  it('laat het IBAN ophouden voor woorden die erachter staan', () => {
    expect(hitsIn('NL91 ABNA 0417 1643 00 TEST OK', { patterns: ['iban'] })).toEqual([
      'NL91 ABNA 0417 1643 00',
    ]);
    expect(hitsIn('DE89 3704 0044 0532 0130 00 pas', { patterns: ['iban'] })).toEqual([
      'DE89 3704 0044 0532 0130 00',
    ]);
  });

  it('vindt Nederlandse en internationale telefoonnummers, maar geen datum', () => {
    expect(
      hitsIn('Bel 06 12345678, 020-1234567 of +31 6 12345678; ook +49 30 123456.', {
        patterns: ['phone'],
      }),
    ).toEqual(['06 12345678', '020-1234567', '+31 6 12345678', '+49 30 123456']);
    expect(hitsIn('Op 01-02-2024 12 stuks', { patterns: ['phone'] })).toEqual([]);
  });

  it('vindt postcodes in hoofdletters en niet een jaartal met een woord', () => {
    expect(
      hitsIn('1234 AB Utrecht, 5678CD Gouda, 2019 en meer', { patterns: ['postcode'] }),
    ).toEqual(['1234 AB', '5678CD']);
    expect(hitsIn('1234 SS Ergens', { patterns: ['postcode'] })).toEqual([]);
  });

  it('combineert termen en patronen op een pagina', () => {
    expect(hitsIn('Jan: jan@x.nl', { terms: ['Jan'], patterns: ['email'] })).toEqual([
      'Jan',
      'jan@x.nl',
    ]);
  });
});

/* Een pagina van 200 x 100 punten; de plekken van de fragmenten in PDF-ruimte (y omhoog). */
const SIZE = { width: 200, height: 100 };
const toBase = (x: number, y: number): [number, number] => [x, SIZE.height - y];
const item = (
  str: string,
  x: number,
  y: number,
  over: Partial<TextItemLike> = {},
): TextItemLike => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width: [...str].length * 5,
  height: 10,
  ...over,
});

describe('textItemsToPageText en boxesFor', () => {
  it('zet fragmenten op hun plek, met een vak om precies de treffer', () => {
    const text = textItemsToPageText([item('Hallo wereld', 20, 60)], toBase, SIZE);
    expect(text.chars.join('')).toBe('Hallo wereld');
    // "Hallo " is de helft van de letters maar niet de helft van de breedte: het vak om "wereld" staat rechts.
    const [box] = boxesFor(text, 6, 12);
    expect(box).toBeDefined();
    expect(box!.x).toBeGreaterThan(20 + 0.4 * 60);
    expect(box!.x + box!.width).toBeGreaterThanOrEqual(20 + 60);
    // De letters liggen tussen de basislijn (y 40 van boven) en de bovenkant; het vak ook.
    expect(box!.y).toBeLessThanOrEqual(40 - 9);
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(40);
  });

  it('dekt bij een treffer die een heel fragment is, dat hele fragment af', () => {
    const text = textItemsToPageText(
      [item('voor ', 10, 60), item('geheim', 35, 60), item(' na', 65, 60)],
      toBase,
      SIZE,
    );
    const start = text.chars.join('').indexOf('geheim');
    const [box] = boxesFor(text, start, start + 6);
    expect(box!.x).toBeLessThanOrEqual(35);
    expect(box!.x + box!.width).toBeGreaterThanOrEqual(35 + 30);
  });

  it('maakt van fragmenten op één regel één vak, en van twee regels twee', () => {
    const text = textItemsToPageText(
      [item('Jan ', 10, 60), item('de', 30, 60, { hasEOL: true }), item('Vries', 10, 45)],
      toBase,
      SIZE,
    );
    expect(text.chars.join('')).toBe('Jan de\nVries');
    expect(findHits(text.chars, spec({ terms: ['Jan de Vries'] }))).toHaveLength(1);
    const [hit] = findHits(text.chars, spec({ terms: ['Jan de Vries'] }));
    const boxes = boxesFor(text, hit!.start, hit!.end);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y);
  });

  it('houdt vakken binnen de pagina', () => {
    const text = textItemsToPageText([item('rand', 0, 2), item('hoek', 185, 98)], toBase, SIZE);
    for (const [start, end] of [
      [0, 4],
      [4, 8],
    ] as const) {
      for (const box of boxesFor(text, start, end)) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(SIZE.width);
        expect(box.y + box.height).toBeLessThanOrEqual(SIZE.height);
      }
    }
  });

  it('rekent ook tekst op zijn kant om (90 graden)', () => {
    // Tekst die omhoog loopt: de richting van de regel is de y-as van de PDF.
    const sideways: TextItemLike = {
      str: 'zijkant',
      transform: [0, 10, -10, 0, 50, 20],
      width: 35,
      height: 10,
    };
    const text = textItemsToPageText([sideways], toBase, SIZE);
    const [box] = boxesFor(text, 0, 7);
    // Hoog en smal: de regel loopt van onder naar boven.
    expect(box!.height).toBeGreaterThan(box!.width);
    expect(box!.height).toBeGreaterThanOrEqual(35);
  });

  it('slaat lege fragmenten over en laat een regeleinde erop het vorige afsluiten', () => {
    const text = textItemsToPageText(
      [item('a', 10, 60), item('', 15, 60, { hasEOL: true }), item('b', 10, 45)],
      toBase,
      SIZE,
    );
    expect(text.chars.join('')).toBe('a\nb');
  });
});

describe('ocrWordsToPageText', () => {
  const words = [
    { text: 'Jan', x0: 100, y0: 100, x1: 160, y1: 130 },
    { text: 'de', x0: 170, y0: 102, x1: 200, y1: 130 },
    { text: 'Vries', x0: 100, y0: 150, x1: 190, y1: 180 },
    { text: '  ', x0: 0, y0: 0, x1: 1, y1: 1 },
  ];

  it('zet woorden achter elkaar, op dezelfde regel met een spatie en daarna met een nieuwe regel', () => {
    const text = ocrWordsToPageText(words, 2, SIZE);
    expect(text.chars.join('')).toBe('Jan de\nVries');
  });

  it('rekent beeldpunten om naar punten', () => {
    const text = ocrWordsToPageText(words, 2, { width: 300, height: 300 });
    const [hit] = findHits(text.chars, spec({ terms: ['Vries'] }));
    const [box] = boxesFor(text, hit!.start, hit!.end);
    // Het woord staat op (100..190, 150..180) beeldpunten, dus (50..95, 75..90) punten.
    expect(box!.x).toBeLessThanOrEqual(50);
    expect(box!.x + box!.width).toBeGreaterThanOrEqual(95);
    expect(box!.y).toBeLessThanOrEqual(75);
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(90);
    expect(box!.x).toBeGreaterThan(40);
    expect(box!.y + box!.height).toBeLessThan(100);
  });
});

describe('visibleCount en isScanned', () => {
  it('telt alleen zichtbare tekens', () => {
    const run = makeRun('ab c', { x: 0, y: 10 }, { x: 20, y: 0 }, { x: 0, y: -10 });
    const text = buildPageText([{ run, after: '\n' }], SIZE);
    expect(visibleCount(text)).toBe(3);
    expect(isScanned(text)).toBe(true);
  });
});

/* runSearch met een nepbron van paginatekst */

const page = (key: number): PageItem => ({ key, doc: 1, source: key - 1, rotation: 0 }) as PageItem;

const pageWith = (...lines: string[]): PageText =>
  textItemsToPageText(
    lines.map((line, i) => item(line, 10, 90 - i * 15, { hasEOL: true })),
    toBase,
    SIZE,
  );

const NO_TEXT = pageWith();
const FILLER = 'x'.repeat(30);

function provider(
  pages: Record<number, PageText>,
  scans: Record<number, PageText> = {},
  calls: string[] = [],
): PageTextProvider {
  return {
    text: async (p) => {
      calls.push(`text ${p.key}`);
      return pages[p.key] ?? NO_TEXT;
    },
    ocr: async (p) => {
      calls.push(`ocr ${p.key}`);
      return scans[p.key] ?? NO_TEXT;
    },
  };
}

let counter = 0;
const run = (over: Partial<Parameters<typeof runSearch>[0]>) =>
  runSearch({
    pages: [page(1), page(2), page(3)],
    annotations: [],
    spec: spec({ terms: ['geheim'] }),
    ocr: false,
    provider: provider({}),
    newId: () => ++counter,
    ...over,
  });

describe('runSearch', () => {
  it('geeft per treffer de pagina, de omgeving en een aangevinkt vak', async () => {
    const result = await run({
      provider: provider({
        1: pageWith(`${FILLER} het geheim woord`),
        2: pageWith(FILLER),
        3: pageWith(`${FILLER} nog geheim`),
      }),
    });
    expect(result.candidates.map((c) => c.page)).toEqual([1, 3]);
    const [first] = result.candidates;
    expect(first).toMatchObject({ text: 'geheim', kind: 'term', viaOcr: false, checked: true });
    expect(first!.before.endsWith('het ')).toBe(true);
    expect(first!.after.startsWith(' woord')).toBe(true);
    expect(first!.boxes).toHaveLength(1);
    expect(result).toMatchObject({ covered: 0, skipped: 0, recognized: 0, capped: false });
  });

  it('knipt de omgeving van een treffer niet midden in een woord af', async () => {
    const words = 'alfabet bravoos charlies delta-echo foxtrot golfbal hotelier'.split(' ');
    const line = `${words.join(' ')} geheim ${words.join(' ')}`;
    const result = await run({
      pages: [page(1)],
      provider: provider({
        1: textItemsToPageText([item(line, 10, 90)], toBase, { width: 1e6, height: 100 }),
      }),
    });
    const [hit] = result.candidates;
    expect(hit!.before.startsWith('…')).toBe(true);
    expect(hit!.after.endsWith('…')).toBe(true);
    for (const word of [
      ...hit!.before.slice(1).split(' '),
      ...hit!.after.slice(0, -1).split(' '),
    ]) {
      if (word !== '') expect(words).toContain(word);
    }
  });

  it('slaat pagina’s zonder tekst over als OCR uit staat, en meldt dat', async () => {
    const calls: string[] = [];
    const result = await run({
      provider: provider({ 1: pageWith(`${FILLER} geheim`) }, {}, calls),
    });
    expect(result.skipped).toBe(2);
    expect(calls.filter((c) => c.startsWith('ocr'))).toEqual([]);
    expect(result.candidates).toHaveLength(1);
  });

  it('gebruikt met OCR aan de herkende tekst van pagina’s zonder tekst', async () => {
    const calls: string[] = [];
    const scan = ocrWordsToPageText(
      [
        { text: 'Dit', x0: 10, y0: 10, x1: 60, y1: 40 },
        { text: 'is', x0: 70, y0: 10, x1: 100, y1: 40 },
        { text: 'een', x0: 110, y0: 10, x1: 160, y1: 40 },
        { text: 'geheim', x0: 170, y0: 10, x1: 300, y1: 40 },
        { text: 'bericht', x0: 310, y0: 10, x1: 420, y1: 40 },
        { text: 'van', x0: 430, y0: 10, x1: 480, y1: 40 },
        { text: 'Piet', x0: 490, y0: 10, x1: 560, y1: 40 },
      ],
      2,
      SIZE,
    );
    const result = await run({
      ocr: true,
      provider: provider({ 1: pageWith(`${FILLER} geheim`) }, { 2: scan }, calls),
    });
    expect(calls.filter((c) => c.startsWith('ocr'))).toEqual(['ocr 2', 'ocr 3']);
    expect(result.recognized).toBe(2);
    expect(result.candidates.map((c) => [c.page, c.viaOcr])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('slaat treffers over die al in een redactievak liggen', async () => {
    const pages = { 1: pageWith(`${FILLER} geheim`) };
    const first = await run({ pages: [page(1)], provider: provider(pages) });
    const [box] = first.candidates[0]!.boxes;
    const existing: Annotation = {
      id: 99,
      page: 1,
      kind: 'redact',
      x: box!.x - 1,
      y: box!.y - 1,
      width: box!.width + 2,
      height: box!.height + 2,
      color: '#000000',
      strokeWidth: 0,
    };
    const again = await run({
      pages: [page(1)],
      annotations: [existing],
      provider: provider(pages),
    });
    expect(again.candidates).toEqual([]);
    expect(again.covered).toBe(1);
    // Een vak op een andere pagina telt niet mee.
    const other = await run({
      pages: [page(1)],
      annotations: [{ ...existing, page: 2 }],
      provider: provider(pages),
    });
    expect(other.candidates).toHaveLength(1);
  });

  it('houdt het aantal treffers beperkt', async () => {
    // Een heel brede pagina, zodat alle treffers erop passen.
    const many = textItemsToPageText(
      [item(`${FILLER} ${'geheim '.repeat(MAX_CANDIDATES + 20)}`, 10, 90)],
      toBase,
      { width: 1_000_000, height: 100 },
    );
    const result = await run({ pages: [page(1)], provider: provider({ 1: many }) });
    expect(result.candidates).toHaveLength(MAX_CANDIDATES);
    expect(result.capped).toBe(true);
  });

  it('meldt de voortgang en stopt als er gestopt wordt', async () => {
    const progress: [number, number][] = [];
    await run({ onProgress: (done, total) => progress.push([done, total]) });
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);

    const controller = new AbortController();
    const result = run({
      signal: controller.signal,
      provider: {
        text: async (p) => {
          if (p.key === 2) controller.abort();
          return NO_TEXT;
        },
        ocr: async () => NO_TEXT,
      },
    });
    await expect(result).rejects.toBeInstanceOf(SearchCancelled);
  });
});
