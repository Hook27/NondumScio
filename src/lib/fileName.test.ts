import { describe, expect, it } from 'vitest';
import { cleanFileName, nameWithoutExtensionLength } from './fileName';

const fallback = 'document.pdf';

describe('cleanFileName', () => {
  it('laat een gewone naam met rust en vult .pdf aan', () => {
    expect(cleanFileName('Jaaroverzicht 2026', fallback)).toBe('Jaaroverzicht 2026.pdf');
    expect(cleanFileName('rapport (bewerkt).pdf', fallback)).toBe('rapport (bewerkt).pdf');
    expect(cleanFileName('Rapport.PDF', fallback)).toBe('Rapport.pdf');
  });

  it('vervangt tekens die besturingssystemen niet toestaan', () => {
    expect(cleanFileName('a/b:c', fallback)).toBe('a-b-c.pdf');
    expect(cleanFileName('vraag? "ja" <nee> | x*y\\z', fallback)).toBe(
      'vraag- -ja- -nee- - x-y-z.pdf',
    );
    expect(cleanFileName('regel\neinde\ttab', fallback)).toBe('regel-einde-tab.pdf');
  });

  it('haalt spaties en punten aan begin en eind weg', () => {
    expect(cleanFileName('   naam   ', fallback)).toBe('naam.pdf');
    expect(cleanFileName('naam...', fallback)).toBe('naam.pdf');
    expect(cleanFileName('..verborgen', fallback)).toBe('verborgen.pdf');
    expect(cleanFileName('dubbel    spatie', fallback)).toBe('dubbel spatie.pdf');
  });

  it('behoudt letters met accenten en andere schriften', () => {
    expect(cleanFileName('Overzicht café Jörg', fallback)).toBe('Overzicht café Jörg.pdf');
    expect(cleanFileName('日本語', fallback)).toBe('日本語.pdf');
  });

  it('gebruikt het voorstel als er niets bruikbaars overblijft', () => {
    expect(cleanFileName('', fallback)).toBe(fallback);
    expect(cleanFileName('   ', fallback)).toBe(fallback);
    expect(cleanFileName('.pdf', fallback)).toBe(fallback);
    expect(cleanFileName('...', fallback)).toBe(fallback);
  });

  it('past een door Windows gereserveerde naam aan', () => {
    expect(cleanFileName('CON', fallback)).toBe('CON_.pdf');
    expect(cleanFileName('nul.pdf', fallback)).toBe('nul_.pdf');
    expect(cleanFileName('com1', fallback)).toBe('com1_.pdf');
    expect(cleanFileName('console', fallback)).toBe('console.pdf');
  });

  it('kort een te lange naam in', () => {
    const result = cleanFileName('a'.repeat(500), fallback);
    expect(result.length).toBe(200);
    expect(result.endsWith('.pdf')).toBe(true);
  });
});

describe('nameWithoutExtensionLength', () => {
  it('telt de naam zonder .pdf', () => {
    expect(nameWithoutExtensionLength('rapport.pdf')).toBe(7);
    expect(nameWithoutExtensionLength('Rapport.PDF')).toBe(7);
    expect(nameWithoutExtensionLength('zonder')).toBe(6);
  });
});
