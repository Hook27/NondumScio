import { useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { cleanFileName, nameWithoutExtensionLength } from '../lib/fileName';

/**
 * Venster "Opslaan als": toont een voorgestelde bestandsnaam die je kunt aanpassen voordat
 * er iets wordt gedownload. Enter downloadt, Escape of "Annuleren" breekt af.
 */
export function SaveDialog({
  title,
  suggestion,
  onConfirm,
  onCancel,
}: {
  title: string;
  suggestion: string;
  onConfirm: (fileName: string) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(suggestion);
  const fileName = cleanFileName(value, suggestion);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    // Een echt modaal venster: de rest van de pagina is even niet bereikbaar.
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    // Alleen de naam selecteren, niet ".pdf": dan typ je meteen een nieuwe naam.
    const field = input.current;
    field?.focus();
    field?.setSelectionRange(0, nameWithoutExtensionLength(suggestion));
    return () => {
      if (element.open && typeof element.close === 'function') element.close();
    };
  }, [suggestion]);

  return (
    <dialog
      ref={dialog}
      class="save-dialog"
      aria-labelledby="save-dialog-title"
      onCancel={(event) => {
        // Escape: zelf afhandelen, zodat de app weet dat er geannuleerd is.
        event.preventDefault();
        onCancel();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(fileName);
        }}
      >
        <h2 id="save-dialog-title" class="save-dialog__title">
          {title}
        </h2>
        <label for="save-dialog-name" class="save-dialog__label">
          {t.saveDialog.label}
        </label>
        <input
          ref={input}
          id="save-dialog-name"
          class="save-dialog__input"
          type="text"
          value={value}
          spellcheck={false}
          autocomplete="off"
          onInput={(event) => setValue(event.currentTarget.value)}
        />
        <p class="save-dialog__result" aria-live="polite">
          {format(t.saveDialog.result, { name: fileName })}
        </p>
        <div class="save-dialog__actions">
          <button type="button" class="button button--secondary" onClick={onCancel}>
            {t.saveDialog.cancel}
          </button>
          <button type="submit" class="button">
            {t.saveDialog.download}
          </button>
        </div>
      </form>
    </dialog>
  );
}
