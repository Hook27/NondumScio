import { describe, expect, it } from 'vitest';
import type { OutlineEntry } from '../outline/outline';
import { initialPages, type PageItem } from '../pages/plan';
import {
  autoName,
  bookmarkParts,
  cleanName,
  duplicateNames,
  fileNameOf,
  flattenMarks,
  maxDepth,
  uniqueNames,
  zipPath,
  type Mark,
  type PartOptions,
} from './bookmarks';

/** Een bladwijzer: titel, pagina in het bestand (vanaf 0) of null, en wat eronder valt. */
function entry(title: string, page: number | null, children: OutlineEntry[] = []): OutlineEntry {
  return { id: title, title, page, children };
}

const options: PartOptions = { level: 0, overlap: false, frontMatter: 'Voorwerk' };

/** De delen als "titel van-tot" (vanaf 1), zoals je ze in de tabel ziet. */
function partsOf(marks: Mark[], pages: PageItem[], extra: Partial<PartOptions> = {}) {
  return bookmarkParts(marks, pages, { ...options, ...extra }).map(
    (part) =>
      `${part.title} ${part.from + 1}-${part.to + 1}${part.also.length ? ` ook ${part.also.join('|')}` : ''}`,
  );
}

const report = [
  entry('Inleiding', 1),
  entry('Hoofdstuk 1', 3, [entry('Paragraaf 1.1', 3), entry('Paragraaf 1.2', 5)]),
  entry('Website', null),
  entry('Bijlage', 8),
];

describe('flattenMarks', () => {
  it('zet de boom plat in documentvolgorde, met niveau en plek in het plan', () => {
    const marks = flattenMarks([{ doc: 0, entries: report }], initialPages(10), '(naamloos)');
    const chapter = { title: 'Hoofdstuk 1', children: true };
    expect(marks).toEqual([
      { title: 'Inleiding', depth: 1, position: 1, top: { title: 'Inleiding', children: false } },
      { title: 'Hoofdstuk 1', depth: 1, position: 3, top: chapter },
      { title: 'Paragraaf 1.1', depth: 2, position: 3, top: chapter },
      { title: 'Paragraaf 1.2', depth: 2, position: 5, top: chapter },
      { title: 'Website', depth: 1, position: null, top: { title: 'Website', children: false } },
      { title: 'Bijlage', depth: 1, position: 8, top: { title: 'Bijlage', children: false } },
    ]);
    expect(maxDepth(marks)).toBe(2);
    expect(maxDepth([])).toBe(0);
  });

  it('geeft diepere bladwijzers de hoofdbladwijzer van niveau 1, ook zonder titel', () => {
    const marks = flattenMarks(
      [{ doc: 0, entries: [entry('', null, [entry('A', 0, [entry('A1', 1)])]), entry('B', 2)] }],
      initialPages(3),
      '(naamloos)',
    );
    expect(marks.map((mark) => `${mark.title}: ${mark.top.title} ${mark.top.children}`)).toEqual([
      '(naamloos): (naamloos) true',
      'A: (naamloos) true',
      'A1: (naamloos) true',
      'B: B false',
    ]);
  });

  it('volgt het pagina-plan: een weggehaalde pagina geeft geen plek, de rest schuift op', () => {
    const pages = initialPages(10).filter((page) => page.source !== 3);
    const marks = flattenMarks([{ doc: 0, entries: report }], pages, '(naamloos)');
    expect(marks.map((mark) => mark.position)).toEqual([1, null, null, 4, null, 7]);
  });

  it('geeft een bladwijzer zonder titel de naam voor naamloos', () => {
    const marks = flattenMarks(
      [{ doc: 0, entries: [entry('', 0)] }],
      initialPages(2),
      '(naamloos)',
    );
    expect(marks[0]!.title).toBe('(naamloos)');
  });

  it('zet bij meer bestanden de bladwijzers per bestand achter elkaar', () => {
    const pages = [...initialPages(3, 1), ...initialPages(2, 2, 3)];
    const marks = flattenMarks(
      [
        { doc: 1, entries: [entry('A', 0)] },
        { doc: 2, entries: [entry('B', 1)] },
      ],
      pages,
      '',
    );
    expect(marks.map((mark) => [mark.title, mark.position])).toEqual([
      ['A', 0],
      ['B', 4],
    ]);
  });
});

