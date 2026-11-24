import type { KeyedStorage } from './storage';

/**
 * Alleen voor tests: een nep-opslag zoals `localStorage`, die vol is boven `limit` tekens
 * (sleutels en waarden samen). Bewaren boven de grens geeft dezelfde fout als de browser.
 */
export function limitedStorage(
  limit = Infinity,
  initial: Record<string, string> = {},
): KeyedStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      let size = key.length + value.length;
      for (const [k, v] of data) if (k !== key) size += k.length + v.length;
      if (size > limit) throw new DOMException('De opslag is vol', 'QuotaExceededError');
      data.set(key, value);
    },
    removeItem: (key: string) => void data.delete(key),
  };
}
