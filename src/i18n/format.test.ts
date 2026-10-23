import { describe, expect, it } from 'vitest';
import { format, plural } from './format';

describe('format', () => {
  it('vult plekken in', () => {
    expect(format('Pagina {n}', { n: 3 })).toBe('Pagina 3');
    expect(format('{name} is geen PDF.', { name: 'foto.jpg' })).toBe('foto.jpg is geen PDF.');
    expect(format('{a} en {b}', { a: 1, b: 2 })).toBe('1 en 2');
  });

  it('laat een onbekende plek zichtbaar staan', () => {
    expect(format('Pagina {n}', {})).toBe('Pagina {n}');
  });

  it('vult dezelfde plek vaker in', () => {
    expect(format('{x}-{x}', { x: 'a' })).toBe('a-a');
  });

  it('verandert niets aan een tekst zonder plekken', () => {
    expect(format('Sluiten', { n: 1 })).toBe('Sluiten');
  });
});

describe('plural', () => {
  it('kiest enkelvoud bij 1 en meervoud bij andere aantallen', () => {
    expect(plural(1, '1 pagina', '{n} pagina’s')).toBe('1 pagina');
    expect(plural(0, '1 pagina', '{n} pagina’s')).toBe('0 pagina’s');
    expect(plural(12, '1 page', '{n} pages')).toBe('12 pages');
  });
});