describe('bookmarkParts', () => {
  const pages = initialPages(10);
  const marks = flattenMarks([{ doc: 0, entries: report }], pages, '(naamloos)');

  it('loopt van de pagina van een bladwijzer tot de pagina vóór de volgende, met voorwerk', () => {
    expect(partsOf(marks, pages)).toEqual([
      'Voorwerk 1-1',
      'Inleiding 2-3',
      'Paragraaf 1.1 4-5 ook Hoofdstuk 1',
      'Paragraaf 1.2 6-8',
      'Bijlage 9-10',
    ]);
    const [, , shared] = bookmarkParts(marks, pages, options);
    expect(shared).toMatchObject({ depth: 2, from: 3, to: 4, also: ['Hoofdstuk 1'] });
  });

  it('kent elk deel de hoofdbladwijzer van zijn naamgever toe; voorwerk heeft er geen', () => {
    const tops = bookmarkParts(marks, pages, options).map((part) => part.top?.title ?? null);
    expect(tops).toEqual([null, 'Inleiding', 'Hoofdstuk 1', 'Hoofdstuk 1', 'Bijlage']);
    const two = [...initialPages(2, 1), ...initialPages(2, 2, 2)];
    const both = flattenMarks([{ doc: 1, entries: [entry('A', 0, [entry('A1', 1)])] }], two, '');
    expect(
      bookmarkParts(both, two, { ...options, fileTitles: new Map([[2, 'tweede']]) }).map(
        (part) => `${part.title}: ${part.top?.title ?? '-'}`,
      ),
    ).toEqual(['A: A', 'A1: A', 'tweede: -']);
  });

  it('kan alleen tot een niveau splitsen', () => {
    expect(partsOf(marks, pages, { level: 1 })).toEqual([
      'Voorwerk 1-1',
      'Inleiding 2-3',
      'Hoofdstuk 1 4-8',
      'Bijlage 9-10',
    ]);
  });

  it('zet met de grenspagina de eerste pagina van een deel ook achteraan het vorige', () => {
    expect(partsOf(marks, pages, { overlap: true })).toEqual([
      'Voorwerk 1-2',
      'Inleiding 2-4',
      'Paragraaf 1.1 4-6 ook Hoofdstuk 1',
      'Paragraaf 1.2 6-9',
      'Bijlage 9-10',
    ]);
  });

  it('heeft geen voorwerk als de eerste bladwijzer op de eerste pagina staat', () => {
    const first = flattenMarks([{ doc: 0, entries: [entry('A', 0), entry('B', 2)] }], pages, '');
    expect(partsOf(first, pages)).toEqual(['A 1-2', 'B 3-10']);
  });

  it('geeft de diepste bladwijzer de naam, bij gelijke diepte de eerste', () => {
    const same = flattenMarks(
      [{ doc: 0, entries: [entry('A', 0, [entry('A1', 0), entry('A2', 0)]), entry('B', 0)] }],
      pages,
      '',
    );
    expect(partsOf(same, pages)).toEqual(['A1 1-10 ook A|A2|B']);
  });

  it('sorteert op pagina, ook als de bladwijzers dat niet doen', () => {
    const shuffled = flattenMarks([{ doc: 0, entries: [entry('B', 5), entry('A', 2)] }], pages, '');
    expect(partsOf(shuffled, pages)).toEqual(['Voorwerk 1-2', 'A 3-5', 'B 6-10']);
  });

  it('maakt geen delen zonder bruikbare bladwijzer', () => {
    expect(bookmarkParts([], pages, options)).toEqual([]);
    const none = flattenMarks([{ doc: 0, entries: [entry('Website', null)] }], pages, '');
    expect(bookmarkParts(none, pages, options)).toEqual([]);
    // Alleen diepere bladwijzers hebben een pagina: met "alleen niveau 1" blijft er niets over.
    const deep = flattenMarks(
      [{ doc: 0, entries: [entry('A', null, [entry('A1', 3)])] }],
      pages,
      '',
    );
    expect(bookmarkParts(deep, pages, { ...options, level: 1 })).toEqual([]);
    expect(partsOf(deep, pages)).toEqual(['Voorwerk 1-3', 'A1 4-10']);
    // Ook bij meer bestanden: zonder bladwijzers geen delen per bestand.
    const two = [...initialPages(2, 1), ...initialPages(2, 2, 2)];
    expect(bookmarkParts([], two, { ...options, fileTitles: new Map([[2, 'tweede']]) })).toEqual(
      [],
    );
  });

  it('begint bij meer bestanden een nieuw deel waar een volgend bestand begint', () => {
    const two = [...initialPages(4, 1), ...initialPages(3, 2, 4)];
    const fileTitles = new Map([
      [1, 'eerste'],
      [2, 'tweede'],
    ]);
    const both = flattenMarks(
      [
        { doc: 1, entries: [entry('A', 1)] },
        { doc: 2, entries: [entry('B', 1)] },
      ],
      two,
      '',
    );
    // Het tweede bestand begint zonder bladwijzer: dat deel heet naar het bestand. De
    // grenspagina doet bij een nieuw bestand niet mee (daar is een pagina nooit half).
    expect(partsOf(both, two, { fileTitles })).toEqual([
      'Voorwerk 1-1',
      'A 2-4',
      'tweede 5-5',
      'B 6-7',
    ]);
    expect(partsOf(both, two, { fileTitles, overlap: true })).toEqual([
      'Voorwerk 1-2',
      'A 2-4',
      'tweede 5-6',
      'B 6-7',
    ]);
    // Een bladwijzer op de eerste pagina van het volgende bestand geeft dat deel zijn naam.
    const atStart = flattenMarks(
      [
        { doc: 1, entries: [entry('A', 0)] },
        { doc: 2, entries: [entry('B', 0)] },
      ],
      two,
      '',
    );
    expect(partsOf(atStart, two, { fileTitles, overlap: true })).toEqual(['A 1-4', 'B 5-7']);
  });
});

