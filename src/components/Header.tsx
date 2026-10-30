import { useEffect, useRef } from 'preact/hooks';
import { useI18n } from '../i18n/LanguageContext';
import { TASK_IDS, hrefFor, type Route } from '../router';
import { LanguageSwitch } from './LanguageSwitch';
import { ThemeToggle } from './ThemeToggle';

export function Header({ route }: { route: Route }) {
  const { t } = useI18n();
  const nav = useRef<HTMLElement>(null);

  // Op een telefoon is het menu één rij die je zijwaarts schuift: houd de gekozen taak in beeld.
  useEffect(() => {
    const el = nav.current;
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !current) return;
    el.scrollLeft = current.offsetLeft - (el.clientWidth - current.offsetWidth) / 2;
  }, [route]);

  return (
    <header class="site-header">
      <div class="site-header__inner">
        <a class="brand" href={hrefFor({ name: 'home' })}>
          <span class="brand__name">{t.appName}</span>
          <span class="brand__tagline">{t.tagline}</span>
        </a>
        <nav ref={nav} class="main-nav" aria-label={t.mainMenu}>
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
            {/* Geavanceerd staat alleen op een breed scherm in het menu. */}
            <li class="desktop-only">
              <a
                href={hrefFor({ name: 'advanced' })}
                aria-current={
                  route.name === 'advanced' || route.name === 'advancedTool' ? 'page' : undefined
                }
              >
                {t.advanced.title}
              </a>
            </li>
          </ul>
        </nav>
        <div class="header-controls">
          <LanguageSwitch />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
