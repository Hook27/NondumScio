import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IN_VIEW_MARGIN, SCROLL_ROOT, resetInView, watchInView } from './inView';

/** Een nep-IntersectionObserver waarmee de test elementen in en uit beeld kan zetten. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  observed = new Set<Element>();
  constructor(
    readonly callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void,
    readonly options: { root?: Element | null; rootMargin?: string },
  ) {
    FakeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.observed.clear();
  }
  show(element: Element, isIntersecting = true) {
    this.callback([{ target: element, isIntersecting }]);
  }
}

/** Een element, eventueel in een scrollvak (`root`) dat wel of niet echt scrolt. */
const element = (root: Element | null = null) => ({ closest: () => root }) as unknown as Element;
const scrollBox = (overflowY: string) => ({ overflowY }) as unknown as Element;

beforeEach(() => {
  FakeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('getComputedStyle', (el: { overflowY: string }) => ({ overflowY: el.overflowY }));
});

afterEach(() => {
  resetInView();
  vi.unstubAllGlobals();
});

describe('watchInView', () => {
  it('deelt één kijker voor alle elementen in hetzelfde vak', () => {
    for (let i = 0; i < 300; i += 1) watchInView(element(), () => {});
    expect(FakeObserver.instances).toHaveLength(1);
    expect(FakeObserver.instances[0]!.observed.size).toBe(300);
    expect(FakeObserver.instances[0]!.options).toEqual({ root: null, rootMargin: IN_VIEW_MARGIN });
  });

  it('meldt in beeld en uit beeld, zo vaak als het gebeurt', () => {
    const el = element();
    const callback = vi.fn();
    watchInView(el, callback);
    const observer = FakeObserver.instances[0]!;

    observer.show(el);
    observer.show(el, false);
    observer.show(el);
    expect(callback.mock.calls).toEqual([[true], [false], [true]]);
    expect(observer.observed.has(el)).toBe(true);
  });

  it('meldt alleen het element dat in of uit beeld gaat', () => {
    const a = element();
    const b = element();
    const callbackA = vi.fn();
    const callbackB = vi.fn();
    watchInView(a, callbackA);
    watchInView(b, callbackB);

    FakeObserver.instances[0]!.show(b);
    expect(callbackA).not.toHaveBeenCalled();
    expect(callbackB).toHaveBeenCalledWith(true);
  });

  it('kijkt rond het vak dat scrolt, en rond het venster als het vak niet scrolt', () => {
    const scrolling = scrollBox('auto');
    watchInView(element(scrolling), () => {});
    watchInView(element(scrolling), () => {});
    // Op een telefoon scrolt het vak niet zelf, maar de hele pagina.
    watchInView(element(scrollBox('visible')), () => {});
    expect(FakeObserver.instances.map((observer) => observer.options.root)).toEqual([
      scrolling,
      null,
    ]);
    expect(FakeObserver.instances[0]!.observed.size).toBe(2);
    expect(SCROLL_ROOT).toBe('data-scroll-root');
  });

  it('kan stoppen, bijvoorbeeld als een miniatuur verdwijnt', () => {
    const el = element();
    const callback = vi.fn();
    const stop = watchInView(el, callback);
    stop();

    FakeObserver.instances[0]!.show(el);
    expect(callback).not.toHaveBeenCalled();
    expect(FakeObserver.instances[0]!.observed.size).toBe(0);
  });

  it('geldt meteen als in beeld als de browser geen IntersectionObserver kent', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const callback = vi.fn();
    watchInView(element(), callback);
    expect(callback).toHaveBeenCalledWith(true);
  });
});
