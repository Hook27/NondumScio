import { describe, expect, it } from 'vitest';
import {
  LANGUAGES,
  STORAGE_KEY,
  detectLanguage,
  isLanguage,
  messages,
  readStoredLanguage,
  storeLanguage,
} from './index';

/** Maakt van geneste teksten een platte lijst: `tasks.merge.title` → tekst. */
function flatten(value: unknown, prefix = ''): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return { [prefix]: value };
  return Object.entries(value).reduce<Record<string, unknown>>(
    (all, [key, child]) => ({ ...all, ...flatten(child, prefix ? `${prefix}.${key}` : key) }),
    {},
  );
}

describe('vertalingen', () => {
  const nl = flatten(messages.nl);
  const en = flatten(messages.en);

  it('hebben in elke taal precies dezelfde sleutels', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(nl).sort());
  });

  it('hebben overal een niet-lege tekst', () => {
    for (const language of LANGUAGES) {
      for (const [key, text] of Object.entries(flatten(messages[language]))) {
        expect(typeof text, `${language}: ${key}`).toBe('string');
        expect((text as string).trim(), `${language}: ${key}`).not.toBe('');
      }
    }
  });

  it('zijn niet gewoon een kopie van het Nederlands', () => {
    const same = Object.keys(nl).filter((key) => nl[key] === en[key]);
    // Alleen de naam van de app, de papierformaten, de resolutie, "ISO" (een soort datum bij
    // Slim hernoemen), "Database", en bij PDF's vergelijken de samenvatting ("A: … · B: …"), het
    // korte paginalabel ("p3"), de kop onder elkaar ("A · … → B · …") en bij het beeld "Overlay",
    // "B over A", "Zoom" en de maten ("A: … px · B: … px") zijn in beide talen gelijk.
    expect(same).toEqual([
      'appName',
      'convert.a4',
      'convert.letter',
      'redact.dpi200',
      'rename.sources.iso',
      'rename.views.database',
      'rename.db.title',
      'compare.visual.modes.overlay',
      'compare.visual.alpha',
      'compare.visual.zoom',
      'compare.visual.stat.side',
      'compare.unifiedHead',
      'compare.summary',
      'compare.page',
    ]);
  });
});

describe('isLanguage', () => {
  it('herkent alleen ondersteunde talen', () => {
    expect(isLanguage('nl')).toBe(true);
    expect(isLanguage('en')).toBe(true);
    expect(isLanguage('fr')).toBe(false);
    expect(isLanguage('NL')).toBe(false);
    expect(isLanguage(null)).toBe(false);
    expect(isLanguage(undefined)).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('geeft voorrang aan de bewaarde keuze', () => {
    expect(detectLanguage('en', ['nl-NL'])).toBe('en');
    expect(detectLanguage('nl', ['en-US'])).toBe('nl');
  });

  it('negeert een ongeldige bewaarde waarde', () => {
    expect(detectLanguage('fr', ['nl'])).toBe('nl');
    expect(detectLanguage('', ['en'])).toBe('en');
  });

  it('volgt de taal van de browser, ook met een landcode', () => {
    expect(detectLanguage(null, ['nl-NL'])).toBe('nl');
    expect(detectLanguage(null, ['nl-BE'])).toBe('nl');
    expect(detectLanguage(null, ['en-GB'])).toBe('en');
    expect(detectLanguage(null, ['NL'])).toBe('nl');
  });

  it('neemt de eerste taal in de lijst die we kennen', () => {
    expect(detectLanguage(null, ['de-DE', 'nl', 'en'])).toBe('nl');
    expect(detectLanguage(null, ['en-US', 'nl'])).toBe('en');
  });

  it('valt terug op Engels voor andere talen of een lege lijst', () => {
    expect(detectLanguage(null, ['de-DE', 'fr'])).toBe('en');
    expect(detectLanguage(undefined, [])).toBe('en');
  });
});

describe('opslag', () => {
  function fakeStorage() {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  }

  it('bewaart en leest de taal onder een eigen sleutel', () => {
    const storage = fakeStorage();
    expect(readStoredLanguage(storage)).toBeNull();
    storeLanguage('en', storage);
    expect(storage.data.get(STORAGE_KEY)).toBe('en');
    expect(readStoredLanguage(storage)).toBe('en');
    expect(STORAGE_KEY).toBe('nondumscio:lang');
  });

  it('gaat niet stuk als opslaan niet mag', () => {
    const kapot = {
      getItem: () => {
        throw new Error('geblokkeerd');
      },
      setItem: () => {
        throw new Error('geblokkeerd');
      },
    };
    expect(readStoredLanguage(kapot)).toBeNull();
    expect(() => storeLanguage('nl', kapot)).not.toThrow();
  });

  it('werkt ook zonder opslag', () => {
    expect(readStoredLanguage(null)).toBeNull();
    expect(() => storeLanguage('nl', null)).not.toThrow();
  });
});
