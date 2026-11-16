import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IN_VIEW_MARGIN, SCROLL_ROOT, resetInView, watchInView } from './inView';

/** Een nep-IntersectionObserver waarmee de test elementen in en uit beeld kan zetten. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  observed = new Set<Element>();
  disconnected = false;
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
    this.disconnected = true;
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

  it('ruimt een kijker op zodra zijn laatste element weg is (anders blijft het oude vak bewaard)', () => {
    const box = scrollBox('auto');
    const stopA = watchInView(element(box), () => {});
    const stopB = watchInView(element(box), () => {});
    const first = FakeObserver.instances[0]!;
    stopA();
    expect(first.disconnected).toBe(false);
    stopB();
    expect(first.disconnected).toBe(true);
    // Een nieuw werkvak (of hetzelfde, terug) krijgt een nieuwe kijker.
    watchInView(element(box), () => {});
    expect(FakeObserver.instances).toHaveLength(2);
    expect(FakeObserver.instances[1]!.observed.size).toBe(1);
  });

  it('twee keer stoppen telt één keer; een ander vak houdt zijn kijker', () => {
    const one = scrollBox('auto');
    const two = scrollBox('auto');
    const stopA = watchInView(element(one), () => {});
    watchInView(element(one), () => {});
    const stopC = watchInView(element(two), () => {});
    stopA();
    stopA();
    expect(FakeObserver.instances[0]!.disconnected).toBe(false);
    expect(FakeObserver.instances[0]!.observed.size).toBe(1);
    stopC();
    expect(FakeObserver.instances[1]!.disconnected).toBe(true);
    expect(FakeObserver.instances[0]!.disconnected).toBe(false);
  });

  it('na opnieuw beginnen haalt een oude stop de nieuwe kijker van hetzelfde vak niet weg', () => {
    const box = scrollBox('auto');
    const stopOld = watchInView(element(box), () => {});
    resetInView();
    watchInView(element(box), () => {});
    stopOld();
    const fresh = FakeObserver.instances[1]!;
    expect(fresh.disconnected).toBe(false);
    // Een volgend element in dat vak komt bij dezelfde, nieuwe kijker.
    watchInView(element(box), () => {});
    expect(FakeObserver.instances).toHaveLength(2);
    expect(fresh.observed.size).toBe(2);
  });

  it('geldt meteen als in beeld als de browser geen IntersectionObserver kent', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const callback = vi.fn();
    watchInView(element(), callback);
    expect(callback).toHaveBeenCalledWith(true);
  });
});
