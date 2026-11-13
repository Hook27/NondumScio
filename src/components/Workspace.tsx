import { useDocument } from '../document/DocumentContext';
import type { TaskId } from '../router';
import { AnnotateView } from './AnnotateView';
import { ConvertView } from './ConvertView';
import { MergeView } from './MergeView';
import { OpenPdf } from './OpenPdf';
import { PageEditor } from './PageEditor';
import { SplitView } from './SplitView';

/** Wat het werkgebied laat doen: elke taak heeft zijn eigen gereedschap. */
export type WorkspaceMode = TaskId;

/** Het werkgebied van een taak: PDF's openen, en daarna het gereedschap van die taak. */
export function Workspace({ mode }: { mode: WorkspaceMode }) {
  const { doc } = useDocument();

  // Omzetten werkt ook zonder PDF (afbeeldingen naar PDF) en regelt het openen zelf.
  if (mode === 'convert') return <ConvertView />;

  if (doc.status !== 'ready') return <OpenPdf />;
  if (mode === 'pages') return <PageEditor />;
  if (mode === 'merge') return <MergeView />;
  if (mode === 'split') return <SplitView />;
  // Bewerken en Redigeren gebruiken hetzelfde scherm, maar elk met een eigen sleutel: anders gaan
  // het gekozen gereedschap, de selectie en de meldingen mee naar de andere taak. De aantekeningen
  // zelf horen bij het document en blijven.
  if (mode === 'edit') return <AnnotateView key="edit" />;
  return <AnnotateView key="redact" mode="redact" />;
}
