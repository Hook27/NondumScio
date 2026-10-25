import { useDocument } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { AnnotateView } from './AnnotateView';
import { ConvertView } from './ConvertView';
import { MergeView } from './MergeView';
import { OpenPdf } from './OpenPdf';
import { PageEditor } from './PageEditor';
import { SplitView } from './SplitView';
import { ComingSoon, PageThumbs, PaneHead, Split } from './WorkspaceParts';

/** Wat het werkgebied laat doen: alleen bekijken, pagina's bewerken, samenvoegen, splitsen of omzetten. */
export type WorkspaceMode = 'view' | 'pages' | 'merge' | 'split' | 'convert' | 'edit';

/** Het werkgebied van een taak: PDF's openen, en daarna de pagina's ervan. */
export function Workspace({ mode = 'view' }: { mode?: WorkspaceMode }) {
  const { doc } = useDocument();

  // Omzetten werkt ook zonder PDF (afbeeldingen naar PDF) en regelt het openen zelf.
  if (mode === 'convert') return <ConvertView />;

  if (doc.status === 'ready') {
    if (mode === 'pages') return <PageEditor />;
    if (mode === 'merge') return <MergeView />;
    if (mode === 'split') return <SplitView />;
    if (mode === 'edit') return <AnnotateView />;
    return <ViewDocument />;
  }
  return (
    <>
      <OpenPdf />
      {mode === 'view' && <ComingSoon />}
    </>
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
