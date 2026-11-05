import { describe, expect, it } from 'vitest';
import type { PageText, Piece } from '../compare/layout';
import {
  DUTCH_CONCORDANCE,
  assemble,
  boundary,
  concordance,
  detectPageNumber,
  printedPages,
  romanToInt,
  type Assembly,
} from './pages';

/** Een A4-pagina met tekststukjes op een hoogte (in punten vanaf onderen). */
const page = (no: number, items: [string, number][]): PageText => ({
  no,
  w: 595,
  h: 842,
  items: items.map(([str, y]): Piece => ({ str, x: 280, y, fh: 10, w: str.length * 5 })),
  chars: 0,
});

/** Een pagina met lopende tekst in het midden en onderaan een paginanummer. */
const numbered = (no: number, printed: string | null) =>
  page(no, [
    ['Lopende tekst in het midden van de pagina.', 400],
    ...(printed ? [[printed, 30]] : []),
  ] as [string, number][]);

describe('romanToInt', () => {
  it('leest Romeinse cijfers, en geeft 0 bij iets anders', () => {
    expect(romanToInt('i')).toBe(1);
    expect(romanToInt('IV')).toBe(4);
    expect(romanToInt('xiv')).toBe(14);
    expect(romanToInt('mcmxc')).toBe(1990);
    expect(romanToInt('abc')).toBe(0);
  });
});

describe('detectPageNumber', () => {
  it('vindt een los getal in de onder- of bovenrand, niet in het midden', () => {
    expect(detectPageNumber(page(1, [['12', 30]]))).toEqual({ raw: '12', value: 12, roman: false });
    expect(detectPageNumber(page(1, [['12', 820]]))).toEqual({
      raw: '12',
      value: 12,
      roman: false,
    });
    expect(detectPageNumber(page(1, [['12', 400]]))).toBeNull();
    // De rand is 8 % van de hoogte: 67,36 punten.
    expect(detectPageNumber(page(1, [['12', 67]]))).not.toBeNull();
    expect(detectPageNumber(page(1, [['12', 68]]))).toBeNull();
  });

  it('kiest het nummer het dichtst bij de onderkant', () => {
    expect(
      detectPageNumber(
        page(1, [
          ['7', 820],
          ['8', 20],
          ['9', 40],
        ]),
      )!.raw,
    ).toBe('8');
  });

  it('leest Romeinse cijfers (klein geschreven), en geen woorden of lange getallen', () => {
    expect(detectPageNumber(page(1, [['IV', 30]]))).toEqual({ raw: 'iv', value: 4, roman: true });
    expect(detectPageNumber(page(1, [['Pagina 3', 30]]))).toBeNull();
    expect(detectPageNumber(page(1, [['12345', 30]]))).toBeNull();
    expect(detectPageNumber(page(1, [['abc', 30]]))).toBeNull();
    expect(detectPageNumber(page(1, [[' 5 ', 30]]))!.raw).toBe('5');
  });
});

describe('printedPages', () => {
  it('Romeins, dan gewoon, en een pagina zonder nummer', () => {
    const pages = [
      numbered(1, null),
      numbered(2, 'i'),
      numbered(3, 'ii'),
      numbered(4, '1'),
      numbered(5, '2'),
    ];
    expect(printedPages(pages)).toEqual({ 1: null, 2: 'i', 3: 'ii', 4: '1', 5: '2' });
  });

  it('een nummer dat terugloopt of meer dan 50 verspringt, telt niet (bijvoorbeeld een jaartal)', () => {
    const pages = [
      numbered(1, '3'),
      numbered(2, '2018'),
      numbered(3, '4'),
      numbered(4, '2'),
      numbered(5, '54'),
      numbered(6, '55'),
    ];
    expect(printedPages(pages)).toEqual({ 1: '3', 2: null, 3: '4', 4: null, 5: '54', 6: '55' });
    // Een sprong van 4 naar 120 is te groot.
    expect(printedPages([numbered(1, '4'), numbered(2, '120'), numbered(3, '5')])).toEqual({
      1: '4',
      2: null,
      3: '5',
    });
    // Precies 50 verder telt nog wel.
    expect(printedPages([numbered(1, '1'), numbered(2, '51')])).toEqual({ 1: '1', 2: '51' });
  });

  it('een Romeins cijfer telt niet mee voor het oplopen', () => {
    expect(printedPages([numbered(1, '5'), numbered(2, 'ii'), numbered(3, '6')])).toEqual({
      1: '5',
      2: 'ii',
      3: '6',
    });
  });
});

