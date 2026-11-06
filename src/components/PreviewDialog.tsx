import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { closePdf, loadPdf } from '../pdf/loader';

/** Hoe breed een pagina hooguit getekend wordt (in beeldpunten op het scherm). */
const MAX_WIDTH = 900;

/** Een pagina om te bekijken uit een PDF die al open is (bijvoorbeeld een pagina van een deel). */
export type PreviewPage = {
  pdf: PDFDocumentProxy;
  /** Paginanummer in die PDF, vanaf 1. */
  pageNumber: number;
  /** Extra draaiing bovenop die van de pagina zelf (uit het pagina-plan). */
  rotation?: number;
  /** Wat er bij deze pagina staat; anders "Pagina n van totaal". */
  label?: string;
};

/**
 * Een PDF bekijken in een venster boven de pagina: pagina voor pagina, met ‹ › of de pijltjes.
 * Escape, de sluitknop of een klik naast het venster sluit het; de focus gaat dan terug naar waar
 * hij was (de knop "Bekijken").
 *
 * Met `file` wordt de PDF alleen hier geopend en bij sluiten weer opgeruimd. Met `pages` toont het
 * venster die pagina's uit PDF's die al open zijn (die blijven open).
 */
export function PreviewDialog({
  title,
  onClose,
  ...what
}: {
  /** Wat er bovenaan staat, bijvoorbeeld de nieuwe naam. */
  title: string;
  onClose: () => void;
} & ({ file: File } | { pages: readonly PreviewPage[] })) {
  const { t } = useI18n();
  const p = t.preview;
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const file = 'file' in what ? what.file : null;
  const [opened, setOpened] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);
  const pages: readonly PreviewPage[] =
    'pages' in what
      ? what.pages
      : opened
        ? Array.from({ length: opened.numPages }, (_, i) => ({ pdf: opened, pageNumber: i + 1 }))
        : [];
  const count = pages.length;
  const current = pages[page - 1];
  const label = current ? (current.label ?? format(p.page, { n: page, total: count })) : '';

  // Openen als echt modaal venster; bij sluiten de focus terug.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement as HTMLElement | null;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    // Opruimen kan net na het afbreken lopen (Preact wacht soms een timer): dan geen globale
    // `HTMLElement` of `document` meer gebruiken.
    return () => {
      if (element.open && typeof element.close === 'function') element.close();
      if (previous?.isConnected && typeof previous.focus === 'function') previous.focus();
    };
  }, []);

  // Een bestand openen (en bij sluiten opruimen).
  useEffect(() => {
    if (!file) return;
    let loaded: PDFDocumentProxy | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const result = await loadPdf(new Uint8Array(await file.arrayBuffer()));
        loaded = result.pdf;
        if (cancelled) closePdf(result.pdf);
        else setOpened(result.pdf);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (loaded) closePdf(loaded);
    };
  }, [file]);

  // De pagina tekenen: eerst op een los canvas (pdf.js tekent zonder doorzichtigheid, dus een canvas
  // waarop nog getekend wordt, is zwart) en dan overzetten.
  const pdf = current?.pdf;
  const pageNumber = current?.pageNumber;
  const extra = current?.rotation ?? 0;
  useEffect(() => {
    const target = canvas.current;
    if (!pdf || !pageNumber || !target) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    void (async () => {
      let shown: Awaited<ReturnType<PDFDocumentProxy['getPage']>>;
      try {
        shown = await pdf.getPage(pageNumber);
      } catch {
        if (!cancelled) setFailed(true);
        return;
      }
      if (cancelled) return;
      const rotation = ((((shown.rotate ?? 0) + extra) % 360) + 360) % 360;
      const natural = shown.getViewport({ scale: 1, rotation });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const fit = Math.min(MAX_WIDTH, natural.width * 1.5) / natural.width;
      const viewport = shown.getViewport({ scale: fit * ratio, rotation });
      const next = document.createElement('canvas');
      next.width = Math.round(viewport.width);
      next.height = Math.round(viewport.height);
      task = shown.render({ canvas: next, viewport });
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
        shown.cleanup();
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, extra]);

  const go = (step: -1 | 1) => setPage((at) => Math.min(Math.max(1, at + step), count));

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
            <span aria-live="polite">{label}</span>
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
        <div class="preview-dialog__page" tabIndex={0} role="region" aria-label={label || title}>
          {failed ? (
            <p role="alert">{p.error}</p>
          ) : (
            <canvas
              ref={canvas}
              class="preview-dialog__canvas"
              role="img"
              aria-label={label || undefined}
            />
          )}
        </div>
      </div>
    </dialog>
  );
}
