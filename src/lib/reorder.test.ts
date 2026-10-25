import { describe, expect, it } from 'vitest';
import { moveBy, moveTo } from './reorder';

const abcd = ['a', 'b', 'c', 'd'];

describe('moveBy', () => {
  it('verplaatst een onderdeel een plek omhoog of omlaag', () => {
    expect(moveBy(abcd, 2, -1)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveBy(abcd, 1, 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('laat de lijst ongemoeid als het niet kan', () => {
    expect(moveBy(abcd, 0, -1)).toBe(abcd);
    expect(moveBy(abcd, 3, 1)).toBe(abcd);
    expect(moveBy(abcd, 9, 1)).toBe(abcd);
  });

  it('wijzigt de oorspronkelijke lijst niet', () => {
    moveBy(abcd, 0, 1);
    expect(abcd).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('moveTo', () => {
  it('zet een onderdeel op een plek vóór een ander, zoals het streepje bij slepen aanwijst', () => {
    expect(moveTo(abcd, 0, 3)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTo(abcd, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
    expect(moveTo(abcd, 1, 0)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('kan helemaal vooraan of achteraan', () => {
    expect(moveTo(abcd, 2, 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveTo(abcd, 0, 4)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('verandert niets bij loslaten op de eigen plek', () => {
    expect(moveTo(abcd, 1, 1)).toBe(abcd);
    expect(moveTo(abcd, 1, 2)).toBe(abcd);
    expect(moveTo(abcd, 3, 4)).toBe(abcd);
  });

  it('begrenst een plek buiten de lijst en negeert een onbekend onderdeel', () => {
    expect(moveTo(abcd, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveTo(abcd, 2, -5)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveTo(abcd, 7, 0)).toBe(abcd);
  });
});
