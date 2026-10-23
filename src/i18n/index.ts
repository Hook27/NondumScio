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

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    // Opslag kan geblokkeerd zijn (privémodus, strenge instellingen).
    return null;
  }
}

export function readStoredLanguage(storage: StorageLike | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeLanguage(
  language: Language,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, language);
  } catch {
    // Niet kunnen bewaren is geen reden om de pagina te laten falen.
  }
}
