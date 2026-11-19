// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeVisual, renderPage, shareVisual } from './visual';

/**
 * Een nep-pdf.js-pagina: het tekenen blijft hangen tot de test het loslaat (`finish`), en `cancel`
 * breekt het af zoals pdf.js doet (de belofte wordt afgewezen).
 */
const fake = vi.hoisted(() => ({
  renders: [] as Array<{
    canvas: HTMLCanvasElement;
    cancel: ReturnType<typeof vi.fn>;
    finish: () => void;
  }>,
  closed: 0,
  opened: 0,
}));

vi.mock('../pdf/loader', () => ({
  openPdfFile: async () => {
    fake.opened += 1;
    return fakeLoaded();
  },
  closePdf: () => {
    fake.closed += 1;
  },
}));

/** Een geopende nep-PDF (zoals `openPdfFile` hem geeft). */
const fakeLoaded = vi.hoisted(() => () => ({
  pageCount: 2,
  pdf: {
    numPages: 2,
    getPage: async () => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 595 * scale,
        height: 842 * scale,
      }),
      render: ({ canvas }: { canvas: HTMLCanvasElement }) => {
        let finish = () => {};
        let fail: (error: Error) => void = () => {};
        const promise = new Promise<void>((resolve, reject) => {
          finish = resolve;
          fail = reject;
        });
        const cancel = vi.fn(() => fail(new Error('Rendering cancelled')));
        fake.renders.push({ canvas, cancel, finish });
        return { promise, cancel };
      },
      cleanup: () => {},
    }),
  },
}));

const file = (name: string) => new File(['%PDF-1.7'], name, { type: 'application/pdf' });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fake.renders = [];
  fake.closed = 0;
  fake.opened = 0;
});

describe('renderPage: tekenen afbreken', () => {
  it('zonder afbreken: gewoon een getekende pagina', async () => {
    const pdf = file('a.pdf');
    const result = renderPage(pdf, 1, 400);
    await vi.waitFor(() => expect(fake.renders).toHaveLength(1));
    fake.renders[0]!.finish();
    const canvas = await result;
    expect(canvas?.width).toBe(400);
    expect(fake.renders[0]!.cancel).not.toHaveBeenCalled();
    closeVisual(pdf);
  });

  it('afgebroken tijdens het tekenen: pdf.js stopt en het canvas wordt vrijgegeven', async () => {
    const pdf = file('b.pdf');
    const stop = new AbortController();
    const result = renderPage(pdf, 1, 400, stop.signal);
    await vi.waitFor(() => expect(fake.renders).toHaveLength(1));
    const { canvas, cancel } = fake.renders[0]!;
    expect(canvas.width).toBe(400);
    stop.abort();
    await expect(result).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
    // Het halve plaatje houdt geen geheugen vast.
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    closeVisual(pdf);
  });

  it('al afgebroken voordat het tekenen begint: er wordt niets getekend', async () => {
    const pdf = file('c.pdf');
    const stop = new AbortController();
    stop.abort();
    await expect(renderPage(pdf, 1, 400, stop.signal)).rejects.toThrow();
    await tick();
    expect(fake.renders).toHaveLength(0);
    closeVisual(pdf);
  });

  it('afbreken na afloop doet niets meer', async () => {
    const pdf = file('d.pdf');
    const stop = new AbortController();
    const result = renderPage(pdf, 1, 400, stop.signal);
    await vi.waitFor(() => expect(fake.renders).toHaveLength(1));
    fake.renders[0]!.finish();
    const canvas = await result;
    stop.abort();
    expect(fake.renders[0]!.cancel).not.toHaveBeenCalled();
    expect(canvas?.width).toBe(400);
    closeVisual(pdf);
  });
});

describe('shareVisual: een al geopende PDF overnemen (audit E3)', () => {
  it('tekenen gebruikt de gedeelde PDF zonder het bestand opnieuw te openen; sluiten sluit hem', async () => {
    const pdf = file('gedeeld.pdf');
    shareVisual(pdf, fakeLoaded().pdf as never);
    const result = renderPage(pdf, 1, 400);
    await vi.waitFor(() => expect(fake.renders).toHaveLength(1));
    fake.renders[0]!.finish();
    expect((await result)?.width).toBe(400);
    expect(fake.opened).toBe(0);
    closeVisual(pdf);
    await tick();
    expect(fake.closed).toBe(1);
  });

  it('staat dat bestand al open, dan blijft dat en gaat de nieuwe dicht', async () => {
    const pdf = file('dubbel.pdf');
    const first = renderPage(pdf, 1, 400);
    await vi.waitFor(() => expect(fake.renders).toHaveLength(1));
    fake.renders[0]!.finish();
    await first;
    shareVisual(pdf, fakeLoaded().pdf as never);
    expect(fake.closed).toBe(1);
    expect(fake.opened).toBe(1);
    closeVisual(pdf);
  });
});
