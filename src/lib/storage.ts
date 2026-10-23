/** Het deel van `Storage` dat we gebruiken; maakt testen met een nep-opslag mogelijk. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** De opslag van de browser, of `null` als die geblokkeerd is (privémodus, strenge instellingen). */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Leest een waarde. Geeft `null` als er niets staat of als opslag niet mag. */
export function readItem(
  key: string,
  storage: StorageLike | null = browserStorage(),
): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Bewaart een waarde. Niet kunnen bewaren is geen reden om de pagina te laten falen. */
export function writeItem(
  key: string,
  value: string,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Bewust genegeerd.
  }
}
