import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoxAnnotation } from '../annotations/model';
import { initialPages } from '../pages/plan';
import { buildParts, buildPdf } from './save';

/**
 * De redactie nagebootst: ze onthoudt welk signaal ze kreeg. Zo zie je of Stoppen (of de taak
 * verlaten) ook de redactie zelf stopt, en niet pas na afloop telt.
 */
const seen = vi.hoisted(() => ({ signals: [] as Array<AbortSignal | undefined> }));
vi.mock('./redact', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./redact')>()),
  redactPdf: vi.fn(
    async (
      bytes: Uint8Array,
      _pages: unknown,
      _a: unknown,
      _o: unknown,
      _p: unknown,
      deps: {
        signal?: AbortSignal;
      },
    ) => {
      seen.signals.push(deps.signal);
      return { bytes, report: { pages: 0, words: 0 } };
    },
  ),
}));

async function twoPages() {
  const doc = await PDFDocument.create();
  doc.addPage([300, 300]);
  doc.addPage([300, 300]);
  return new Map([[1, await doc.save()]]);
}

const box = (page: number): BoxAnnotation => ({
  id: page + 1,
  page,
  kind: 'redact',
  x: 10,
  y: 10,
  width: 50,
  height: 20,
  color: '#000000',
  strokeWidth: 0,
});

beforeEach(() => {
  seen.signals = [];
});

describe('het afbreeksignaal gaat mee naar de redactie', () => {
  it('buildPdf', async () => {
    const stop = new AbortController();
    const pages = initialPages(2, 1);
    await buildPdf(await twoPages(), pages, {
      annotations: [box(pages[0]!.key)],
      signal: stop.signal,
    });
    expect(seen.signals).toEqual([stop.signal]);
  });

  it('buildParts, bij elk deel', async () => {
    const stop = new AbortController();
    const pages = initialPages(2, 1);
    await buildParts(
      await twoPages(),
      [pages.slice(0, 1), pages.slice(1)],
      undefined,
      [box(pages[0]!.key), box(pages[1]!.key)],
      undefined,
      undefined,
      undefined,
      stop.signal,
    );
    expect(seen.signals).toEqual([stop.signal, stop.signal]);
  });
});
