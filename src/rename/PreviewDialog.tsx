import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { closePdf, loadPdf } from '../pdf/loader';

/** Hoe breed een pagina hooguit getekend wordt (in beeldpunten op het scherm). */
const MAX_WIDTH = 900;

/**
 * Een PDF bekijken in een venster boven de pagina: pagina voor pagina, met ‹ › of de pijltjes.
 * Escape, de sluitknop of een klik naast het venster sluit het; de focus gaat dan terug naar waar
 * hij was (de knop "Bekijken"). De PDF wordt alleen hier geopend en bij sluiten weer opgeruimd.
 */
export function PreviewDialog({
  file,
  title,
  onClose,
}: {
  file: File;
  /** Wat er bovenaan staat, bijvoorbeeld de nieuwe naam. */
  title: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const p = t.rename.preview;
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);
  const count = pdf?.numPages ?? 0;

  // Openen als echt modaal venster; bij sluiten de focus terug.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    return () => {
      if (element.open && typeof element.close === 'function') element.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  // De PDF openen (en bij sluiten opruimen).
  useEffect(() => {
    let opened: PDFDocumentProxy | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        opened = loaded.pdf;
        if (cancelled) closePdf(loaded.pdf);
        else setPdf(loaded.pdf);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (opened) closePdf(opened);
    };
  }, [file]);

  // De pagina tekenen: eerst op een los canvas (pdf.js tekent zonder doorzichtigheid, dus een canvas
  // waarop nog getekend wordt, is zwart) en dan overzetten.
  useEffect(() => {
    const target = canvas.current;
    if (!pdf || !target) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    void (async () => {
      const current = await pdf.getPage(page);
      if (cancelled) return;
      const natural = current.getViewport({ scale: 1 });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const fit = Math.min(MAX_WIDTH, natural.width * 1.5) / natural.width;
      const viewport = current.getViewport({ scale: fit * ratio });
      const next = document.createElement('canvas');
      next.width = Math.round(viewport.width);
      next.height = Math.round(viewport.height);
      task = current.render({ canvas: next, viewport });
      try {
        await task.promise;
        if (cancelled) return;
        target.width = next.width;
        target.height = next.height;
        target.style.width = `${Math.round(viewport.width / ratio)}px`;
        target.getContext('2d')?.drawImage(next, 0, 0);
      } catch {
        // Afgebroken (ander blad of gesloten): niets aan de hand.
      } finally {
        next.width = 0;
        next.height = 0;
        current.cleanup();
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page]);

  const go = (step: -1 | 1) => setPage((current) => Math.min(Math.max(1, current + step), count));

  return (
    <dialog
      ref={dialog}
      class="preview-dialog"
      aria-labelledby="preview-dialog-title"
      onCancel={(event) => {
        // Escape: zelf afhandelen, zodat de app weet dat het venster dicht is.
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Een klik op het venster zelf is een klik op de donkere rand eromheen.
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'PageDown') go(1);
        else if (event.key === 'ArrowLeft' || event.key === 'PageUp') go(-1);
        else return;
        event.preventDefault();
      }}
    >
      <div class="preview-dialog__inner">
        <div class="preview-dialog__bar">
          <h2 id="preview-dialog-title" class="preview-dialog__title">
            {title}
          </h2>
          <div class="preview-dialog__pages">
            <button
              type="button"
              class="button button--secondary"
              aria-label={p.previous}
              disabled={page <= 1}
              onClick={() => go(-1)}
            >
              ‹
            </button>
            <span aria-live="polite">
              {count > 0 ? format(p.page, { n: page, total: count }) : ''}
            </span>
            <button
              type="button"
              class="button button--secondary"
              aria-label={p.next}
              disabled={page >= count}
              onClick={() => go(1)}
            >
              ›
            </button>
          </div>
          <button type="button" class="button button--secondary" onClick={onClose}>
            {p.close}
          </button>
        </div>
        {/* Scrolt bij een grote pagina; met het toetsenbord bereikbaar (Tab, dan pijltjes). */}
        <div
          class="preview-dialog__page"
          tabIndex={0}
          role="region"
          aria-label={count > 0 ? format(p.page, { n: page, total: count }) : title}
        >
          {failed ? (
            <p role="alert">{p.error}</p>
          ) : (
            <canvas
              ref={canvas}
              class="preview-dialog__canvas"
              role="img"
              aria-label={count > 0 ? format(p.page, { n: page, total: count }) : undefined}
            />
          )}
        </div>
      </div>
    </dialog>
  );
}
