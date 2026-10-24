import type { RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/** Zo ver moet de muis bewegen voordat een klik een sleepbeweging wordt (in pixels). */
const DRAG_THRESHOLD = 6;

/** Op deze elementen begint geen sleepbeweging: die houden hun eigen klik. */
const OWN_CLICK = 'button, a, input, label, select, textarea';

/** Het dichtstbijzijnde vak boven `element` dat zelf scrolt, of `null` (dan scrolt het venster). */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      parent.scrollHeight > parent.clientHeight
    ) {
      return parent;
    }
  }
  return null;
}

type Drag<T> = {
  pointerId: number;
  /** Wat er gesleept wordt (bijvoorbeeld de gekozen pagina's of een bestand). */
  item: T;
  x: number;
  y: number;
  active: boolean;
};

type Options<T> = {
  /** De lijst waarin gesleept wordt. */
  list: RefObject<HTMLElement | null>;
  /** De onderdelen van de lijst; elk heeft `data-index` met zijn plek. */
  itemSelector: string;
  /** Onder elkaar (bestanden) of naast elkaar met regelafbreking (miniaturen). */
  direction: 'vertical' | 'grid';
  /** Als het echt slepen wordt (na een paar pixels bewegen). */
  onStart?: (item: T) => void;
  /** Bij loslaten op een plek (0 = vooraan, het aantal onderdelen = achteraan). */
  onDrop: (item: T, target: number) => void;
};

/**
 * Herschikken door te slepen: met de muis het hele onderdeel, op een aanraakscherm alleen
 * het greepje (`.drag-handle`), zodat gewoon scrollen blijft werken. Een streepje (`dropAt`)
 * laat zien waar het terechtkomt; Escape of ver buiten de lijst loslaten breekt af, en bij de
 * rand van het venster schuift de pagina mee. Gedeeld door Pagina's en Samenvoegen.
 */
export function useDragReorder<T>({ list, itemSelector, direction, onStart, onDrop }: Options<T>) {
  const drag = useRef<Drag<T> | null>(null);
  // Na een sleepbeweging volgt nog een klik; die mag niets anders doen.
  const suppressClick = useRef(false);
  // De laatste plek die het streepje aanwees; daar komt het bij loslaten terecht.
  const lastDrop = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [dragged, setDragged] = useState<T | null>(null);

  /** Waar het terechtkomt als je hier loslaat (0 = vooraan), of `null`. */
  const dropIndexAt = (x: number, y: number): number | null => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>(itemSelector);
    if (!element || !list.current?.contains(element)) return null;
    const index = Number(element.dataset.index);
    const box = element.getBoundingClientRect();
    const before =
      direction === 'vertical' ? y < box.top + box.height / 2 : x < box.left + box.width / 2;
    return before ? index : index + 1;
  };

  /** Of de muis of vinger ver buiten de lijst is (dan breekt loslaten het slepen af). */
  const farOutside = (x: number, y: number) => {
    const box = list.current?.getBoundingClientRect();
    if (!box) return true;
    const margin = 48;
    return (
      x < box.left - margin ||
      x > box.right + margin ||
      y < box.top - margin ||
      y > box.bottom + margin
    );
  };

  /** Werkt de plek van het streepje bij: een nieuwe plek, de vorige, of geen (ver buiten). */
  const updateDrop = (x: number, y: number) => {
    const index = dropIndexAt(x, y);
    if (index !== null) lastDrop.current = index;
    else if (farOutside(x, y)) lastDrop.current = null;
    setDropAt(lastDrop.current);
    return lastDrop.current;
  };

  const endDrag = () => {
    drag.current = null;
    lastDrop.current = null;
    setDragged(null);
    setDropAt(null);
  };

  // Escape breekt het slepen af.
  const dragging = dragged !== null;
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      suppressClick.current = true;
      endDrag();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dragging]);

  const onPointerDown = (event: PointerEvent, item: T) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(OWN_CLICK)) return;
    // Op een aanraakscherm alleen via het greepje, zodat gewoon scrollen blijft werken.
    if (event.pointerType === 'touch' && !target?.closest('.drag-handle')) return;
    drag.current = {
      pointerId: event.pointerId,
      item,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    // Nog niet "vangen": een gewone klik (bijvoorbeeld op een vinkje) moet zijn eigen
    // doel houden. Dat gebeurt pas als het echt slepen wordt.
  };

  const onPointerMove = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.active) {
      const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y);
      if (distance < DRAG_THRESHOLD) return;
      current.active = true;
      // Vanaf nu volgen alle bewegingen deze sleepactie, ook buiten het onderdeel.
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      setDragged(current.item);
      onStart?.(current.item);
    }
    event.preventDefault();
    updateDrop(event.clientX, event.clientY);
    // Bij de rand meeschuiven, maar alleen als er in die richting nog onderdelen buiten
    // beeld staan; anders zou het doel onder de muis wegschuiven. Staat de lijst in een vak
    // dat zelf scrolt (splitscherm), dan schuift dat vak; anders het venster.
    const box = list.current?.getBoundingClientRect();
    if (!box || !list.current) return;
    const scroller = scrollParent(list.current);
    const edge = scroller
      ? scroller.getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight };
    const scrollBy = (dy: number) => (scroller ? scroller.scrollBy(0, dy) : window.scrollBy(0, dy));
    if (event.clientY < edge.top + 40 && box.top < edge.top) scrollBy(-16);
    else if (event.clientY > edge.bottom - 40 && box.bottom > edge.bottom) scrollBy(16);
  };

  const onPointerUp = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.active) {
      suppressClick.current = true;
      const target = updateDrop(event.clientX, event.clientY);
      if (target !== null) onDrop(current.item, target);
    }
    endDrag();
  };

  return {
    /** Wat er nu gesleept wordt, of `null`. */
    dragged,
    /** Waar het streepje staat (plek vóór onderdeel `dropAt`), of `null`. */
    dropAt,
    /** De handlers voor één onderdeel van de lijst. */
    handlers: (item: T) => ({
      onPointerDown: (event: PointerEvent) => onPointerDown(event, item),
      onPointerMove,
      onPointerUp,
      onPointerCancel: endDrag,
    }),
    /** Voor de klik vlak na het slepen: `true` betekent negeren. */
    consumeClick: () => {
      const suppressed = suppressClick.current;
      suppressClick.current = false;
      return suppressed;
    },
  };
}
