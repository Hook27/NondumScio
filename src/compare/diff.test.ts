import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIONS,
  MAX_CELLS,
  buildUnits,
  compareTexts,
  countRows,
  displayList,
  inlineDiff,
  normKey,
  type CompareOptions,
  type Row,
} from './diff';
import type { PageText, Piece } from './layout';

/**
 * Een pagina met alinea's: elke alinea over twee regels (de woorden half om half), met een witregel
 * ertussen. Zo ziet de opmaak het verschil tussen een gewone regelafstand en een nieuwe alinea.
 */
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
  return { no, w: 595, h: 842, items, chars: paragraphs.join('').length };
}

/** Een pagina met losse regels (om op regels te vergelijken). */
function linesPage(texts: string[]): PageText {
  const items = texts.map((str, i) => ({ str, x: 50, y: 100_000 - i * 12, fh: 10, w: 50 }));
  return { no: 1, w: 595, h: 842, items, chars: 0 };
}

const kinds = (rows: readonly Row[]) => rows.map((row) => row.kind);

describe('compareTexts', () => {
  it('vindt geen verschillen tussen gelijke teksten', () => {
    const pages = [page(1, ['Eerste alinea.', 'Tweede alinea.'])];
    const result = compareTexts(pages, pages, DEFAULT_OPTIONS);
    expect(kinds(result.rows)).toEqual(['equal', 'equal']);
    expect(countRows(result.rows)).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(result).toMatchObject({ fallback: false, unitsA: 2, unitsB: 2 });
  });

  it('ziet een verwijderde en een toegevoegde alinea', () => {
    const a = [page(1, ['Alinea een.', 'Alinea twee.', 'Alinea drie.'])];
    const b = [page(1, ['Alinea een.', 'Alinea drie.', 'Alinea vier.'])];
    const result = compareTexts(a, b, DEFAULT_OPTIONS);
    expect(kinds(result.rows)).toEqual(['equal', 'removed', 'equal', 'added']);
    expect(countRows(result.rows)).toEqual({ added: 1, removed: 1, changed: 0 });
  });

  it('paart een verwijderde en toegevoegde alinea op dezelfde plek als gewijzigd, met de woorden', () => {
    const a = [page(1, ['Het begin.', 'De huur is 500 euro per maand.', 'Het einde.'])];
    const b = [page(1, ['Het begin.', 'De huur is 550 euro per maand.', 'Het einde.'])];
    const [, row] = compareTexts(a, b, DEFAULT_OPTIONS).rows;
    expect(row).toMatchObject({
      kind: 'changed',
      partsA: [
        { text: 'De huur is ', mark: false },
        { text: '500', mark: true },
        { text: ' euro per maand.', mark: false },
      ],
      partsB: [
        { text: 'De huur is ', mark: false },
        { text: '550', mark: true },
        { text: ' euro per maand.', mark: false },
      ],
    });
  });

  it('onthoudt op welke pagina elk stuk stond', () => {
    const a = [page(1, ['Alinea een.']), page(2, ['Alinea twee.'])];
    const b = [page(1, ['Alinea een.']), page(2, ['Alinea drie.'])];
    const [first, second] = compareTexts(a, b, DEFAULT_OPTIONS).rows;
    expect(first).toMatchObject({ a: { page: 1 }, b: { page: 1 } });
    expect(second).toMatchObject({ kind: 'changed', a: { page: 2 }, b: { page: 2 } });
  });

  it('laat witruimte en hoofdletters alleen meetellen als dat gevraagd is', () => {
    const a = [page(1, ['Het  Contract'])];
    const b = [page(1, ['het contract'])];
    const run = (opts: Partial<CompareOptions>) =>
      kinds(compareTexts(a, b, { ...DEFAULT_OPTIONS, ...opts }).rows);
    expect(run({ ignoreSpace: true, ignoreCase: true })).toEqual(['equal']);
    expect(run({ ignoreSpace: true, ignoreCase: false })).toEqual(['changed']);
  });

  it('vergelijkt alleen op volgorde als de documenten te groot zijn', () => {
    const n = Math.floor(Math.sqrt(MAX_CELLS)) + 1;
    const a = [linesPage(Array.from({ length: n }, (_, i) => `regel a ${i}`))];
    const b = [linesPage(Array.from({ length: n }, (_, i) => `regel b ${i}`))];
    const opts = { ...DEFAULT_OPTIONS, level: 'line' as const, strip: false };
    const big = compareTexts(a, b, opts);
    expect(big.fallback).toBe(true);
    expect(big.rows).toHaveLength(n);
    expect(countRows(big.rows).changed).toBe(n);
    // Precies op de grens nog wel volledig.
    const edge = compareTexts(
      [{ ...a[0]!, items: a[0]!.items.slice(1) }],
      [{ ...b[0]!, items: b[0]!.items.slice(1) }],
      opts,
    );
    expect(edge.fallback).toBe(false);
  });
});

