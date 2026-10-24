import { useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { MergeView } from './MergeView';
import { PageEditor } from './PageEditor';
import {
  ComingSoon,
  FileErrors,
  PageThumbs,
  PaneHead,
  Split,
  useErrorText,
} from './WorkspaceParts';

/** Wat het werkgebied laat doen: alleen bekijken, pagina's bewerken of bestanden samenvoegen. */
export type WorkspaceMode = 'view' | 'pages' | 'merge';

/** Het werkgebied van een taak: PDF's openen, en daarna de pagina's ervan. */
export function Workspace({ mode = 'view' }: { mode?: WorkspaceMode }) {
  const { doc } = useDocument();

  if (doc.status === 'ready') {
    if (mode === 'pages') return <PageEditor />;
    if (mode === 'merge') return <MergeView />;
    return <ViewDocument />;
  }
  return (
    <>
      <OpenPdf />
      {mode === 'view' && <ComingSoon />}
    </>
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

/** Taken zonder eigen gereedschap: de pagina's bekijken, en de melding dat er meer komt. */
function ViewDocument() {
  const { activeSources } = useDocument();
  const { t } = useI18n();
  const name =
    activeSources.length > 1
      ? format(t.document.files, { n: activeSources.length })
      : (activeSources[0]?.name ?? '');
  return (
    <Split
      tools={<ComingSoon />}
      view={
        <>
          <PaneHead title={t.document.pagesTitle} />
          <PageThumbs label={format(t.document.thumbnails, { name })} />
        </>
      }
    />
  );
}
