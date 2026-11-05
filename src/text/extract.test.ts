import { describe, expect, it } from 'vitest';
import type { PageText, Piece } from '../compare/layout';
import {
  DEFAULT_TEXT_OPTIONS,
  LOW_TEXT,
  exportName,
  extractText,
  quality,
  type PageResult,
} from './extract';

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
  it('zet de pagina’s na elkaar, met een witregel ertussen, en laat pagina’s zonder tekst weg', () => {
    const { text, pages } = extractText(
      [
        page(1, [['De eerste alinea loopt', 'over twee regels.'], ['De tweede alinea.']]),
        empty(2),
        page(3, [['Op pagina drie.']]),
      ],
      DEFAULT_TEXT_OPTIONS,
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
    const stripped = extractText(pages, DEFAULT_TEXT_OPTIONS).text;
    expect(stripped).not.toContain('Rapport 2026');
    expect(stripped).not.toMatch(/Pagina \d van 3/);

    const kept = extractText(pages, { ...DEFAULT_TEXT_OPTIONS, strip: false }).text;
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
    expect(extractText([word], DEFAULT_TEXT_OPTIONS).text).toBe(
      'De eerste alinea loopt over twee regels.\n\nDe tweede alinea, ook over twee regels.',
    );
    expect(extractText([word], { ...DEFAULT_TEXT_OPTIONS, gapFactor: 1.6 }).text).toBe(
      'De eerste alinea loopt over twee regels. De tweede alinea, ook over twee regels.',
    );
  });

  it('laat elke regel los als regels niet worden samengevoegd', () => {
    const doc = [page(1, [['Regel een', 'regel twee'], ['Regel drie']])];
    expect(extractText(doc, { ...DEFAULT_TEXT_OPTIONS, joinLines: false }).text).toBe(
      'Regel een\nregel twee\nRegel drie',
    );
  });

  it('herstelt afgebroken woorden, behalve als dat uit staat', () => {
    const doc = [page(1, [['Dit is een verge-', 'lijking van tekst.']])];
    expect(extractText(doc, DEFAULT_TEXT_OPTIONS).text).toBe('Dit is een vergelijking van tekst.');
    expect(extractText(doc, { ...DEFAULT_TEXT_OPTIONS, dehyphen: false }).text).toBe(
      'Dit is een verge- lijking van tekst.',
    );
  });

  it('geeft lege tekst als geen enkele pagina een tekstlaag heeft', () => {
    expect(extractText([empty(1), empty(2)], DEFAULT_TEXT_OPTIONS).text).toBe('');
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
      ]),
    ).toEqual({ read: 3, average: Math.round((100 + 24 + 25) / 3), noText: [2], low: [3] });
  });

  it('heeft zonder gelezen pagina’s een gemiddelde van 0', () => {
    expect(quality([{ no: 1, text: '', status: 'notext' }])).toEqual({
      read: 0,
      average: 0,
      noText: [1],
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
