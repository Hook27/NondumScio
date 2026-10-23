import { readItem, writeItem, type StorageLike } from '../lib/storage';
import { en } from './en';
import { nl, type Messages } from './nl';

export const LANGUAGES = ['nl', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const messages: Record<Language, Messages> = { nl, en };

/** Elke taal heet in zijn eigen taal, ongeacht de gekozen taal van de pagina. */
export const LANGUAGE_NAMES: Record<Language, string> = { nl: 'Nederlands', en: 'English' };

/** Vaste, eigen naam, zodat een voorbeeld de voorkeur van de echte site niet verstoort. */
export const STORAGE_KEY = 'nondumscio:lang';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Kiest de taal: eerst de bewaarde keuze, dan de eerste taal in de browser die we
 * kennen (nl of en), anders Engels.
 */
export function detectLanguage(
  stored: string | null | undefined,
  browserLanguages: readonly string[],
): Language {
  if (isLanguage(stored)) return stored;

  for (const tag of browserLanguages) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLanguage(primary)) return primary;
  }
  return 'en';
}

export function readStoredLanguage(storage?: StorageLike | null): string | null {
  return readItem(STORAGE_KEY, storage);
}

export function storeLanguage(language: Language, storage?: StorageLike | null): void {
  writeItem(STORAGE_KEY, language, storage);
}
