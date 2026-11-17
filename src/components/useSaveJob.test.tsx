// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { held } from '../lib/testFiles';
import { useSaveJob, type SaveJob } from './useSaveJob';

/** Een scherm met een opslaghaak; de test krijgt de haak in handen. */
function setup() {
  let job: SaveJob | null = null;
  function Screen() {
    job = useSaveJob();
    return <p>opslaan</p>;
  }
  render(<Screen />);
  return () => job!;
}

afterEach(() => cleanup());

describe('useSaveJob', () => {
  it('geeft het resultaat als het werk klaar is', async () => {
    const job = setup();
    expect(await job().run(async () => 42)).toEqual({ ok: true, value: 42 });
  });

  it('een fout komt terug als fout, niet als gestopt', async () => {
    const job = setup();
    const error = new Error('kapot');
    expect(
      await job().run(async () => {
        throw error;
      }),
    ).toEqual({ ok: false, stopped: false, error });
  });

  it('weggaan tijdens het werk: afgebroken, en het resultaat telt niet', async () => {
    const job = setup();
    const work = held('bestand');
    let signal: AbortSignal | null = null;
    const outcome = job().run((s) => {
      signal = s;
      return work.promise;
    });
    cleanup();
    // Preact ruimt een weggehaald scherm een tikje later op.
    await waitFor(() => expect(signal!.aborted).toBe(true));
    work.release();
    expect(await outcome).toEqual({ ok: false, stopped: true });
  });

  it('Stoppen breekt af; een fout door het afbreken telt als gestopt', async () => {
    const job = setup();
    const outcome = job().run(
      (signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('afgebroken'))),
        ),
    );
    job().stop();
    expect(await outcome).toEqual({ ok: false, stopped: true });
  });

  it('een afgebroken vorige opslag die later afloopt, laat Stoppen voor de nieuwe werken', async () => {
    const job = setup();
    const first = held('eerste');
    const firstOutcome = job().run(() => first.promise);
    let second: AbortSignal | null = null;
    const secondOutcome = job().run(
      (signal) =>
        new Promise((_resolve, reject) => {
          second = signal;
          signal.addEventListener('abort', () => reject(new Error('afgebroken')));
        }),
    );
    // De eerste (al afgebroken) loopt pas nu af; daarna moet Stoppen de tweede nog raken.
    first.release();
    expect(await firstOutcome).toEqual({ ok: false, stopped: true });
    job().stop();
    expect(second!.aborted).toBe(true);
    expect(await secondOutcome).toEqual({ ok: false, stopped: true });
  });

  it('een nieuwe opslag stopt een vorige die nog loopt', async () => {
    const job = setup();
    const first = held('eerste');
    const outcome = job().run(() => first.promise);
    const second = await job().run(async () => 'tweede');
    first.release();
    expect(await outcome).toEqual({ ok: false, stopped: true });
    expect(second).toEqual({ ok: true, value: 'tweede' });
  });
});
