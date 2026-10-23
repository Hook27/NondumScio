import { TASK_IDS, hrefFor } from '../router';
import { strings } from '../strings';

export function Home() {
  return (
    <>
      <h1 id="page-title" tabIndex={-1}>
        {strings.home.title}
      </h1>
      <p class="lead">{strings.home.intro}</p>
      <ul class="card-grid">
        {TASK_IDS.map((id) => (
          <li key={id}>
            <a class="card" href={hrefFor({ name: 'task', id })}>
              <h2 class="card__title">{strings.tasks[id].title}</h2>
              <p class="card__text">{strings.tasks[id].description}</p>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
