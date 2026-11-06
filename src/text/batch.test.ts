import { describe, expect, it } from 'vitest';
import type { PageText, Piece } from '../compare/layout';
import { messages } from '../i18n';
import {
  DUTCH_CONTEXT,
  combineParts,
  combinedHead,
  combinedPart,
  docText,
  hasText,
  zipNames,
  type BatchContext,
  type BatchDoc,
} from './batch';
import { DEFAULT_TEXT_OPTIONS } from './extract';
import { DUTCH_HEAD } from './header';

/** Een pagina met regels, van boven naar beneden, met onderaan eventueel een paginanummer. */
function page(no: number, lines: string[], printed?: string): PageText {
  const items: Piece[] = lines.map((str, i) => ({
    str,
    x: 50,
    y: 740 - i * 12,
    fh: 10,
    w: str.length * 5,
  }));
  if (printed) items.push({ str: printed, x: 290, y: 30, fh: 10, w: 5 });
  return { no, w: 595, h: 842, items, chars: items.reduce((n, i) => n + i.str.length, 0) };
}
const empty = (no: number): PageText => ({ no, w: 595, h: 842, items: [], chars: 0 });

const INFO = {
  Title: 'Notulen',
  Author: 'Bewonerscommissie',
  CreationDate: "D:20180604090000+02'00'",
};
const NOTULEN: BatchDoc = {
  name: 'notulen.pdf',
  pages: [page(1, ['De vergadering begint.']), page(2, ['Einde van de vergadering.'])],
  info: INFO,
};
const SCAN: BatchDoc = { name: 'scan.pdf', pages: [empty(1)], info: {} };

/** Standaard, maar zonder ankers en doorlopende zinnen (die hebben hun eigen tests). */
const PLAIN = { ...DEFAULT_TEXT_OPTIONS, anchors: false, crossPage: false };

const en = messages.en.plainText;
const ENGLISH: BatchContext = {
  concordance: en.concordance,
  head: { fields: en.header.fields, conventions: en.conventions },
  words: { start: en.batch.start, end: en.batch.end },
};

describe('zipNames', () => {
  it('"naam.pdf" wordt "naam_extract.txt"; unieke namen krijgen geen nummer', () => {
    expect(zipNames(['brief.pdf', 'notulen.PDF', 'zonder'])).toEqual([
      { file: 'brief_extract.txt', label: 'brief.pdf' },
      { file: 'notulen_extract.txt', label: 'notulen.PDF' },
      { file: 'zonder_extract.txt', label: 'zonder' },
    ]);
  });

  it('een naam die vaker voorkomt: alle bestanden een nummer van twee cijfers, ook het eerste', () => {
    expect(zipNames(['bestand.pdf', 'bestand.pdf', 'bestand.pdf', 'bestand.pdf'])).toEqual([
      { file: 'bestand_extract (01).txt', label: 'bestand.pdf (01)' },
      { file: 'bestand_extract (02).txt', label: 'bestand.pdf (02)' },
      { file: 'bestand_extract (03).txt', label: 'bestand.pdf (03)' },
      { file: 'bestand_extract (04).txt', label: 'bestand.pdf (04)' },
    ]);
  });

  it('gemengd: alleen de dubbele namen krijgen een nummer, in de volgorde van kiezen', () => {
    expect(zipNames(['a.pdf', 'b.pdf', 'a.pdf', 'c.pdf']).map((n) => n.file)).toEqual([
      'a_extract (01).txt',
      'b_extract.txt',
      'a_extract (02).txt',
      'c_extract.txt',
    ]);
  });

  it('gelijk op hoofdletters na telt als gelijk; elk houdt zijn eigen schrijfwijze', () => {
    expect(zipNames(['Brief.pdf', 'brief.pdf', 'x.pdf', 'x.PDF']).map((n) => n.file)).toEqual([
      'Brief_extract (01).txt',
      'brief_extract (02).txt',
      'x_extract (01).txt',
      'x_extract (02).txt',
    ]);
  });

  it('vanaf 100 gelijke namen drie cijfers', () => {
    const names = zipNames(Array.from({ length: 101 }, () => 'a.pdf'));
    expect(names[0]!.file).toBe('a_extract (01).txt');
    expect(names[98]!.file).toBe('a_extract (99).txt');
    expect(names[99]!.file).toBe('a_extract (100).txt');
    expect(names[100]!.file).toBe('a_extract (101).txt');
    expect(new Set(names.map((n) => n.file)).size).toBe(101);
  });
});

