import { describe, expect, it } from 'vitest';
import { formatFileSize } from './format';

describe('formatFileSize', () => {
  it('toont bytes zonder decimalen', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('schakelt over op de volgende eenheid bij 1024', () => {
    expect(formatFileSize(1023, 'en')).toBe('1,023 B');
    expect(formatFileSize(1023, 'nl')).toBe('1.023 B');
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
  });

  it('gebruikt maximaal één decimaal', () => {
    expect(formatFileSize(1536, 'en')).toBe('1.5 KB');
    expect(formatFileSize(2.25 * 1024 * 1024, 'en')).toBe('2.3 MB');
  });

  it('volgt de taal voor het decimaalteken', () => {
    expect(formatFileSize(1536, 'nl')).toBe('1,5 KB');
    expect(formatFileSize(1536, 'en')).toBe('1.5 KB');
  });

  it('gaat niet verder dan GB', () => {
    expect(formatFileSize(5 * 1024 ** 4, 'en')).toBe('5,120 GB');
  });

  it('weigert ongeldige invoer', () => {
    expect(() => formatFileSize(-1)).toThrow(RangeError);
    expect(() => formatFileSize(Number.NaN)).toThrow(RangeError);
    expect(() => formatFileSize(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
