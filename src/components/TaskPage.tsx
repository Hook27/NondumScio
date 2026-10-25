import { useI18n } from '../i18n/LanguageContext';
import { hrefFor, type TaskId } from '../router';
import { Workspace } from './Workspace';

export function TaskPage({ id }: { id: TaskId }) {
  const { t } = useI18n();
  const task = t.tasks[id];
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
      <Workspace mode={id} />
    </>
  );
}