describe('docText (voor de zip)', () => {
  it('zoals één PDF zonder leesvakken', () => {
    expect(docText(NOTULEN, PLAIN)).toBe('De vergadering begint.\n\nEinde van de vergadering.');
    expect(hasText(NOTULEN)).toBe(true);
    expect(hasText(SCAN)).toBe(false);
    // Eén pagina met tekst is genoeg, ook als de rest een scan is.
    expect(hasText({ ...SCAN, pages: [empty(1), ...NOTULEN.pages, empty(4)] })).toBe(true);
    expect(docText(SCAN, PLAIN)).toBe('');
  });

  it('met kop en conventieblok: de gewone variant, met de naam en de gegevens van deze PDF', () => {
    const opts = { ...DEFAULT_TEXT_OPTIONS, header: true, conventions: true };
    expect(docText(NOTULEN, opts)).toBe(
      [
        '=== Conventies ===',
        DUTCH_HEAD.conventions.intro,
        DUTCH_HEAD.conventions.anchors,
        DUTCH_HEAD.conventions.concordance,
        '==================',
        '',
        'Bestand: notulen.pdf',
        'Titel: Notulen',
        'Auteur: Bewonerscommissie',
        'Datum: 2018-06-04',
        '',
        '{p1} De vergadering begint.',
        '',
        '{p2} Einde van de vergadering.',
        '',
        '---',
        'Paginaconcordantie:',
        'PDF-pagina 1 = geen documentpaginanummer (titelblad)',
        'PDF-pagina 2 = geen documentpaginanummer',
      ].join('\n'),
    );
  });

  it('in de taal van de app', () => {
    const text = docText(NOTULEN, { ...PLAIN, header: true }, ENGLISH);
    expect(text.split('\n').slice(0, 4)).toEqual([
      'File: notulen.pdf',
      'Title: Notulen',
      'Author: Bewonerscommissie',
      'Date: 2018-06-04',
    ]);
  });
});

describe('in één bestand', () => {
  it('één document: begin met de gegevens, de tekst, en het einde', () => {
    expect(combinedPart(1, NOTULEN, PLAIN)).toBe(
      [
        'Bestand 1 start: notulen.pdf',
        'Titel: Notulen',
        'Auteur: Bewonerscommissie',
        'Datum: 2018-06-04',
        '',
        'De vergadering begint.',
        '',
        'Einde van de vergadering.',
        '',
        'Bestand 1 einde: notulen.pdf',
      ].join('\n'),
    );
  });

  it('per document geen kop of conventieblok (wel de concordantie); de gegevens altijd', () => {
    const opts = { ...DEFAULT_TEXT_OPTIONS, header: false, conventions: true };
    const part = combinedPart(3, NOTULEN, opts);
    expect(part).not.toContain('=== Conventies ===');
    expect(part).not.toContain('Bestand: notulen.pdf');
    expect(part.startsWith('Bestand 3 start: notulen.pdf\nTitel: Notulen\n')).toBe(true);
    expect(part).toContain('\n---\nPaginaconcordantie:\n');
    expect(
      part.endsWith('PDF-pagina 2 = geen documentpaginanummer\n\nBestand 3 einde: notulen.pdf'),
    ).toBe(true);
    expect(combinedPart(3, NOTULEN, { ...opts, header: true })).toBe(part);
  });

  it('zonder gegevens alleen de naam; zonder tekst alleen begin en einde', () => {
    expect(combinedPart(2, SCAN, PLAIN)).toBe(
      'Bestand 2 start: scan.pdf\n\nBestand 2 einde: scan.pdf',
    );
  });

  it('het conventieblok voor een batch, alleen als het aan staat', () => {
    expect(combinedHead(PLAIN)).toBe('');
    const c = DUTCH_HEAD.conventions;
    expect(combinedHead({ ...DEFAULT_TEXT_OPTIONS, conventions: true }).split('\n')).toEqual([
      '=== Conventies ===',
      c.intro,
      c.anchors,
      'Per brondocument staat een paginaconcordantie die fysieke PDF-pagina’s koppelt aan afgedrukte documentpaginanummers.',
      '"Bestand N start/einde: <naam>" markeert het begin en einde van elk brondocument.',
      '==================',
    ]);
  });

  it('alles samen, met een witregel tussen de delen', () => {
    const head = combinedHead({ ...PLAIN, conventions: true });
    const parts = [combinedPart(1, NOTULEN, PLAIN), combinedPart(3, SCAN, PLAIN)];
    expect(combineParts(head, parts)).toBe(`${head}\n\n${parts[0]}\n\n${parts[1]}`);
    expect(combineParts('', parts)).toBe(`${parts[0]}\n\n${parts[1]}`);
  });

  it('in de taal van de app', () => {
    expect(combinedPart(1, NOTULEN, PLAIN, ENGLISH).split('\n')).toEqual([
      'File 1 start: notulen.pdf',
      'Title: Notulen',
      'Author: Bewonerscommissie',
      'Date: 2018-06-04',
      '',
      'De vergadering begint.',
      '',
      'Einde van de vergadering.',
      '',
      'File 1 end: notulen.pdf',
    ]);
    expect(combinedHead({ ...PLAIN, conventions: true }, ENGLISH)).toContain(
      '\n"File N start/end: <name>" marks the start and end of each source document.\n',
    );
  });

  it('de woorden in het Nederlands zijn die van de extractor', () => {
    expect(DUTCH_CONTEXT.words).toEqual({
      start: messages.nl.plainText.batch.start,
      end: messages.nl.plainText.batch.end,
    });
  });
});
