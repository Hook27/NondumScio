import { describe, expect, it } from 'vitest';
import {
  THEME_STORAGE_KEY,
  THEMES,
  detectTheme,
  isTheme,
  readStoredTheme,
  storeTheme,
} from './theme';

describe('isTheme', () => {
  it('herkent alleen bestaande thema’s', () => {
    for (const theme of THEMES) expect(isTheme(theme)).toBe(true);
    expect(isTheme('auto')).toBe(false);
    expect(isTheme('DARK')).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
  });
});

describe('detectTheme', () => {
  it('geeft voorrang aan de bewaarde keuze, ook tegen het systeem in', () => {
    expect(detectTheme('light', true)).toBe('light');
    expect(detectTheme('dark', false)).toBe('dark');
  });

  it('volgt zonder keuze het systeem', () => {
    expect(detectTheme(null, true)).toBe('dark');
    expect(detectTheme(null, false)).toBe('light');
    expect(detectTheme(undefined, true)).toBe('dark');
  });

  it('negeert een ongeldige bewaarde waarde', () => {
    expect(detectTheme('blauw', true)).toBe('dark');
    expect(detectTheme('', false)).toBe('light');
  });
});

describe('opslag van het thema', () => {
  function fakeStorage() {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
  }

  it('bewaart en leest het thema onder een eigen sleutel', () => {
    const storage = fakeStorage();
    expect(readStoredTheme(storage)).toBeNull();
    storeTheme('dark', storage);
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(readStoredTheme(storage)).toBe('dark');
    expect(THEME_STORAGE_KEY).toBe('nondumscio:theme');
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
    expect(readStoredTheme(kapot)).toBeNull();
    expect(() => storeTheme('light', kapot)).not.toThrow();
  });
});
