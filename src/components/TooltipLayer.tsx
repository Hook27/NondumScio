import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Zo lang moet de muis stilstaan voordat de hover-tekst verschijnt (in milliseconden). */
export const TIP_DELAY = 400;

type Tip = { text: string; anchor: DOMRect };

/**
 * Eén hover-tekst voor de hele pagina, voor elk element met `data-tip`. Hij staat vast op het
 * scherm (position: fixed), zodat een vak dat zelf scrolt hem niet afknipt, en blijft binnen het
 * venster. Muis: na even stilstaan. Toetsenbord: meteen bij focus. Escape, klikken, scrollen of
 * weggaan verbergt hem. Bij aanraken verschijnt hij niet (geen hover op een telefoon).
 * Alleen voor het oog: de knop zelf heeft dezelfde naam voor schermlezers.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    let current: Element | null = null;

    const show = (element: Element, delay: number) => {
      window.clearTimeout(timer);
      current = element;
      timer = window.setTimeout(() => {
        const text = element.getAttribute('data-tip');
        if (text && element.isConnected) setTip({ text, anchor: element.getBoundingClientRect() });
      }, delay);
    };
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const anchorOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest('[data-tip]') : null;

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const anchor = anchorOf(event.target);
      if (anchor === current) return;
      if (anchor) show(anchor, TIP_DELAY);
      else hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const anchor = anchorOf(event.target);
      const keyboard = event.target instanceof Element && event.target.matches(':focus-visible');
      if (anchor && keyboard) show(anchor, 0);
      else hide();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', onKey);
    // Scrollen (ook in een vak) verschuift de knop: de tekst zou dan los komen te staan.
    document.addEventListener('scroll', hide, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', hide, true);
    };
  }, []);

  // Onder het element, gecentreerd; past het daar niet, dan erboven. Altijd binnen het venster.
  useLayoutEffect(() => {
    const element = box.current;
    if (!tip || !element) {
      setPosition(null);
      return;
    }
    const margin = 8;
    const { width, height } = element.getBoundingClientRect();
    const centre = tip.anchor.left + tip.anchor.width / 2;
    const left = Math.min(Math.max(margin, centre - width / 2), window.innerWidth - width - margin);
    const below = tip.anchor.bottom + 6;
    const top = below + height > window.innerHeight - margin ? tip.anchor.top - height - 6 : below;
    setPosition({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={box}
      class="tooltip"
      aria-hidden="true"
      style={
        position
          ? { left: `${position.left}px`, top: `${position.top}px` }
          : { left: '0px', top: '0px', visibility: 'hidden' }
      }
    >
      {tip.text}
    </div>
  );
}
