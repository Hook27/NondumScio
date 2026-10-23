import { TASK_IDS, hrefFor, type Route } from '../router';
import { strings } from '../strings';

export function Header({ route }: { route: Route }) {
  return (
    <header class="site-header">
      <div class="site-header__inner">
        <a class="brand" href={hrefFor({ name: 'home' })}>
          <span class="brand__name">{strings.appName}</span>
          <span class="brand__tagline">{strings.tagline}</span>
        </a>
        <nav class="main-nav" aria-label={strings.mainMenu}>
          <ul>
            {TASK_IDS.map((id) => {
              const active = route.name === 'task' && route.id === id;
              return (
                <li key={id}>
                  <a
                    href={hrefFor({ name: 'task', id })}
                    aria-current={active ? 'page' : undefined}
                  >
                    {strings.tasks[id].title}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
