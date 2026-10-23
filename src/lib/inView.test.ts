import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IN_VIEW_MARGIN, onceInView, resetInView } from './inView';

/** Een nep-IntersectionObserver waarmee de test elementen "in beeld" kan zetten. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  observed = new Set<Element>();
  constructor(
    readonly callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void,
    readonly options: { rootMargin?: string },
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

const element = () => ({}) as Element;

beforeEach(() => {
  FakeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
});

afterEach(() => {
  resetInView();
  vi.unstubAllGlobals();
});

describe('onceInView', () => {
  it('deelt één kijker voor alle elementen', () => {
    for (let i = 0; i < 300; i += 1) onceInView(element(), () => {});
    expect(FakeObserver.instances).toHaveLength(1);
    expect(FakeObserver.instances[0]!.observed.size).toBe(300);
    expect(FakeObserver.instances[0]!.options.rootMargin).toBe(IN_VIEW_MARGIN);
  });

  it('meldt één keer, en alleen als het element echt in beeld komt', () => {
    const el = element();
    const callback = vi.fn();
    onceInView(el, callback);
    const observer = FakeObserver.instances[0]!;

    observer.show(el, false);
    expect(callback).not.toHaveBeenCalled();
    observer.show(el);
    observer.show(el);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(observer.observed.has(el)).toBe(false);
  });

  it('meldt alleen het element dat in beeld komt', () => {
    const a = element();
    const b = element();
    const callbackA = vi.fn();
    const callbackB = vi.fn();
    onceInView(a, callbackA);
    onceInView(b, callbackB);

    FakeObserver.instances[0]!.show(b);
    expect(callbackA).not.toHaveBeenCalled();
    expect(callbackB).toHaveBeenCalledTimes(1);
  });

  it('kan vooraf stoppen, bijvoorbeeld als een miniatuur verdwijnt', () => {
    const el = element();
    const callback = vi.fn();
    const stop = onceInView(el, callback);
    stop();

    FakeObserver.instances[0]!.show(el);
    expect(callback).not.toHaveBeenCalled();
    expect(FakeObserver.instances[0]!.observed.size).toBe(0);
  });

  it('meldt meteen als de browser geen IntersectionObserver kent', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const callback = vi.fn();
    onceInView(element(), callback);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
