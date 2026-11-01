import { describe, expect, it } from 'vitest';
import type { PageText } from './layout';
import { FIELDS, pageRows, pdfDate, profileRows, type ProfileDoc } from './profile';

/** Een pagina met een maat en een aantal tekens (0 = geen tekstlaag). */
function page(no: number, chars: number, w = 595, h = 842): PageText {
  const items = chars > 0 ? [{ str: 'x'.repeat(chars), x: 50, y: 700, fh: 10, w: 50 }] : [];
  return { no, w, h, items, chars };
}

const doc = (pages: PageText[], change: Partial<ProfileDoc> = {}): ProfileDoc => ({
  name: 'a.pdf',
  size: 2048,
  pageCount: pages.length,
  pages,
  info: {},
  ...change,
});

const WORDS = { yes: 'ja', no: 'nee' };

describe('pdfDate', () => {
  it('maakt van een PDF-datum een leesbare datum, zonder om te rekenen naar een andere tijdzone', () => {
    expect(pdfDate("D:20180604090000+02'00'", 'nl')).toBe('4 juni 2018, 09:00');
    expect(pdfDate('D:20180604090000Z', 'en')).toBe('4 June 2018, 09:00');
    expect(pdfDate('D:20181231', 'nl')).toBe('31 december 2018');
    expect(pdfDate('20180104', 'nl')).toBe('4 januari 2018');
  });

  it('laat leeg leeg, en laat staan wat geen datum is', () => {
    expect(pdfDate(undefined, 'nl')).toBe('');
    expect(pdfDate('', 'nl')).toBe('');
    expect(pdfDate('gisteren', 'nl')).toBe('gisteren');
    expect(pdfDate('D:20181304', 'nl')).toBe('D:20181304');
  });
});

describe('profileRows', () => {
  it('zet de 16 velden van A en B naast elkaar, met wat verschilt', () => {
    const a = doc([page(1, 100), page(2, 0)], {
      info: {
        PDFFormatVersion: '1.7',
        Title: 'Huurovereenkomst',
        Author: 'Jansen',
        Subject: ' ',
        Creator: 'Word',
        Producer: 'Microsoft: Print To PDF',
        CreationDate: 'D:20260101120000',
        ModDate: 'D:20260102120000',
      },
    });
    const b = doc([page(1, 100), page(2, 0), page(3, 50, 842, 595)], {
      name: 'b.pdf',
      size: 3 * 1024 * 1024,
      info: {
        PDFFormatVersion: '1.7',
        EncryptFilterName: 'Standard',
        Title: 'Huurovereenkomst',
        Author: '  ',
        Creator: 'Word',
        Producer: 'Microsoft: Print To PDF',
        CreationDate: 'D:20260101120000',
        ModDate: 'D:20260301093000',
      },
    });
    const rows = profileRows(a, b, 'nl', WORDS);
    expect(rows.map((row) => row.id)).toEqual([...FIELDS]);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId.name).toEqual({ id: 'name', a: 'a.pdf', b: 'b.pdf', differs: true });
    expect(byId.size).toMatchObject({ a: '2 KB', b: '3 MB', differs: true });
    expect(byId.pages).toMatchObject({ a: '2', b: '3', differs: true });
    expect(byId.sizes).toMatchObject({
      a: '595×842 pt (2)',
      b: '595×842 pt (2), 842×595 pt (1)',
      differs: true,
    });
    expect(byId.version).toMatchObject({ a: '1.7', b: '1.7', differs: false });
    expect(byId.encrypted).toMatchObject({ a: 'nee', b: 'ja', differs: true });
    expect(byId.title!.differs).toBe(false);
    // Alleen spaties telt als leeg.
    expect(byId.author).toMatchObject({ a: 'Jansen', b: '', differs: true });
    expect(byId.subject).toMatchObject({ a: '', b: '', differs: false });
    expect(byId.created).toMatchObject({ a: '1 januari 2026, 12:00', differs: false });
    expect(byId.modified).toMatchObject({
      a: '2 januari 2026, 12:00',
      b: '1 maart 2026, 09:30',
      differs: true,
    });
    expect(byId.chars).toMatchObject({ a: '100', b: '150', differs: true });
    expect(byId.noText).toMatchObject({ a: '1', b: '1', differs: false });
  });

  it('schrijft getallen in de taal van de app', () => {
    const big = doc([page(1, 12345)]);
    const [nl] = profileRows(big, big, 'nl', WORDS).filter((row) => row.id === 'chars');
    const [en] = profileRows(big, big, 'en', WORDS).filter((row) => row.id === 'chars');
    expect(nl!.a).toBe('12.345');
    expect(en!.a).toBe('12,345');
  });
});

describe('pageRows', () => {
  it('ziet pagina’s die alleen in A of B staan, een ander formaat en pagina’s zonder tekst', () => {
    const a = doc([page(1, 100), page(2, 0), page(3, 0), page(4, 100), page(5, 100)]);
    const b = doc([page(1, 100, 842, 595), page(2, 0), page(3, 100), page(4, 0)]);
    expect(pageRows(a, b).map((row) => row.notes)).toEqual([
      [{ kind: 'size' }],
      [{ kind: 'noTextBoth' }],
      [{ kind: 'noTextA' }],
      [{ kind: 'noTextB' }],
      [{ kind: 'onlyA' }],
    ]);
    expect(pageRows(b, a)[4]!.notes).toEqual([{ kind: 'onlyB' }]);
    expect(pageRows(a, b)[4]).toMatchObject({ no: 5, b: null });
  });

  it('meldt een verschil in tekens pas als het duidelijk is: meer dan 20 én meer dan 10 %', () => {
    const notes = (ca: number, cb: number) =>
      pageRows(doc([page(1, ca)]), doc([page(1, cb)]))[0]!.notes;
    expect(notes(100, 121)).toEqual([{ kind: 'chars', n: 21 }]);
    expect(notes(100, 120)).toEqual([]);
    expect(notes(1000, 900)).toEqual([]);
    expect(notes(1000, 899)).toEqual([{ kind: 'chars', n: -101 }]);
  });
});
