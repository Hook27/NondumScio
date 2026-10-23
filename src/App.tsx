import { useEffect, useRef } from 'preact/hooks';
import { Header } from './components/Header';
import { Home } from './components/Home';
import { NotFound } from './components/NotFound';
import { TaskPage } from './components/TaskPage';
import { type Route } from './router';
import { strings } from './strings';
import { useRoute } from './useRoute';

function pageTitle(route: Route): string {
  switch (route.name) {
    case 'home':
      return `${strings.appName} · ${strings.tagline}`;
    case 'task':
      return `${strings.tasks[route.id].title} · ${strings.appName}`;
    case 'notFound':
      return `${strings.notFound.title} · ${strings.appName}`;
  }
}

/**
 * Houdt de paginatitel bij en zet na elke navigatie de focus op de kop, zodat
 * toetsenbord- en schermlezergebruikers weten dat er iets veranderd is.
 */
function useRouteAnnouncer(route: Route) {
  const first = useRef(true);

  useEffect(() => {
    document.title = pageTitle(route);
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById('page-title')?.focus();
  }, [route]);
}

export function App() {
  const route = useRoute();
  useRouteAnnouncer(route);

  return (
    <>
      <a class="skip-link" href="#main">
        {strings.skipToContent}
      </a>
      <Header route={route} />
      <main id="main" class="site-main">
        {route.name === 'home' && <Home />}
        {route.name === 'task' && <TaskPage id={route.id} />}
        {route.name === 'notFound' && <NotFound />}
      </main>
    </>
  );
}
