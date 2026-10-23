import { hrefFor, type TaskId } from '../router';
import { strings } from '../strings';

export function TaskPage({ id }: { id: TaskId }) {
  const task = strings.tasks[id];
  return (
    <>
      <p class="back">
        <a href={hrefFor({ name: 'home' })}>{strings.allTasks}</a>
      </p>
      <h1 id="page-title" tabIndex={-1}>
        {task.title}
      </h1>
      <p class="lead">{task.description}</p>
      <section class="notice" aria-labelledby="coming-soon">
        <h2 id="coming-soon" class="notice__title">
          {strings.comingSoon}
        </h2>
        <p>{strings.comingSoonDetail}</p>
      </section>
    </>
  );
}
