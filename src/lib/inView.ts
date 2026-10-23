/**
 * Meldt één keer dat een element (bijna) in beeld komt. Alle elementen delen één
 * IntersectionObserver: bij een PDF van 300 pagina's is dat één kijker in plaats van 300.
 */
type Callback = () => void;

/** Hoe ver vóór het in beeld komen we al beginnen (alvast tekenen tijdens het scrollen). */
export const IN_VIEW_MARGIN = '300px';

let observer: IntersectionObserver | null = null;
const callbacks = new Map<Element, Callback>();

function sharedObserver(): IntersectionObserver {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = callbacks.get(entry.target);
        stop(entry.target);
        callback?.();
      }
    },
    { rootMargin: IN_VIEW_MARGIN },
  );
  return observer;
}

function stop(element: Element) {
  callbacks.delete(element);
  observer?.unobserve(element);
}

/**
 * Roept `callback` één keer aan zodra `element` in beeld komt, en geeft een functie
 * terug om eerder te stoppen. Zonder IntersectionObserver (oude browser, testomgeving)
 * gebeurt dat meteen.
 */
export function onceInView(element: Element, callback: Callback): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback();
    return () => {};
  }
  callbacks.set(element, callback);
  sharedObserver().observe(element);
  return () => stop(element);
}

/** Alleen voor tests: begin opnieuw. */
export function resetInView(): void {
  observer?.disconnect();
  observer = null;
  callbacks.clear();
}
