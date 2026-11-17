import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks';

/** Hoe een opslag afliep: met een uitkomst, gestopt (Stoppen of weggaan), of met een fout. */
export type SaveOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; stopped: true }
  | { ok: false; stopped: false; error: unknown };

export type SaveJob = {
  /**
   * Voert het werk uit met een signaal om af te breken. Pas na `run` downloaden, en alleen bij
   * `ok`: zo komt er na Stoppen of weggaan nooit nog een download.
   */
  run: <T>(work: (signal: AbortSignal) => Promise<T>) => Promise<SaveOutcome<T>>;
  /** Breekt het werk dat nu loopt af. */
  stop: () => void;
};

/**
 * Eén opslag tegelijk, die stopt als je het scherm verlaat (een andere taak kiest of het document
 * sluit). Zonder dit liep het opslaan door en kwam er minuten later toch een download, en kon je
 * terug in de taak een tweede ernaast starten. Overal hetzelfde: Pagina's, Samenvoegen, Bewerken,
 * Redigeren, Splitsen, Omzetten en samenvoegen bij Slim hernoemen.
 */
export function useSaveJob(): SaveJob {
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);

  const run = useCallback(async <T>(work: (signal: AbortSignal) => Promise<T>) => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    try {
      const value = await work(controller.signal);
      if (controller.signal.aborted) return { ok: false, stopped: true } as const;
      return { ok: true, value } as const;
    } catch (error) {
      // Een fout door het afbreken (pdf.js, de redactie) is geen fout: er is gestopt.
      if (controller.signal.aborted) return { ok: false, stopped: true } as const;
      return { ok: false, stopped: false, error } as const;
    } finally {
      if (running.current === controller) running.current = null;
    }
  }, []);
  const stop = useCallback(() => running.current?.abort(), []);
  return useMemo(() => ({ run, stop }), [run, stop]);
}
