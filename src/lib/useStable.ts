import { useMemo, useRef } from 'preact/hooks';

type Callbacks = Record<string, (...args: never[]) => unknown>;

/**
 * Geeft dezelfde functies terug bij elke render, die steeds de nieuwste versie aanroepen. Zo
 * hoeft een kindonderdeel dat ze als gegevens (props) krijgt niet opnieuw te tekenen alleen
 * omdat de ouder opnieuw tekende. De sleutels moeten bij elke render dezelfde zijn.
 */
export function useStable<T extends Callbacks>(callbacks: T): T {
  const latest = useRef(callbacks);
  latest.current = callbacks;
  return useMemo(
    () =>
      Object.fromEntries(
        Object.keys(callbacks).map((key) => [
          key,
          (...args: unknown[]) => (latest.current[key] as (...a: unknown[]) => unknown)(...args),
        ]),
      ) as unknown as T,
    // De sleutels liggen vast; de functies zelf lopen via `latest`.
    [],
  );
}
