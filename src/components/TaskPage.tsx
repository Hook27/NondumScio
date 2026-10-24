import { useI18n } from '../i18n/LanguageContext';
import { hrefFor, type TaskId } from '../router';
import { Workspace, type WorkspaceMode } from './Workspace';

export function TaskPage({ id }: { id: TaskId }) {
  const { t } = useI18n();
  const task = t.tasks[id];
  // Taken die al werken; de andere tonen alleen de pagina's en "Binnenkort".
  const mode: WorkspaceMode = id === 'pages' ? 'pages' : id === 'merge' ? 'merge' : 'view';

  return (
    <>
      {/* Eén smalle regel, zodat het werkgebied zoveel mogelijk ruimte krijgt. */}
      <div class="task-head">
        <a class="task-head__back" href={hrefFor({ name: 'home' })}>
          {t.allTasks}
        </a>
        <h1 id="page-title" class="task-head__title" tabIndex={-1}>
          {task.title}
        </h1>
        <p class="task-head__lead">{task.description}</p>
      </div>
      <Workspace mode={mode} />
    </>
  );
}
