import { describe, expect, it } from 'vitest';
import { formatRanges, parseRanges } from './ranges';

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
