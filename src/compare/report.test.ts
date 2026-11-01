import { describe, expect, it } from 'vitest';
import { messages } from '../i18n';
import { DEFAULT_OPTIONS, type Row, type Unit } from './diff';
import type { ProfileRow } from './profile';
import { buildReport, type ReportInput } from './report';

const unit = (page: number, val: string): Unit => ({ page, val, key: val });
const equal = (page: number, val: string, pageB = page): Row => ({
  kind: 'equal',
  a: unit(page, val),
  b: unit(pageB, val),
});

const ROWS: Row[] = [
  equal(1, 'Een.'),
  equal(1, 'Twee.'),
  {
    kind: 'changed',
    a: unit(1, 'De huur is 500 euro.'),
    b: unit(1, 'De huur is 550 euro.'),
    partsA: [],
    partsB: [],
  },
  { kind: 'removed', a: unit(1, 'Deze alinea vervalt.') },
  equal(1, 'Drie.'),
  equal(2, 'Vier.'),
  equal(2, 'Vijf.'),
  { kind: 'added', b: unit(2, 'Een nieuwe alinea.') },
];

const PROFILE: ProfileRow[] = [
  { id: 'name', a: 'oud.pdf', b: 'nieuw.pdf', differs: true },
  { id: 'title', a: 'Huur', b: 'Huur', differs: false },
  { id: 'author', a: 'Jansen', b: '', differs: true },
  { id: 'subject', a: '', b: 'Huurcontract', differs: true },
];

const input = (change: Partial<ReportInput> = {}): ReportInput => ({
  a: { name: 'oud.pdf', size: 1740, pageCount: 2, noText: 0 },
  b: { name: 'nieuw.pdf', size: 2048, pageCount: 1, noText: 0 },
  options: DEFAULT_OPTIONS,
  rows: ROWS,
  fallback: false,
  profile: PROFILE,
  texts: messages.nl.compare,
  language: 'nl',
  now: new Date(2026, 10, 1, 14, 30),
  ...change,
});

describe('buildReport', () => {
  it('geeft documenten, instellingen, profiel en de verschillen in blokken met één stuk context', () => {
    expect(buildReport(input())).toBe(
      [
        'PDF-VERGELIJKING',
        'Gemaakt: 01-11-2026, 14:30',
        'A: oud.pdf (2 pagina’s, 1,7 KB)',
        'B: nieuw.pdf (1 pagina, 2 KB)',
        'Instellingen: per alinea, alinea-gevoeligheid 1,3, kop- en voetteksten weggelaten, twee kolommen herkend, afgebroken woorden hersteld',
        '',
        '=== DOCUMENTPROFIEL ===',
        '≠ Bestandsnaam:',
        '    A: oud.pdf',
        '    B: nieuw.pdf',
        '  Titel:',
        '    A: Huur',
        '    B: Huur',
        '≠ Auteur:',
        '    A: Jansen',
        '    B: (leeg)',
        '≠ Onderwerp:',
        '    A: (leeg)',
        '    B: Huurcontract',
        '',
        '=== TEKSTVERSCHILLEN ===',
        '1 toegevoegd, 1 verwijderd, 1 gewijzigd',
        '',
        '@@ A pagina 1 | B pagina 1 @@',
        '  Twee.',
        '- De huur is 500 euro.',
        '+ De huur is 550 euro.',
        '- Deze alinea vervalt.',
        '  Drie.',
        '',
        '@@ A pagina 2 | B pagina 2 @@',
        '  Vijf.',
        '+ Een nieuwe alinea.',
        '',
      ].join('\n'),
    );
  });

  it('noemt de waarschuwingen en de instellingen zoals ze staan', () => {
    const report = buildReport(
      input({
        fallback: true,
        a: { name: 'scan.pdf', size: 500, pageCount: 3, noText: 2 },
        options: {
          ...DEFAULT_OPTIONS,
          level: 'line',
          ignoreCase: true,
          strip: false,
          columns: false,
        },
      }),
    );
    const lines = report.split('\n');
    expect(lines[4]).toBe(
      'Instellingen: per regel, hoofdletters genegeerd, afgebroken woorden hersteld',
    );
    expect(lines[5]).toBe(
      'LET OP: alleen op volgorde vergeleken (de documenten zijn te groot voor een volledige vergelijking).',
    );
    expect(lines[6]).toBe(
      'LET OP: pagina’s zonder tekstlaag — A: 2, B: 0. Die pagina’s zijn niet op tekst vergeleken.',
    );
  });

  it('neemt de pagina van het eerste stuk in een blok, ook als dat alleen in A of B staat', () => {
    const hunk = (rows: Row[]) =>
      buildReport(input({ rows }))
        .split('\n')
        .find((l) => l.startsWith('@@'));
    expect(hunk([{ kind: 'added', b: unit(3, 'X.') }])).toBe('@@ A pagina 3 | B pagina 3 @@');
    expect(hunk([{ kind: 'removed', a: unit(4, 'Y.') }])).toBe('@@ A pagina 4 | B pagina 4 @@');
    expect(hunk([equal(1, 'Z.', 2), { kind: 'removed', a: unit(1, 'Y.') }])).toBe(
      '@@ A pagina 1 | B pagina 2 @@',
    );
  });

  it('zegt het als er geen tekstverschillen zijn', () => {
    const report = buildReport(input({ rows: [equal(1, 'Een.')] }));
    expect(
      report.endsWith(
        '0 toegevoegd, 0 verwijderd, 0 gewijzigd\n\nGeen tekstverschillen gevonden met bovenstaande instellingen.\n',
      ),
    ).toBe(true);
    expect(report).not.toContain('@@');
  });

  it('in het Engels', () => {
    const report = buildReport(input({ texts: messages.en.compare, language: 'en' }));
    expect(report).toContain('PDF COMPARISON\nCreated: ');
    expect(report).toContain('Settings: by paragraph, paragraph sensitivity 1.3, ');
    expect(report).toContain('=== DOCUMENT PROFILE ===\n≠ File name:');
    expect(report).toContain('1 added, 1 removed, 1 changed');
    expect(report).toContain('@@ A page 1 | B page 1 @@');
    expect(report).toContain('    B: (empty)');
  });
});
