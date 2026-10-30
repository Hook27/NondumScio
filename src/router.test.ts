import { describe, expect, it } from 'vitest';
import { ADVANCED_IDS, TASK_IDS, hrefFor, parseHash, sameRoute } from './router';

describe('parseHash', () => {
  it('geeft de startpagina bij een leeg adres', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
  });

  it('herkent elke taak', () => {
    for (const id of TASK_IDS) {
      expect(parseHash(`#/${id}`)).toEqual({ name: 'task', id });
    }
  });

  it('is soepel met een schuine streep ervoor of erachter en met een query', () => {
    expect(parseHash('#merge')).toEqual({ name: 'task', id: 'merge' });
    expect(parseHash('#/merge/')).toEqual({ name: 'task', id: 'merge' });
    expect(parseHash('#/split?x=1')).toEqual({ name: 'task', id: 'split' });
  });

  it('geeft "niet gevonden" bij een onbekend adres', () => {
    expect(parseHash('#/bestaat-niet')).toEqual({ name: 'notFound' });
    expect(parseHash('#/merge/extra')).toEqual({ name: 'notFound' });
    expect(parseHash('#/MERGE')).toEqual({ name: 'notFound' });
  });
});

describe('hrefFor', () => {
  it('maakt het adres bij een route', () => {
    expect(hrefFor({ name: 'home' })).toBe('#/');
    expect(hrefFor({ name: 'task', id: 'edit' })).toBe('#/edit');
  });

  it('geeft terug naar de startpagina bij "niet gevonden"', () => {
    expect(hrefFor({ name: 'notFound' })).toBe('#/');
  });

  it('is het omgekeerde van parseHash voor alle taken', () => {
    for (const id of TASK_IDS) {
      const route = { name: 'task', id } as const;
      expect(parseHash(hrefFor(route))).toEqual(route);
    }
  });
});

describe('sameRoute', () => {
  it('vergelijkt routes', () => {
    expect(sameRoute({ name: 'home' }, { name: 'home' })).toBe(true);
    expect(sameRoute({ name: 'task', id: 'merge' }, { name: 'task', id: 'merge' })).toBe(true);
    expect(sameRoute({ name: 'task', id: 'merge' }, { name: 'task', id: 'split' })).toBe(false);
    expect(sameRoute({ name: 'home' }, { name: 'task', id: 'merge' })).toBe(false);
  });
});

describe('Geavanceerd', () => {
  it('heeft een overzicht en een adres per onderdeel', () => {
    expect(parseHash('#/advanced')).toEqual({ name: 'advanced' });
    expect(parseHash('#/advanced/')).toEqual({ name: 'advanced' });
    for (const id of ADVANCED_IDS) {
      const route = { name: 'advancedTool', id } as const;
      expect(parseHash(`#/advanced/${id}`)).toEqual(route);
      expect(parseHash(hrefFor(route))).toEqual(route);
    }
    expect(hrefFor({ name: 'advanced' })).toBe('#/advanced');
    expect(hrefFor({ name: 'advancedTool', id: 'rename' })).toBe('#/advanced/rename');
  });

  it('geeft "niet gevonden" bij een onbekend onderdeel', () => {
    expect(parseHash('#/advanced/bestaat-niet')).toEqual({ name: 'notFound' });
    expect(parseHash('#/advanced/rename/extra')).toEqual({ name: 'notFound' });
  });

  it('vergelijkt ook de onderdelen', () => {
    const rename = { name: 'advancedTool', id: 'rename' } as const;
    expect(sameRoute(rename, rename)).toBe(true);
    expect(sameRoute({ name: 'advanced' }, { name: 'advanced' })).toBe(true);
    expect(sameRoute({ name: 'advanced' }, rename)).toBe(false);
  });
});
