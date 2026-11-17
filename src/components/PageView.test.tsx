// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '../compare/visual';
import { CanvasBox, fitCssWidth, useEdgeWheel, usePageCanvas, usePageSpace } from './PageView';

vi.mock('../compare/visual', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../compare/visual')>()),
  renderPage: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(renderPage).mockReset();
});
afterEach(() => cleanup());

/** Een scrollvak met een maat, zoals de browser hem zou meten (jsdom meet niets). */
function scrollRoot({ height = 700, top = 0, scrollTop = 0, scrollHeight = 700, padding = 16 }) {
  const root = document.createElement('div');
  root.setAttribute('data-scroll-root', '');
  root.style.paddingBottom = `${padding}px`;
  Object.defineProperties(root, {
    clientHeight: { configurable: true, value: height },
    scrollHeight: { configurable: true, value: scrollHeight },
    scrollTop: { configurable: true, writable: true, value: scrollTop },
  });
  root.getBoundingClientRect = () => ({ top }) as DOMRect;
  document.body.append(root);
  return root;
}

describe('fitCssWidth: hoe breed een pagina "passend" is', () => {
  it('hele breedte: de breedte van het vak; hele pagina: past ook in de hoogte', () => {
    expect(fitCssWidth({ w: 800, h: 600 }, 'width', 595 / 842)).toBe(800);
    expect(fitCssWidth({ w: 800, h: 600 }, 'page', 595 / 842)).toBeCloseTo(600 * (595 / 842));
    // Een liggende pagina in een hoog vak: de breedte beslist.
    expect(fitCssWidth({ w: 500, h: 900 }, 'page', 842 / 595)).toBe(500);
  });

  it('zonder meting (zoals in een test): een redelijke schatting', () => {
    expect(fitCssWidth({ w: 0, h: 0 }, 'width', 1)).toBe(600);
    expect(fitCssWidth({ w: 0, h: 0 }, 'page', 1)).toBe(600);
    expect(fitCssWidth({ w: 0, h: 0 }, 'page', 0.5)).toBe(400);
  });
});

describe('usePageSpace: de ruimte voor de pagina', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('breedte van het element; hoogte tot de onderkant van het scrollvak, zonder opvulling', () => {
    // jsdom meet niets: een nep-ResizeObserver laat de test zelf opnieuw meten.
    const measures: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          measures.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    const root = scrollRoot({ height: 700, top: 100, scrollTop: 30, padding: 16 });
    let space = { w: -1, h: -1 };
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      space = usePageSpace(ref);
      return <div ref={ref} class="probe" />;
    }
    const holder = document.createElement('div');
    root.append(holder);
    render(<Probe />, { container: holder });
    // Meteen bij het tonen gemeten: jsdom geeft breedte 0 en top 0, dus 700 − (0 − 100 + 30) − 16 − 4.
    expect(space).toEqual({ w: 0, h: 750 });
    const probe = holder.querySelector<HTMLElement>('.probe')!;
    Object.defineProperty(probe, 'clientWidth', { configurable: true, value: 640 });
    probe.getBoundingClientRect = () => ({ top: 250 }) as DOMRect;
    act(() => measures[0]!());
    // top in het vak = 250 − 100 + 30 = 180; hoogte = 700 − 180 − 16 − 4 = 500.
    expect(space).toEqual({ w: 640, h: 500 });
    root.remove();
  });
});