describe('normKey', () => {
  it('trekt witruimte gelijk en negeert hoofdletters, alleen als dat gevraagd is', () => {
    const key = (text: string, opts: Partial<CompareOptions>) =>
      normKey(text, { ...DEFAULT_OPTIONS, ...opts });
    expect(key(' Het	  Contract ', { ignoreSpace: true })).toBe('Het Contract');
    expect(key(' Het	  Contract ', { ignoreSpace: false })).toBe(' Het	  Contract ');
    expect(key('Het Contract', { ignoreCase: true })).toBe('het contract');
    expect(key('Het Contract', { ignoreCase: false })).toBe('Het Contract');
  });
});

/**
 * Een pagina zoals Word hem maakt: 11 pt, regelafstand 14,5 pt en 8 pt witruimte na elke alinea
 * (dus 22,4 pt tussen alinea's). Zo gemeten in een echte PDF uit Word.
 */
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
  return { no: 1, w: 595, h: 842, items, chars: 0 };
}

describe('alinea-gevoeligheid', () => {
  const pages = [
    wordPage([
      ['De eerste alinea loopt over twee regels', 'en stopt hier.'],
      ['De tweede alinea staat eronder, met', 'een witregel van 8 pt ertussen.'],
      ['De derde alinea.'],
    ]),
  ];
  const count = (gapFactor: number) => buildUnits(pages, { ...DEFAULT_OPTIONS, gapFactor }).length;

  it('herkent standaard de alinea’s van Word (8 pt witruimte na een alinea)', () => {
    expect(DEFAULT_OPTIONS.gapFactor).toBe(1.3);
    expect(count(DEFAULT_OPTIONS.gapFactor)).toBe(3);
  });

  it('voegt ze samen tot één alinea bij de drempel van de losse pdf-vergelijker (1,6)', () => {
    expect(count(1.6)).toBe(1);
  });
});

describe('buildUnits', () => {
  it('knipt op alinea’s, zinnen of regels', () => {
    const pages = [page(1, ['Eerste zin. Tweede zin.', 'Nog een alinea.'])];
    const vals = (level: CompareOptions['level']) =>
      buildUnits(pages, { ...DEFAULT_OPTIONS, level }).map((unit) => unit.val);
    expect(vals('paragraph')).toEqual(['Eerste zin. Tweede zin.', 'Nog een alinea.']);
    expect(vals('sentence')).toEqual(['Eerste zin.', 'Tweede zin.', 'Nog een alinea.']);
    expect(vals('line')).toEqual(['Eerste zin.', 'Tweede zin.', 'Nog een', 'alinea.']);
  });

  it('slaat pagina’s zonder tekst over', () => {
    const units = buildUnits([page(1, []), page(2, ['Wat tekst.'])], DEFAULT_OPTIONS);
    expect(units).toEqual([{ page: 2, val: 'Wat tekst.', key: 'Wat tekst.' }]);
  });
});

describe('inlineDiff', () => {
  it('markeert niets als de stukken geen enkel woord gemeen hebben', () => {
    expect(inlineDiff('Appels en peren', 'Iets heel anders', DEFAULT_OPTIONS)).toEqual([
      [{ text: 'Appels en peren', mark: false }],
      [{ text: 'Iets heel anders', mark: false }],
    ]);
  });

  it('markeert een toegevoegd woord alleen in B', () => {
    const [partsA, partsB] = inlineDiff('Een rode auto', 'Een grote rode auto', DEFAULT_OPTIONS);
    expect(partsA).toEqual([{ text: 'Een rode auto', mark: false }]);
    expect(partsB).toEqual([
      { text: 'Een', mark: false },
      { text: ' grote', mark: true },
      { text: ' rode auto', mark: false },
    ]);
  });
});

describe('displayList', () => {
  const unit = { page: 1, val: 'x', key: 'x' };
  const equal: Row = { kind: 'equal', a: unit, b: unit };
  const removed: Row = { kind: 'removed', a: unit };
  const rows = [equal, equal, equal, removed, equal, equal, equal];

  it('klapt ongewijzigde stukken in, met één stuk erboven en eronder', () => {
    expect(displayList(rows, true, new Set())).toEqual([
      { t: 'gap', from: 0, to: 1, count: 2 },
      { t: 'row', row: equal, index: 2 },
      { t: 'row', row: removed, index: 3 },
      { t: 'row', row: equal, index: 4 },
      { t: 'gap', from: 5, to: 6, count: 2 },
    ]);
  });

  it('toont wat je hebt opengeklikt, en alles als niet alleen de verschillen gevraagd zijn', () => {
    expect(displayList(rows, true, new Set([0])).slice(0, 2)).toEqual([
      { t: 'row', row: equal, index: 0 },
      { t: 'gap', from: 1, to: 1, count: 1 },
    ]);
    expect(displayList(rows, false, new Set())).toHaveLength(rows.length);
  });
});
