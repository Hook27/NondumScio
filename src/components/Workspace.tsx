import { useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatFileSize } from '../lib/format';
import { Thumbnail } from './Thumbnail';

/** Het werkgebied van een taak: een PDF openen, en daarna de pagina's ervan. */
export function Workspace() {
  const { document } = useDocument();

  if (document.status === 'ready') return <OpenDocument />;
  return <OpenPdf />;
}

function OpenPdf() {
  const { document, open } = useDocument();
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);

  const openFirst = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) void open(file);
  };

  const error =
    document.status === 'error'
      ? format(
          {
            'not-pdf': t.document.errors.notPdf,
            password: t.document.errors.password,
            damaged: t.document.errors.damaged,
          }[document.code],
          { name: document.name },
        )
      : null;

  return (
    <section
      class={`dropzone${dragging ? ' dropzone--active' : ''}`}
      aria-labelledby="dropzone-title"
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
        openFirst(event.dataTransfer?.files);
      }}
    >
      <h2 id="dropzone-title" class="dropzone__title">
        {dragging ? t.document.dropHere : t.document.openTitle}
      </h2>
      <p class="dropzone__hint">{t.document.openHint}</p>
      <input
        id="pdf-file"
        class="visually-hidden"
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => {
          openFirst(event.currentTarget.files);
          // Zelfde bestand nog eens kiezen moet opnieuw werken.
          event.currentTarget.value = '';
        }}
      />
      <label for="pdf-file" class="button">
        {t.document.choose}
      </label>
      {document.status === 'loading' && (
        <p class="dropzone__status" role="status">
          {format(t.document.loading, { name: document.name })}
        </p>
      )}
      {error && (
        <p class="dropzone__error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function OpenDocument() {
  const { document, close } = useDocument();
  const { t, language } = useI18n();
  if (document.status !== 'ready') return null;

  const pages = Array.from({ length: document.pageCount }, (_, i) => i + 1);

  return (
    <section class="document" aria-labelledby="document-title">
      <div class="document__bar">
        <div>
          <h2 id="document-title" class="document__name">
            {document.name}
          </h2>
          <p class="document__meta">
            {plural(document.pageCount, t.document.pagesOne, t.document.pagesOther)} ·{' '}
            {formatFileSize(document.size, language)}
          </p>
        </div>
        <button type="button" class="button button--secondary" onClick={close}>
          {t.document.close}
        </button>
      </div>
      <ol class="thumbs" aria-label={format(t.document.thumbnails, { name: document.name })}>
        {pages.map((pageNumber) => (
          <li key={`${document.name}-${pageNumber}`}>
            <Thumbnail
              pdf={document.pdf}
              pageNumber={pageNumber}
              label={format(t.document.page, { n: pageNumber })}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}
