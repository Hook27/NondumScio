import { describe, expect, it } from 'vitest';
import { byDateDesc, dateFromName, mergeName, moveId, orderEntries } from './merge';

const entry = (id: number, date: string) => ({ id, date });
const ids = (entries: readonly { id: number }[]) => entries.map((e) => e.id);

describe('dateFromName: de datum vooraan een al hernoemde naam', () => {
  it('JJMMDD vooraan, met of zonder rest en .pdf', () => {
    expect(dateFromName('260604 belastingdienst aanslag.pdf')).toBe('260604');
    expect(dateFromName('260604_02 ing.PDF')).toBe('260604');
    expect(dateFromName('260604')).toBe('260604');
  });

  it('geen datum vooraan, of een onmogelijke maand of dag: leeg', () => {
    expect(dateFromName('scan_20260604.pdf')).toBe('');
    expect(dateFromName('261304 x.pdf')).toBe('');
    expect(dateFromName('260600 x.pdf')).toBe('');
    expect(dateFromName('260632 x.pdf')).toBe('');
    expect(dateFromName('2606 x.pdf')).toBe('');
  });
});

describe('byDateDesc en orderEntries: de volgorde', () => {
  it('op datum: de nieuwste eerst, zonder datum achteraan, verder zoals het was', () => {
    const entries = [
      entry(1, ''),
      entry(2, '250101'),
      entry(3, '260422'),
      entry(4, ''),
      entry(5, '260129'),
    ];
    expect(ids([...entries].sort(byDateDesc))).toEqual([3, 5, 2, 1, 4]);
    expect(ids(orderEntries(entries, null))).toEqual([3, 5, 2, 1, 4]);
    // Gelijke datums houden hun volgorde.
    expect(ids(orderEntries([entry(1, '260101'), entry(2, '260101')], null))).toEqual([1, 2]);
  });

  it('een eigen volgorde blijft; wat erbij kwam onderaan op datum; wat weg is valt weg', () => {
    const entries = [entry(1, '260101'), entry(2, '260301'), entry(4, ''), entry(5, '260201')];
    expect(ids(orderEntries(entries, [2, 3, 1]))).toEqual([2, 1, 5, 4]);
  });
});

describe('moveId: één plek schuiven', () => {
  it('omhoog en omlaag, niet voorbij het begin of het einde', () => {
    expect(moveId([1, 2, 3], 2, -1)).toEqual([2, 1, 3]);
    expect(moveId([1, 2, 3], 2, 1)).toEqual([1, 3, 2]);
    expect(moveId([1, 2, 3], 1, -1)).toEqual([1, 2, 3]);
    expect(moveId([1, 2, 3], 3, 1)).toEqual([1, 2, 3]);
    expect(moveId([1, 2, 3], 9, 1)).toEqual([1, 2, 3]);
  });
});

describe('mergeName: de voorgestelde naam', () => {
  it('oudste en nieuwste datum, één datum, of geen datum', () => {
    expect(mergeName(['260422', '', '260129', '260301'], 'samengevoegd')).toBe(
      '260129-260422 samengevoegd.pdf',
    );
    expect(mergeName(['260422', '260422'], 'samengevoegd')).toBe('260422 samengevoegd.pdf');
    expect(mergeName(['', ''], 'merged')).toBe('merged.pdf');
    expect(mergeName([], 'samengevoegd')).toBe('samengevoegd.pdf');
  });
});