describe('zipPath', () => {
  const chapter = { title: 'Hoofdstuk 1 / Inleiding', children: true };
  it('zet een deel in de map van zijn hoofdbladwijzer, als daar bladwijzers onder vallen', () => {
    expect(zipPath('03 - Paragraaf.pdf', chapter, true, 'naamloos')).toBe(
      'Hoofdstuk 1 - Inleiding/03 - Paragraaf.pdf',
    );
    expect(zipPath('03 - Paragraaf.pdf', { title: '..', children: true }, true, 'naamloos')).toBe(
      'naamloos/03 - Paragraaf.pdf',
    );
  });

  it('laat een deel in de hoofdmap: alles in één map, voorwerk, of een hoofdbladwijzer zonder onderliggende', () => {
    expect(zipPath('03 - Paragraaf.pdf', chapter, false, 'naamloos')).toBe('03 - Paragraaf.pdf');
    expect(zipPath('01 - Voorwerk.pdf', null, true, 'naamloos')).toBe('01 - Voorwerk.pdf');
    expect(zipPath('02 - Bijlage.pdf', { title: 'Bijlage', children: false }, true, 'x')).toBe(
      '02 - Bijlage.pdf',
    );
  });
});

describe('namen', () => {
  it('maakt van een titel een bestandsnaam zoals het origineel', () => {
    expect(cleanName('Boekstuk 12 / € 19,95', 'naamloos')).toBe('Boekstuk 12 - € 19,95');
    expect(cleanName('a//b', 'naamloos')).toBe('a - - b');
    expect(cleanName('vraag? "ja" <nee> | x*y\\z:', 'naamloos')).toBe('vraag ja nee xyz');
    // Stuurtekens (ook een regelovergang of tab) vervallen, net als in het origineel.
    expect(cleanName('regel\neinde\ttab', 'naamloos')).toBe('regeleindetab');
    expect(cleanName('  eind...  ', 'naamloos')).toBe('eind');
    expect(cleanName('***', 'naamloos')).toBe('naamloos');
    expect(cleanName('Café Jörg', 'naamloos')).toBe('Café Jörg');
    expect(cleanName('x'.repeat(200), 'naamloos')).toHaveLength(150);
    // Afkappen op 150, daarna pas punten en spaties aan het eind weg.
    expect(cleanName(`${'x'.repeat(148)} .y`, 'naamloos')).toBe('x'.repeat(148));
  });

  it('nummert met minstens twee cijfers, en zoveel als het aantal delen nodig heeft', () => {
    expect(autoName('Inleiding', 0, 5, '', 'naamloos')).toBe('01 - Inleiding.pdf');
    expect(autoName('Inleiding', 9, 10, '', 'naamloos')).toBe('10 - Inleiding.pdf');
    expect(autoName('Inleiding', 0, 342, '', 'naamloos')).toBe('001 - Inleiding.pdf');
    expect(autoName('Inleiding', 0, 1000, '', 'naamloos')).toBe('0001 - Inleiding.pdf');
  });

  it('zet een opgeschoond voorvoegsel ervoor', () => {
    expect(autoName('Inleiding', 2, 5, ' 2026 / Q1 ', 'naamloos')).toBe(
      '2026 - Q1 03 - Inleiding.pdf',
    );
    expect(autoName('Inleiding', 2, 5, '***', 'naamloos')).toBe('03 - Inleiding.pdf');
    expect(autoName('?', 0, 5, '', 'naamloos')).toBe('01 - naamloos.pdf');
  });

  it('schoont een zelf aangepaste naam op en zet er .pdf achter', () => {
    expect(fileNameOf('01 - Inleiding.pdf', 'naamloos')).toBe('01 - Inleiding.pdf');
    expect(fileNameOf('rapport.PDF', 'naamloos')).toBe('rapport.pdf');
    expect(fileNameOf('a/b', 'naamloos')).toBe('a - b.pdf');
    expect(fileNameOf('   ', 'naamloos')).toBe('naamloos.pdf');
    expect(fileNameOf('x.pdf.pdf', 'naamloos')).toBe('x.pdf');
  });

  it('vindt dubbele namen, ook met andere hoofdletters', () => {
    expect([...duplicateNames(['a.pdf', 'b.pdf', 'A.PDF', null, 'a.pdf'])]).toEqual([0, 2, 4]);
    // Een deel dat niet meegaat (null), telt niet mee.
    expect([...duplicateNames(['a.pdf', null, 'b.pdf'])]).toEqual([]);
  });

  it('geeft dubbele namen in de ZIP een volgnummer', () => {
    expect(uniqueNames(['a.pdf', 'A.pdf', 'b.pdf', 'a.pdf', 'a (2).pdf', 'zonder'])).toEqual([
      'a.pdf',
      'A (2).pdf',
      'b.pdf',
      'a (3).pdf',
      'a (2) (2).pdf',
      'zonder',
    ]);
  });
});
