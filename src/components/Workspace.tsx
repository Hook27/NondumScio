import { useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatFileSize } from '../lib/format';
import { PageEditor } from './PageEditor';
import { Thumbnail } from './Thumbnail';

/**
 * Het werkgebied van een taak: een PDF openen, en daarna de pagina's ervan. Met
 * `editable` kun je de pagina's ook kiezen, draaien en verwijderen.
 */
export function Workspace({ editable = false }: { editable?: boolean }) {
  const { doc } = useDocument();

  if (doc.status === 'ready') return <OpenDocument editable={editable} />;
  return <OpenPdf />;
}

function OpenPdf() {
  const { doc, open } = useDocument();
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);

  const openFirst = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) void open(file);
  };

  const error =
    doc.status === 'error'
      ? format(
          {
            'not-pdf': t.document.errors.notPdf,
            password: t.document.errors.password,
            damaged: t.document.errors.damaged,
          }[doc.code],
          { name: doc.name },
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
      {doc.status === 'loading' && (
        <p class="dropzone__status" role="status">
          {format(t.document.loading, { name: doc.name })}
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

function OpenDocument({ editable }: { editable: boolean }) {
  const { doc, close, pages } = useDocument();
  const { t, language } = useI18n();
  if (doc.status !== 'ready') return null;

  return (
    <section class="document" aria-labelledby="document-title">
      <div class="document__bar">
        <div>
          <h2 id="document-title" class="document__name">
            {doc.name}
          </h2>
          <p class="document__meta">
            {plural(pages.length, t.document.pagesOne, t.document.pagesOther)} ·{' '}
            {formatFileSize(doc.size, language)}
          </p>
        </div>
        <button type="button" class="button button--secondary" onClick={close}>
          {t.document.close}
        </button>
      </div>
      {editable ? (
        <PageEditor docId={doc.id} name={doc.name} file={doc.file} pdf={doc.pdf} />
      ) : (
        <ol class="thumbs" aria-label={format(t.document.thumbnails, { name: doc.name })}>
          {pages.map((page, index) => (
            <li key={`${doc.id}-${page.key}`}>
              <Thumbnail
                pdf={doc.pdf}
                pageNumber={page.source + 1}
                rotation={page.rotation}
                caption={index + 1}
                label={format(t.document.page, { n: index + 1 })}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
