/**
 * Meldt wanneer een element (bijna) in beeld komt en wanneer het weer ver uit beeld is. Alle
 * elementen in hetzelfde scrollvak delen één IntersectionObserver: bij een PDF van 300 pagina's is
 * dat één kijker in plaats van 300.
 */
type Callback = (inView: boolean) => void;

/**
 * Hoe ver vóór het in beeld komen we al beginnen (alvast tekenen tijdens het scrollen), en hoe ver
 * erbuiten iets nog blijft staan: een schermhoogte van het scrollvak, boven en onder.
 */
export const IN_VIEW_MARGIN = '100% 0px';

/**
 * Het herkenningsteken van een vak dat zelf scrolt (op een breed scherm het rechtervak). De marge
 * van een kijker geldt alleen rond zijn eigen vak; zonder dit vak als vak van de kijker zou alles
 * buiten het zichtbare deel van het vak meteen als "uit beeld" tellen.
 */
export const SCROLL_ROOT = 'data-scroll-root';

const observers = new Map<Element | null, IntersectionObserver>();
const callbacks = new Map<Element, Callback>();

function observerFor(root: Element | null): IntersectionObserver {
  let observer = observers.get(root);
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
      },
      { root, rootMargin: IN_VIEW_MARGIN },
    );
    observers.set(root, observer);
  }
  return observer;
}

/** Het scrollvak waarin het element staat, als dat vak nu echt scrolt (anders: het venster). */
function scrollRootOf(element: Element): Element | null {
  const root = element.closest?.(`[${SCROLL_ROOT}]`) ?? null;
  if (!root || typeof getComputedStyle === 'undefined') return null;
  const { overflowY } = getComputedStyle(root);
  return overflowY === 'auto' || overflowY === 'scroll' ? root : null;
}

/**
 * Roept `callback` aan met `true` zodra `element` (bijna) in beeld komt en met `false` als het weer
 * ver uit beeld is, en geeft een functie terug om te stoppen. Zonder IntersectionObserver (oude
 * browser, testomgeving) geldt het element meteen als in beeld, voorgoed.
 */
export function watchInView(element: Element, callback: Callback): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    callback(true);
    return () => {};
  }
  const observer = observerFor(scrollRootOf(element));
  callbacks.set(element, callback);
  observer.observe(element);
  return () => {
    callbacks.delete(element);
    observer.unobserve(element);
  };
}

/** Alleen voor tests: begin opnieuw. */
export function resetInView(): void {
  for (const observer of observers.values()) observer.disconnect();
  observers.clear();
  callbacks.clear();
}
