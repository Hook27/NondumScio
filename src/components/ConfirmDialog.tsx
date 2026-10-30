import { useEffect, useRef } from 'preact/hooks';

/**
 * Een venster dat om bevestiging vraagt voordat iets gebeurt dat niet ongedaan te maken is, in
 * dezelfde stijl als "Opslaan als". De focus begint op de veilige keuze (`cancel`); Escape breekt
 * ook af. Na het afbreken gaat de focus terug naar waar hij was (bijvoorbeeld de knop).
 */
export function ConfirmDialog({
  title,
  text,
  cancel,
  confirm,
  onConfirm,
  onCancel,
}: {
  title: string;
  text: string;
  cancel: string;
  confirm: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const safe = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement;
    // Een echt modaal venster: de rest van de pagina is even niet bereikbaar.
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    safe.current?.focus();
    return () => {
      if (element.open && typeof element.close === 'function') element.close();
      // Terug naar waar de focus was, als dat er nog is (na bevestigen is het vaak weg).
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      class="save-dialog"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-text"
      onCancel={(event) => {
        // Escape: zelf afhandelen, zodat de app weet dat er geannuleerd is.
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="confirm-dialog-title" class="save-dialog__title">
        {title}
      </h2>
      <p id="confirm-dialog-text" class="confirm-dialog__text">
        {text}
      </p>
      <div class="save-dialog__actions">
        <button ref={safe} type="button" class="button button--secondary" onClick={onCancel}>
          {cancel}
        </button>
        <button type="button" class="button" onClick={onConfirm}>
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