describe('boundary', () => {
  const on = { crossPage: true, dehyphen: true };

  it('aaneen als de zin doorloopt: geen leesteken aan het eind en een kleine beginletter', () => {
    expect(boundary('en dit loopt door op de', 'volgende pagina.', 'auto', on)).toBe('space');
    expect(boundary('en dit loopt door op de', '(tussen haakjes) verder', 'auto', on)).toBe(
      'space',
    );
    expect(boundary('Dit is een hele zin.', 'volgende pagina.', 'auto', on)).toBe('break');
    expect(boundary('eindigt met een citaat”', 'verder', 'auto', on)).toBe('break');
    expect(boundary('en dit loopt door op de', 'Volgende pagina.', 'auto', on)).toBe('break');
  });

  it('een afgebroken woord wordt weer één woord, als afgebroken woorden hersteld worden', () => {
    expect(boundary('een verzeke-  ', 'ring', 'auto', on)).toBe('hyphen');
    expect(boundary('een verzeke-', 'ring', 'auto', { ...on, dehyphen: false })).toBe('space');
    expect(boundary('een verzeke-', 'Ring', 'auto', { ...on, dehyphen: false })).toBe('break');
    // Een streepje na een cijfer is geen afgebroken woord: dan gewoon doorlopen met een spatie.
    expect(boundary('in de jaren 2017-', 'tot nu', 'auto', on)).toBe('space');
  });

  it('de keuze per overgang gaat voor, en zonder doorlopende alinea’s altijd gescheiden', () => {
    expect(boundary('Dit is een hele zin.', 'Nieuwe zin.', 'join', on)).toBe('space');
    expect(boundary('een verzeke-', 'ring', 'join', on)).toBe('hyphen');
    expect(boundary('en dit loopt door', 'verder', 'break', on)).toBe('break');
    expect(boundary('en dit loopt door', 'verder', 'join', { ...on, crossPage: false })).toBe(
      'break',
    );
  });
});

describe('concordance', () => {
  it('elke PDF-pagina met zijn afgedrukte nummer, en pagina 1 zonder nummer als titelblad', () => {
    expect(concordance([{ no: 1 }, { no: 2 }, { no: 3 }], { 1: null, 2: 'i', 3: null })).toBe(
      [
        '---',
        'Paginaconcordantie:',
        'PDF-pagina 1 = geen documentpaginanummer (titelblad)',
        'PDF-pagina 2 = documentpagina i',
        'PDF-pagina 3 = geen documentpaginanummer',
      ].join('\n'),
    );
    expect(concordance([], {})).toBe('');
  });

  it('in andere woorden (de taal van de app)', () => {
    const texts = { title: 'Concordance:', page: 'p{n}={p}', none: 'p{n}=-', titlePage: '*' };
    expect(concordance([{ no: 1 }, { no: 2 }], { 2: '7' }, texts)).toBe(
      '---\nConcordance:\np1=-*\np2=7',
    );
  });
});

describe('assemble', () => {
  const read = (no: number, text: string) => ({ no, text, status: 'read' });
  const plain: Assembly = { printed: {}, joins: {}, texts: DUTCH_CONCORDANCE };
  const opts = { anchors: false, crossPage: false, dehyphen: true };

  it('zonder ankers en doorlopende zinnen: de pagina’s met een witregel ertussen', () => {
    expect(assemble([read(1, ' Een. '), read(2, 'twee')], opts, plain)).toBe('Een.\n\ntwee');
  });

  it('met ankers: {p#} vóór elke gelezen pagina, en de concordantie onderaan (alle pagina’s)', () => {
    const results = [
      read(1, 'Titel.'),
      { no: 2, text: '', status: 'notext' },
      { no: 3, text: '', status: 'skipped' },
      read(4, 'Tekst.'),
    ];
    expect(assemble(results, { ...opts, anchors: true }, { ...plain, printed: { 4: '2' } })).toBe(
      [
        '{p1} Titel.',
        '',
        '{p4} Tekst.',
        '',
        '---',
        'Paginaconcordantie:',
        'PDF-pagina 1 = geen documentpaginanummer (titelblad)',
        'PDF-pagina 2 = geen documentpaginanummer',
        'PDF-pagina 3 = geen documentpaginanummer',
        'PDF-pagina 4 = documentpagina 2',
      ].join('\n'),
    );
  });

  it('een doorlopende zin: met een spatie, of zonder afbreekstreepje; het anker midden in de zin', () => {
    const both = { anchors: true, crossPage: true, dehyphen: true };
    const results = [
      read(1, 'loopt door op de'),
      read(2, 'volgende pagina met een verzeke-'),
      read(3, 'ring.'),
    ];
    expect(assemble(results, both, plain).split('\n\n')[0]).toBe(
      '{p1} loopt door op de {p2} volgende pagina met een verzeke{p3}ring.',
    );
    expect(assemble(results, { ...both, anchors: false }, plain)).toBe(
      'loopt door op de volgende pagina met een verzekering.',
    );
  });

  it('de keuze per overgang telt voor die pagina', () => {
    const both = { anchors: false, crossPage: true, dehyphen: true };
    const results = [read(1, 'Een hele zin.'), read(2, 'Nog een.'), read(3, 'en door')];
    expect(assemble(results, both, { ...plain, joins: { 2: 'join', 3: 'break' } })).toBe(
      'Een hele zin. Nog een.\n\nen door',
    );
  });

  it('zonder enige tekst ook geen concordantie', () => {
    const results = [{ no: 1, text: '', status: 'notext' }];
    expect(assemble(results, { ...opts, anchors: true }, plain)).toBe('');
  });
});
