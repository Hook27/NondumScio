/** Het deel van `Storage` dat we gebruiken; maakt testen met een nep-opslag mogelijk. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Ook langs de sleutels lopen en er een weghalen (voor de onthouden instellingen). */
export type KeyedStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** De opslag van de browser, of `null` als die geblokkeerd is (privémodus, strenge instellingen). */
export function browserStorage(): KeyedStorage | null {
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

/**
 * Bewaart een waarde; geeft of dat gelukt is. Niet kunnen bewaren is geen reden om de pagina te
 * laten falen. Lukt het niet (bijvoorbeeld omdat de opslag vol is), dan maakt `makeRoom` ruimte,
 * steeds een stukje, en wordt het opnieuw geprobeerd, zolang `makeRoom` iets weghaalt (`true`).
 * Hooguit `MAX_TRIES` keer: zegt `makeRoom` steeds `true` zonder dat het past, dan toch stoppen.
 */
export function writeItem(
  key: string,
  value: string,
  storage: StorageLike | null = browserStorage(),
  makeRoom?: () => boolean,
): boolean {
  if (!storage) return false;
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    try {
      storage.setItem(key, value);
      return true;
    } catch {
      if (!makeRoom?.()) return false;
    }
  }
  return false;
}

/** Zo vaak probeert `writeItem` het hooguit (ruim meer dan er ooit onthouden instellingen zijn). */
export const MAX_TRIES = 10_000;

/**
 * Het begin van de sleutels van de onthouden instellingen van Platte tekst (zie
 * `text/settings.ts`). Staat hier, zodat ook Slim hernoemen er ruimte mee kan maken zonder de
 * code van Platte tekst te laden.
 */
export const SETTINGS_PREFIX = 'nondumscio:plaintext:';

/** Wanneer onthouden instellingen bewaard zijn (`saved`), of 0 (van vóór de tijdstempel, kapot). */
function savedAt(store: KeyedStorage, key: string): number {
  try {
    const raw: unknown = JSON.parse(store.getItem(key) ?? 'null');
    const saved = (raw as { saved?: unknown } | null)?.saved;
    return typeof saved === 'number' ? saved : 0;
  } catch {
    return 0;
  }
}

/** De sleutels van alle onthouden instellingen. */
export function settingsKeys(store: KeyedStorage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(SETTINGS_PREFIX)) keys.push(key);
  }
  return keys;
}

/**
 * Gooit de oudst bewaarde onthouden instellingen weg (die zonder tijdstempel eerst), maar niet die
 * met sleutel `keep`. Geeft of er iets weg is. Onthouden instellingen zijn een gemak: als de opslag
 * vol is, mogen ze plaatsmaken voor iets wat zwaarder weegt (zoals de database van Slim hernoemen).
 */
export function forgetOldestSettings(
  store: KeyedStorage | null = browserStorage(),
  keep?: string,
): boolean {
  if (!store) return false;
  try {
    let oldest: { key: string; saved: number } | null = null;
    for (const key of settingsKeys(store)) {
      if (key === keep) continue;
      const saved = savedAt(store, key);
      if (!oldest || saved < oldest.saved) oldest = { key, saved };
    }
    if (!oldest) return false;
    store.removeItem(oldest.key);
    return true;
  } catch {
    return false;
  }
}
