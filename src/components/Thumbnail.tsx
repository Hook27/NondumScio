import { useEffect, useRef, useState } from 'preact/hooks';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { renderScale, thumbnailSize } from '../pdf/thumbnail';

/** Weergavebreedte van een miniatuur in CSS-pixels. */
export const THUMBNAIL_WIDTH = 160;

/**
 * Eén miniatuur. Wordt pas getekend als hij in beeld komt, zodat een PDF met honderden
 * pagina's niet alles tegelijk hoeft te tekenen.
 */
export function Thumbnail({
  pdf,
  pageNumber,
  label,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  label: string;
}) {
  const figure = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const element = figure.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let task: RenderTask | null = null;
    let cancelled = false;

    void (async () => {
      const page = await pdf.getPage(pageNumber);
      const target = canvas.current;
      if (cancelled || !target) return;

      const natural = page.getViewport({ scale: 1 });
      const size = thumbnailSize(natural, THUMBNAIL_WIDTH);
      const viewport = page.getViewport({
        scale: renderScale(natural.width, THUMBNAIL_WIDTH, window.devicePixelRatio),
      });
      target.width = Math.round(viewport.width);
      target.height = Math.round(viewport.height);
      target.style.width = `${size.width}px`;
      target.style.height = `${size.height}px`;

      task = page.render({ canvas: target, viewport });
      try {
        await task.promise;
        if (!cancelled) setRendered(true);
      } catch {
        // Afgebroken (bijvoorbeeld bij sluiten): niets aan de hand.
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [visible, pdf, pageNumber]);

  return (
    <figure ref={figure} class="thumb" data-rendered={rendered ? 'true' : 'false'}>
      <div class="thumb__page">
        <canvas ref={canvas} role="img" aria-label={label} />
      </div>
      <figcaption aria-hidden="true">{pageNumber}</figcaption>
    </figure>
  );
}
