import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

/**
 * Een vak om bestanden in te slepen of te kiezen. Het eigenlijke kiezen gaat via een
 * verborgen bestandsveld (met `inputId`), zodat het ook met toetsenbord en op een telefoon werkt.
 */
export function Dropzone({
  title,
  dropTitle,
  hint,
  inputId,
  accept,
  chooseLabel,
  onFiles,
  children,
}: {
  title: string;
  /** De titel terwijl er iets boven het vak wordt gesleept. */
  dropTitle: string;
  hint: string;
  inputId: string;
  accept: string;
  chooseLabel: string;
  onFiles: (files: File[]) => void;
  children?: ComponentChildren;
}) {
  const [dragging, setDragging] = useState(false);

  const pick = (files: FileList | null | undefined) => {
    const list = [...(files ?? [])];
    if (list.length > 0) onFiles(list);
  };

  return (
    <section
      class={`dropzone${dragging ? ' dropzone--active' : ''}`}
      aria-labelledby={`${inputId}-title`}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        pick(event.dataTransfer?.files);
      }}
    >
      <h2 id={`${inputId}-title`} class="dropzone__title">
        {dragging ? dropTitle : title}
      </h2>
      <p class="dropzone__hint">{hint}</p>
      <input
        id={inputId}
        class="visually-hidden"
        type="file"
        accept={accept}
        multiple
        onChange={(event) => {
          pick(event.currentTarget.files);
          // Zelfde bestand nog eens kiezen moet opnieuw werken.
          event.currentTarget.value = '';
        }}
      />
      <label for={inputId} class="button">
        {chooseLabel}
      </label>
      {children}
    </section>
  );
}
