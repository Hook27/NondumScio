import { describe, expect, it } from 'vitest';
import { messages } from '../i18n';
import {
  addFiles,
  counts,
  groups,
  isPdfFile,
  nextAfter,
  toggle,
  triageCsv,
  triageTxt,
  type Decision,
  type TriageFile,
} from './triage';

const file = (name: string, type = '') => new File(['x'], name, { type });

/** Een lijst met deze besluiten, namen a.pdf, b.pdf, … */
function list(...decisions: Decision[]): TriageFile[] {
  return decisions.map((decision, i) => ({
    id: i + 1,
    file: file(`${String.fromCharCode(97 + i)}.pdf`),
    name: `${String.fromCharCode(97 + i)}.pdf`,
    decision,
    page: 1,
  }));
}

describe('isPdfFile', () => {
  it('herkent een PDF op naam (ook in hoofdletters) of op type', () => {
    expect(isPdfFile(file('brief.pdf'))).toBe(true);
    expect(isPdfFile(file('BRIEF.PDF'))).toBe(true);
    expect(isPdfFile(file('zonder-extensie', 'application/pdf'))).toBe(true);
    expect(isPdfFile(file('foto.jpg', 'image/jpeg'))).toBe(false);
    expect(isPdfFile(file('brief.pdf.txt'))).toBe(false);
  });
});

describe('addFiles', () => {
  it('zet PDF’s achteraan, met een vast nummer, nog niet beoordeeld en op pagina 1', () => {
    const first = addFiles([], [file('a.pdf'), file('b.pdf')], 1);
    expect(first.list.map((e) => [e.id, e.name, e.decision, e.page])).toEqual([
      [1, 'a.pdf', null, 1],
      [2, 'b.pdf', null, 1],
    ]);
    expect(first.nextId).toBe(3);
    const second = addFiles(first.list, [file('c.pdf')], first.nextId);
    expect(second.list.map((e) => [e.id, e.name])).toEqual([
      [1, 'a.pdf'],
      [2, 'b.pdf'],
      [3, 'c.pdf'],
    ]);
    expect(second.nextId).toBe(4);
  });

  it('slaat andere bestanden en een naam die er al staat over, en telt ze', () => {
    const start = addFiles([], [file('a.pdf')], 1).list;
    const result = addFiles(
      start,
      [file('a.pdf'), file('foto.png'), file('b.pdf'), file('b.pdf'), file('notities.txt')],
      2,
    );
    expect(result.list.map((e) => e.name)).toEqual(['a.pdf', 'b.pdf']);
    expect(result.notPdf).toBe(2);
    expect(result.duplicate).toBe(2);
    expect(result.nextId).toBe(3);
  });

  it('laat de bestaande lijst ongemoeid', () => {
    const start = addFiles([], [file('a.pdf')], 1).list;
    addFiles(start, [file('b.pdf')], 2);
    expect(start.map((e) => e.name)).toEqual(['a.pdf']);
  });
});

describe('toggle', () => {
  it('nog eens dezelfde keuze haalt het besluit weg, een andere vervangt het', () => {
    expect(toggle(null, 'keep')).toBe('keep');
    expect(toggle('keep', 'keep')).toBe(null);
    expect(toggle('keep', 'remove')).toBe('remove');
    expect(toggle('remove', 'remove')).toBe(null);
  });
});

describe('nextAfter', () => {
  it('gaat naar het eerstvolgende nog niet beoordeelde bestand', () => {
    expect(nextAfter(list('keep', 'keep', null, null), 0)).toBe(2);
    expect(nextAfter(list('keep', null, 'remove', null), 1)).toBe(3);
  });

  it('kijkt niet terug: zonder onbeoordeelde erna gewoon het volgende', () => {
    expect(nextAfter(list(null, 'keep', 'keep', 'keep'), 1)).toBe(2);
  });

  it('blijft staan bij het laatste bestand', () => {
    expect(nextAfter(list(null, null, 'keep'), 2)).toBe(null);
    expect(nextAfter(list('keep'), 0)).toBe(null);
  });
});

describe('counts en groups', () => {
  it('tellen en groeperen in de volgorde van de lijst', () => {
    const files = list('keep', null, 'remove', 'keep', null);
    expect(counts(files)).toEqual({ keep: 2, remove: 1, done: 3, total: 5 });
    const all = groups(files);
    expect(all.keep.map((e) => e.name)).toEqual(['a.pdf', 'd.pdf']);
    expect(all.remove.map((e) => e.name)).toEqual(['c.pdf']);
    expect(all.none.map((e) => e.name)).toEqual(['b.pdf', 'e.pdf']);
  });
});

const nl = messages.nl.triage.export;
const en = messages.en.triage.export;

describe('triageTxt', () => {
  it('maakt de lijst zoals triage.txt van pdf-triage.html', () => {
    const files = list('keep', null, 'remove', 'keep');
    expect(triageTxt(files, nl)).toBe(
      [
        'ARCHIEF TRIAGE',
        '====================================',
        '',
        'BEWAREN:',
        '  a.pdf',
        '  d.pdf',
        '',
        'VERWIJDEREN:',
        '  c.pdf',
        '',
        'NIET BEOORDEELD:',
        '  b.pdf',
        '',
      ].join('\n'),
    );
  });

  it('laat lege groepen weg', () => {
    expect(triageTxt(list('remove'), nl)).toBe(
      'ARCHIEF TRIAGE\n====================================\n\nVERWIJDEREN:\n  a.pdf\n',
    );
    expect(triageTxt([], nl)).toBe('ARCHIEF TRIAGE\n====================================\n');
  });

  it('in het Engels met Engelse koppen', () => {
    expect(triageTxt(list('keep', null), en)).toBe(
      'ARCHIVE TRIAGE\n====================================\n\nKEEP:\n  a.pdf\n\nNOT REVIEWED:\n  b.pdf\n',
    );
  });
});

describe('triageCsv', () => {
  it('maakt de lijst zoals triage.csv: elke cel tussen aanhalingstekens, in de volgorde van de lijst', () => {
    expect(triageCsv(list('keep', null, 'remove'), nl)).toBe(
      [
        '"Bestandsnaam","Besluit"',
        '"a.pdf","bewaren"',
        '"b.pdf","niet beoordeeld"',
        '"c.pdf","verwijderen"',
      ].join('\n'),
    );
  });

  it('verdubbelt aanhalingstekens in een naam; komma’s blijven binnen de cel', () => {
    const files = list('keep');
    files[0] = { ...files[0]!, name: 'brief "oud", 2024.pdf' };
    expect(triageCsv(files, en)).toBe('"File name","Decision"\n"brief ""oud"", 2024.pdf","keep"');
  });
});
