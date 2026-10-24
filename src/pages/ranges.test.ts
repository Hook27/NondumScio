import { describe, expect, it } from 'vitest';
import { chunkParts, formatRanges, parseParts, parseRanges } from './ranges';

const pagesOf = (text: string, count = 10) => {
  const result = parseRanges(text, count);
  return result.ok ? result.pages : result.error;
};

describe('parseRanges', () => {
  it('leest losse nummers en bereiken', () => {
    expect(pagesOf('1-3, 5')).toEqual([1, 2, 3, 5]);
    expect(pagesOf('7')).toEqual([7]);
    expect(pagesOf(' 2 4;6 ')).toEqual([2, 4, 6]);
  });

  it('kent open bereiken, omgekeerde bereiken en gedachtestreepjes', () => {
    expect(pagesOf('8-')).toEqual([8, 9, 10]);
    expect(pagesOf('-3')).toEqual([1, 2, 3]);
    expect(pagesOf('5-3')).toEqual([3, 4, 5]);
    expect(pagesOf('2 – 4')).toEqual([2, 3, 4]);
  });

  it('geeft de nummers gesorteerd en zonder dubbele', () => {
    expect(pagesOf('5, 1-3, 2')).toEqual([1, 2, 3, 5]);
  });

  it('meldt wat er niet klopt', () => {
    expect(pagesOf('')).toEqual({ code: 'empty' });
    expect(pagesOf(' , ')).toEqual({ code: 'empty' });
    expect(pagesOf('1-3, a')).toEqual({ code: 'invalid', part: 'a' });
    expect(pagesOf('1-2-3')).toEqual({ code: 'invalid', part: '1-2-3' });
    expect(pagesOf('-')).toEqual({ code: 'invalid', part: '-' });
    expect(pagesOf('2.5')).toEqual({ code: 'invalid', part: '2.5' });
    expect(pagesOf('0')).toEqual({ code: 'outOfRange', page: 0 });
    expect(pagesOf('3-12')).toEqual({ code: 'outOfRange', page: 12 });
  });

  it('past bij formatRanges: wat die schrijft, leest parseRanges terug', () => {
    const pages = [1, 2, 3, 6, 8, 9];
    expect(pagesOf(formatRanges(pages))).toEqual(pages);
  });
});

describe('parseParts (splitsen)', () => {
  const partsOf = (text: string, count = 10) => {
    const result = parseParts(text, count);
    return result.ok ? result.parts : result.error;
  };

  it('maakt van elk stuk tussen komma’s een eigen deel', () => {
    expect(partsOf('1-3, 4-6, 8-')).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [8, 9, 10],
    ]);
    expect(partsOf('2; 5')).toEqual([[2], [5]]);
  });

  it('staat binnen een deel losse nummers en omgekeerde bereiken toe', () => {
    expect(partsOf('1 3, 6-4')).toEqual([
      [1, 3],
      [4, 5, 6],
    ]);
  });

  it('meldt wat er niet klopt', () => {
    expect(partsOf('')).toEqual({ code: 'empty' });
    expect(partsOf(' , ;')).toEqual({ code: 'empty' });
    expect(partsOf('1-3, x')).toEqual({ code: 'invalid', part: 'x' });
    expect(partsOf('1-3, 9-12')).toEqual({ code: 'outOfRange', page: 12 });
  });
});

describe('chunkParts (splitsen per aantal)', () => {
  it('maakt delen van een vast aantal pagina’s; het laatste mag korter zijn', () => {
    expect(chunkParts(7, 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(chunkParts(3, 1)).toEqual([[1], [2], [3]]);
    expect(chunkParts(2, 5)).toEqual([[1, 2]]);
  });

  it('behandelt een onzinnig aantal als 1', () => {
    expect(chunkParts(2, 0)).toEqual([[1], [2]]);
    expect(chunkParts(2, Number.NaN)).toEqual([[1], [2]]);
  });
});
