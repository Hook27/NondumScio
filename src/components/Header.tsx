import { useI18n } from '../i18n/LanguageContext';
import { TASK_IDS, hrefFor, type Route } from '../router';
import { LanguageSwitch } from './LanguageSwitch';

export function Header({ route }: { route: Route }) {
  const { t } = useI18n();

  return (
    <header class="site-header">
      <div class="site-header__inner">
        <a class="brand" href={hrefFor({ name: 'home' })}>
          <span class="brand__name">{t.appName}</span>
          <span class="brand__tagline">{t.tagline}</span>
        </a>
        <nav class="main-nav" aria-label={t.mainMenu}>
          <ul>
            {TASK_IDS.map((id) => {
              const active = route.name === 'task' && route.id === id;
              return (
                <li key={id}>
                  <a
                    href={hrefFor({ name: 'task', id })}
                    aria-current={active ? 'page' : undefined}
                  >
                    {t.tasks[id].title}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
        <LanguageSwitch />
      </div>
    </header>
  );
}
