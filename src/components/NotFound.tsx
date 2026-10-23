import { hrefFor } from '../router';
import { strings } from '../strings';

export function NotFound() {
  return (
    <>
      <h1 id="page-title" tabIndex={-1}>
        {strings.notFound.title}
      </h1>
      <p class="lead">{strings.notFound.detail}</p>
      <p>
        <a href={hrefFor({ name: 'home' })}>{strings.allTasks}</a>
      </p>
    </>
  );
}