describe('usePageCanvas: een pagina tekenen', () => {
  const canvas = () => document.createElement('canvas');
  function setup(props: { file: File; page: number; width: number; enabled?: boolean }) {
    const onDrawn = vi.fn();
    let drawn: ReturnType<typeof usePageCanvas> = null;
    function Probe(p: typeof props) {
      drawn = usePageCanvas({ ...p, onDrawn });
      return null;
    }
    const view = render(<Probe {...props} />);
    return {
      onDrawn,
      drawn: () => drawn,
      rerender: (next: typeof props) => view.rerender(<Probe {...next} />),
    };
  }
  const file = new File(['%PDF'], 'a.pdf');

  it('tekent de pagina en meldt het', async () => {
    const result = canvas();
    vi.mocked(renderPage).mockResolvedValue(result);
    const view = setup({ file, page: 2, width: 800 });
    await waitFor(() => expect(view.drawn()).toEqual({ canvas: result }));
    expect(vi.mocked(renderPage).mock.calls[0]!.slice(0, 3)).toEqual([file, 2, 800]);
    expect(view.onDrawn).toHaveBeenCalledTimes(1);
  });

  it('een pagina die niet bestaat of niet te tekenen is: een fout', async () => {
    vi.mocked(renderPage).mockResolvedValueOnce(null);
    const missing = setup({ file, page: 9, width: 800 });
    await waitFor(() => expect(missing.drawn()).toEqual({ error: true }));
    cleanup();
    vi.mocked(renderPage).mockRejectedValueOnce(new Error('kapot'));
    const broken = setup({ file, page: 1, width: 800 });
    await waitFor(() => expect(broken.drawn()).toEqual({ error: true }));
  });

  it('een oude tekening die pas na de nieuwe klaar is, vervangt de nieuwe niet', async () => {
    let finishOld: (canvas: HTMLCanvasElement) => void = () => {};
    const old = canvas();
    const fresh = canvas();
    vi.mocked(renderPage)
      .mockImplementationOnce(() => new Promise((resolve) => (finishOld = resolve)))
      .mockResolvedValueOnce(fresh);
    const view = setup({ file, page: 1, width: 800 });
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    view.rerender({ file, page: 2, width: 800 });
    await waitFor(() => expect(view.drawn()).toEqual({ canvas: fresh }));
    // Pagina 1 is (ondanks het afbreken) toch nog klaar gekomen.
    finishOld(old);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.drawn()).toEqual({ canvas: fresh });
    expect(view.onDrawn).toHaveBeenCalledTimes(1);
  });

  it('een andere pagina breekt het vorige tekenen af; uitgeschakeld = niet tekenen', async () => {
    // Tekenen dat blijft lopen tot het wordt afgebroken, zoals pdf.js.
    vi.mocked(renderPage).mockImplementation(
      (_file, _page, _width, signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener('abort', () => reject(new Error('afgebroken'))),
        ),
    );
    const view = setup({ file, page: 1, width: 800 });
    await waitFor(() => expect(renderPage).toHaveBeenCalledTimes(1));
    const first = vi.mocked(renderPage).mock.calls[0]![3]!;
    view.rerender({ file, page: 2, width: 800 });
    await waitFor(() => expect(first.aborted).toBe(true));
    view.rerender({ file, page: 3, width: 800, enabled: false });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(renderPage).toHaveBeenCalledTimes(2);
  });
});

describe('useEdgeWheel: het scrollwiel bladert aan de rand', () => {
  function setup(root: HTMLElement) {
    const forward = vi.fn();
    const back = vi.fn();
    const turn = vi.fn((direction: 1 | -1) => (direction > 0 ? forward : back));
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      useEdgeWheel(ref, turn);
      return <div ref={ref} />;
    }
    const holder = document.createElement('div');
    root.append(holder);
    render(<Probe />, { container: holder });
    return { forward, back, turn };
  }

  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('[data-scroll-root]').forEach((root) => root.remove());
  });

  it('onderaan omlaag = volgende, bovenaan omhoog = vorige; daartussen scrolt het gewoon', () => {
    vi.useFakeTimers();
    const root = scrollRoot({ height: 500, scrollHeight: 900, scrollTop: 400 });
    const { forward, back } = setup(root);
    expect(fireEvent.wheel(root, { deltaY: 50 })).toBe(false);
    expect(forward).toHaveBeenCalledTimes(1);
    // Vlak daarna nog eens: wel tegengehouden, niet nog een pagina (een draai is één pagina).
    expect(fireEvent.wheel(root, { deltaY: 50 })).toBe(false);
    expect(forward).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    root.scrollTop = 200;
    expect(fireEvent.wheel(root, { deltaY: 50 })).toBe(true);
    expect(fireEvent.wheel(root, { deltaY: -50 })).toBe(true);
    root.scrollTop = 0;
    expect(fireEvent.wheel(root, { deltaY: -50 })).toBe(false);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('met Ctrl (zoomen in de browser) of als er geen pagina meer is: gewoon scrollen', () => {
    const root = scrollRoot({ height: 500, scrollHeight: 500, scrollTop: 0 });
    const forward = vi.fn();
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      useEdgeWheel(ref, (direction) => (direction > 0 ? null : forward));
      return <div ref={ref} />;
    }
    const holder = document.createElement('div');
    root.append(holder);
    render(<Probe />, { container: holder });
    expect(fireEvent.wheel(root, { deltaY: -50, ctrlKey: true })).toBe(true);
    // Omlaag op de laatste pagina: niets om naartoe te gaan.
    expect(fireEvent.wheel(root, { deltaY: 50 })).toBe(true);
    expect(forward).not.toHaveBeenCalled();
  });
});

describe('CanvasBox', () => {
  it('zet het canvas op zijn plek, met maat, klasse en een naam', () => {
    const canvas = document.createElement('canvas');
    const view = render(
      <CanvasBox
        canvas={canvas}
        className="plaintext-preview__canvas"
        width={300}
        height={424}
        label="Pagina 1"
      />,
    );
    expect(view.container.querySelector('canvas')).toBe(canvas);
    expect(canvas.className).toBe('plaintext-preview__canvas');
    expect(canvas.style.width).toBe('300px');
    expect(canvas.style.height).toBe('424px');
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toBe('Pagina 1');
  });

  it('zonder hoogte: de hoogte volgt uit het plaatje', () => {
    const canvas = document.createElement('canvas');
    render(<CanvasBox canvas={canvas} className="compare-visual__canvas" width={300} label="A" />);
    expect(canvas.style.height).toBe('');
  });
});
