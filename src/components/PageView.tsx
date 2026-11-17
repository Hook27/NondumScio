import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { renderPage } from '../compare/visual';

/**
 * De bouwstenen van één paginaweergave, gedeeld door PDF → Platte tekst, Triage en het beeld van
 * Vergelijken (T1 uit de audit): de ruimte meten, de passende breedte, een pagina tekenen (met
 * afbreken), bladeren met het scrollwiel aan de rand, en het canvas op zijn plek zetten. Eerst stond
 * dit drie keer bijna gelijk in de code.
 */

/** Passend in de breedte van het vak, of de hele pagina (ook in de hoogte). */
export type Fit = 'page' | 'width';

/** De ruimte voor de pagina in beeldpunten; 0 = (nog) niet gemeten. */
export type Space = { w: number; h: number };

/**
 * De ruimte voor de pagina: de breedte van het element, en de hoogte van daar tot de onderkant van
 * het scrollvak (zonder de opvulling onderaan; "hele pagina" moet echt passen, anders schuift het
 * scrollwiel eerst een stukje in plaats van door te bladeren). Meet opnieuw als het element of het
 * vak van maat verandert.
 */
export function usePageSpace(ref: RefObject<HTMLElement | null>): Space {
  const [space, setSpace] = useState<Space>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const root = element.closest<HTMLElement>('[data-scroll-root]');
    const measure = () => {
      const top = root
        ? element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
        : 0;
      const padding = root ? parseFloat(getComputedStyle(root).paddingBottom) || 0 : 0;
      setSpace({ w: element.clientWidth, h: (root?.clientHeight ?? 0) - top - padding - 4 });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (root) observer.observe(root);
    return () => observer.disconnect();
  }, []);
  return space;
}

/**
 * Hoe breed (in beeldpunten) een pagina met verhouding breedte/hoogte `ratio` "passend" is. Zonder
 * meting (zoals in een test) een redelijke schatting: 600 breed, 800 hoog.
 */
export function fitCssWidth(space: Space, fit: Fit, ratio: number): number {
  const availW = space.w > 0 ? space.w : 600;
  const availH = space.h > 0 ? space.h : 800;
  return fit === 'width' ? availW : Math.min(availW, availH * ratio);
}

/** Een getekende pagina, of dat tekenen niet lukte (de pagina bestaat niet of is kapot). */
export type Drawn = { canvas: HTMLCanvasElement } | { error: true };

/**
 * Tekent pagina `page` van `file`, `width` beeldpunten breed. Bij een andere pagina, breedte of PDF
 * (of als het scherm weggaat) breekt het af wat nog bezig is. `enabled: false` tekent (nog) niet;
 * `onDrawn` hoort het als er iets te zien is (ook een fout).
 */
export function usePageCanvas({
  file,
  page,
  width,
  enabled = true,
  onDrawn,
}: {
  file: File;
  page: number;
  width: number;
  enabled?: boolean;
  onDrawn?: () => void;
}): Drawn | null {
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  // De nieuwste `onDrawn`, zonder dat een nieuwe functie opnieuw laat tekenen.
  const latest = useRef(onDrawn);
  latest.current = onDrawn;
  useEffect(() => {
    if (!enabled) return;
    const stop = new AbortController();
    renderPage(file, page, width, stop.signal)
      .then((canvas): Drawn => (canvas ? { canvas } : { error: true }))
      .catch((): Drawn => ({ error: true }))
      .then((next) => {
        if (stop.signal.aborted) return;
        setDrawn(next);
        latest.current?.();
      });
    return () => stop.abort();
  }, [file, page, width, enabled]);
  return drawn;
}

/**
 * Het scrollwiel bladert aan de boven- of onderrand van het scrollvak waar `ref` in staat, zoals in
 * de extractor. `turn(1)` (omlaag) of `turn(-1)` (omhoog) geeft wat er moet gebeuren, of null als
 * er geen pagina meer is: dan scrolt het gewoon. Eén draai is één pagina (kort daarna niet nog een);
 * met Ctrl (zoomen in de browser) doet het niets.
 */
export function useEdgeWheel(
  ref: RefObject<HTMLElement | null>,
  turn: (direction: 1 | -1) => (() => void) | null,
) {
  // De nieuwste `turn`, zonder dat de luisteraar steeds opnieuw moet.
  const latest = useRef(turn);
  latest.current = turn;
  useEffect(() => {
    const root = ref.current?.closest<HTMLElement>('[data-scroll-root]');
    if (!root) return;
    let locked = false;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const atTop = root.scrollTop <= 0;
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
      const direction = event.deltaY > 0 && atBottom ? 1 : event.deltaY < 0 && atTop ? -1 : 0;
      const action = direction === 0 ? null : latest.current(direction);
      if (!action) return;
      event.preventDefault();
      if (locked) return;
      locked = true;
      setTimeout(() => (locked = false), 250);
      action();
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);
}

/**
 * Zet een getekend canvas op zijn plek, `width` beeldpunten breed en (als die er is) `height` hoog:
 * precies de maat van de pagina, zodat er niet één beeldpunt overloopt en een schuifbalk geeft (F19).
 */
export function CanvasBox({
  canvas,
  className,
  width,
  height,
  label,
}: {
  canvas: HTMLCanvasElement;
  className: string;
  width: number;
  height?: number;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    canvas.className = className;
    canvas.style.width = `${width}px`;
    if (height !== undefined) canvas.style.height = `${height}px`;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
    box.current?.replaceChildren(canvas);
  }, [canvas, className, width, height, label]);
  return <div ref={box} />;
}
