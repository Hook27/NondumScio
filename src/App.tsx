import { useEffect, useRef } from 'preact/hooks';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { Home } from './components/Home';
import { NotFound } from './components/NotFound';
import { TaskPage } from './components/TaskPage';
import { LanguageProvider, useI18n } from './i18n/LanguageContext';
import type { Messages } from './i18n/nl';
import type { Route } from './router';
import { useRoute } from './useRoute';

function pageTitle(route: Route, t: Messages): string {
  switch (route.name) {
    case 'home':
      return `${t.appName} · ${t.tagline}`;
    case 'task':
      return `${t.tasks[route.id].title} · ${t.appName}`;
    case 'notFound':
      return `${t.notFound.title} · ${t.appName}`;
  }
}

/**
 * Houdt de paginatitel bij (ook bij een andere taal) en zet na elke navigatie de
 * focus op de kop, zodat toetsenbord- en schermlezergebruikers weten dat er iets
 * veranderd is. Van taal wisselen verplaatst de focus niet.
 */
function usePageTitleAndFocus(route: Route) {
  const { t } = useI18n();
  const first = useRef(true);

  useEffect(() => {
    document.title = pageTitle(route, t);
  }, [route, t]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById('page-title')?.focus();
  }, [route]);
}

function AppContent() {
  const route = useRoute();
  const { t } = useI18n();
  usePageTitleAndFocus(route);

  return (
    <>
      <a class="skip-link" href="#main">
        {t.skipToContent}
      </a>
      <Header route={route} />
      <main id="main" class="site-main">
        {route.name === 'home' && <Home />}
        {route.name === 'task' && <TaskPage id={route.id} />}
        {route.name === 'notFound' && <NotFound />}
      </main>
      <Footer />
    </>
  );
}

export function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}
