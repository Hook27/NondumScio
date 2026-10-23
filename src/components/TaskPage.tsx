import { useI18n } from '../i18n/LanguageContext';
import { hrefFor, type TaskId } from '../router';

export function TaskPage({ id }: { id: TaskId }) {
  const { t } = useI18n();
  const task = t.tasks[id];

  return (
    <>
      <p class="back">
        <a href={hrefFor({ name: 'home' })}>{t.allTasks}</a>
      </p>
      <h1 id="page-title" tabIndex={-1}>
        {task.title}
      </h1>
      <p class="lead">{task.description}</p>
      <section class="notice" aria-labelledby="coming-soon">
        <h2 id="coming-soon" class="notice__title">
          {t.comingSoon}
        </h2>
        <p>{t.comingSoonDetail}</p>
      </section>
    </>
  );
}
