import { useState } from 'preact/hooks';
import { useDocument, type FileError } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatFileSize } from '../lib/format';
import { MergeView } from './MergeView';
import { PageEditor } from './PageEditor';
import { Thumbnail } from './Thumbnail';

/** Wat het werkgebied laat doen: alleen bekijken, pagina's bewerken of bestanden samenvoegen. */
export type WorkspaceMode = 'view' | 'pages' | 'merge';

/** Het werkgebied van een taak: PDF's openen, en daarna de pagina's ervan. */
export function Workspace({ mode = 'view' }: { mode?: WorkspaceMode }) {
  const { doc } = useDocument();

  if (doc.status === 'ready') return <OpenDocument mode={mode} />;
  return <OpenPdf />;
}

/** De foutmelding voor een bestand dat niet geopend kon worden. */
function useErrorText() {
  const { t } = useI18n();
  return (error: FileError) =>
    format(
      {
        'not-pdf': t.document.errors.notPdf,
        password: t.document.errors.password,
        damaged: t.document.errors.damaged,
      }[error.code],
      { name: error.name },
    );
}

/** Meldingen voor bestanden die niet geopend konden worden (de rest werkt gewoon). */
function FileErrors() {
  const { fileErrors } = useDocument();
  const errorText = useErrorText();
  if (fileErrors.length === 0) return null;
  return (
    <div class="file-errors" role="alert">
      {fileErrors.map((error, i) => (
        <p key={`${i}-${error.name}`}>{errorText(error)}</p>
      ))}
    </div>
  );
}

function OpenPdf() {
  const { doc, open } = useDocument();
  const { t } = useI18n();
  const errorText = useErrorText();
  const [dragging, setDragging] = useState(false);

  const openAll = (files: FileList | null | undefined) => {
    const list = [...(files ?? [])];
    if (list.length > 0) void open(list);
  };

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
        openAll(event.dataTransfer?.files);
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
        multiple
        onChange={(event) => {
          openAll(event.currentTarget.files);
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
      {doc.status === 'error' && (
        <p class="dropzone__error" role="alert">
          {errorText(doc)}
        </p>
      )}
      <FileErrors />
    </section>
  );
}

function OpenDocument({ mode }: { mode: WorkspaceMode }) {
  const { doc, close, pages, activeSources, sourceOf } = useDocument();
  const { t, language } = useI18n();
  if (doc.status !== 'ready') return null;

  const multiple = activeSources.length > 1;
  const title = multiple
    ? format(t.document.files, { n: activeSources.length })
    : (activeSources[0]?.name ?? '');
  const size = activeSources.reduce((total, source) => total + source.size, 0);

  return (
    <section class="document" aria-labelledby="document-title">
      <div class="document__bar">
        <div>
          <h2 id="document-title" class="document__name">
            {title}
          </h2>
          <p class="document__meta">
            {plural(pages.length, t.document.pagesOne, t.document.pagesOther)} ·{' '}
            {formatFileSize(size, language)}
          </p>
        </div>
        <button type="button" class="button button--secondary" onClick={close}>
          {t.document.close}
        </button>
      </div>
      <FileErrors />
      {mode === 'pages' && <PageEditor />}
      {mode === 'merge' && <MergeView />}
      {mode !== 'pages' && (
        <ol class="thumbs" aria-label={format(t.document.thumbnails, { name: title })}>
          {pages.map((page, index) => {
            const source = sourceOf(page);
            if (!source) return null;
            const label = [
              format(t.document.page, { n: index + 1 }),
              multiple ? format(t.pages.fromFile, { name: source.name }) : '',
            ]
              .filter(Boolean)
              .join(', ');
            return (
              <li key={`page-${page.key}`}>
                <Thumbnail
                  pdf={source.pdf}
                  pageNumber={page.source + 1}
                  rotation={page.rotation}
                  caption={index + 1}
                  label={label}
                />
                {multiple && (
                  <span class="page-option__file" aria-hidden="true">
                    {source.name}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
