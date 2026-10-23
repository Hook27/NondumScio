import { readItem, writeItem, type StorageLike } from './lib/storage';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Vaste, eigen naam, zodat een voorbeeld de voorkeur van de echte site niet verstoort. */
export const THEME_STORAGE_KEY = 'nondumscio:theme';

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

/** Kiest het thema: eerst de bewaarde keuze, anders de voorkeur van het systeem, anders licht. */
export function detectTheme(stored: string | null | undefined, systemPrefersDark: boolean): Theme {
  if (isTheme(stored)) return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

export function readStoredTheme(storage?: StorageLike | null): string | null {
  return readItem(THEME_STORAGE_KEY, storage);
}

export function storeTheme(theme: Theme, storage?: StorageLike | null): void {
  writeItem(THEME_STORAGE_KEY, theme, storage);
}

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** De media-query voor de systeemvoorkeur, of `null` als de browser die niet kent. */
export function systemThemeQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
}
