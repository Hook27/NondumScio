import { describe, expect, it } from 'vitest';
import { formatPrVersion, parsePrNumber, versionLabel } from './version';

describe('formatPrVersion', () => {
  it('vult aan tot drie cijfers', () => {
    expect(formatPrVersion(8)).toBe('PR.008');
    expect(formatPrVersion(9)).toBe('PR.009');
    expect(formatPrVersion(42)).toBe('PR.042');
    expect(formatPrVersion(123)).toBe('PR.123');
  });

  it('kapt grotere nummers niet af', () => {
    expect(formatPrVersion(1000)).toBe('PR.1000');
  });

  it('weigert ongeldige nummers', () => {
    expect(() => formatPrVersion(0)).toThrow(RangeError);
    expect(() => formatPrVersion(-3)).toThrow(RangeError);
    expect(() => formatPrVersion(1.5)).toThrow(RangeError);
    expect(() => formatPrVersion(Number.NaN)).toThrow(RangeError);
  });
});

describe('parsePrNumber', () => {
  it('leest een gewone merge', () => {
    expect(parsePrNumber('Merge pull request #9 from Hook27/pr9-favicon-versie')).toBe(9);
    expect(parsePrNumber('Merge pull request #123 from Hook27/x')).toBe(123);
  });

  it('leest een squash-merge', () => {
    expect(parsePrNumber('Voeg app-schil toe (#8)')).toBe(8);
    expect(parsePrNumber('Voeg app-schil toe (#8)  ')).toBe(8);
  });

  it('geeft null zonder PR-nummer', () => {
    expect(parsePrNumber('Voeg iets toe')).toBeNull();
    expect(parsePrNumber('')).toBeNull();
  });

  it('negeert verwijzingen die geen PR-nummer zijn', () => {
    expect(parsePrNumber('Los #12 op')).toBeNull();
    expect(parsePrNumber('Zie (#12) voor details en meer')).toBeNull();
    expect(parsePrNumber('Revert "Merge pull request #7 from x"')).toBeNull();
  });
});

describe('versionLabel', () => {
  it('gebruikt een opgegeven PR-nummer', () => {
    expect(versionLabel({ pr: 9 })).toBe('PR.009');
  });

  it('leest het PR-nummer uit een commitbericht', () => {
    expect(versionLabel({ subject: 'Merge pull request #8 from Hook27/pr8-app-schil' })).toBe(
      'PR.008',
    );
  });

  it('valt terug op de korte commitcode, en dan op "dev"', () => {
    expect(
      versionLabel({ subject: 'Geen nummer', sha: 'fa50e703702a80948b037bb4259839601c8fdddd' }),
    ).toBe('fa50e70');
    expect(versionLabel({})).toBe('dev');
  });
});
