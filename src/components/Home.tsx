import { useI18n } from '../i18n/LanguageContext';
import { TASK_IDS, hrefFor } from '../router';

export function Home() {
  const { t } = useI18n();

  return (
    <>
      <h1 id="page-title" class="home-title" tabIndex={-1}>
        {/* Op een smal scherm staat de korte vorm; schermlezers lezen altijd de volledige. */}
        <span class="home-title__full">{t.home.title}</span>
        <span class="home-title__short" aria-hidden="true">
          {t.home.titleShort}
        </span>
      </h1>
      <ul class="card-grid">
        {TASK_IDS.map((id) => (
          <li key={id}>
            <a class="card" href={hrefFor({ name: 'task', id })}>
              <h2 class="card__title">{t.tasks[id].title}</h2>
              <p class="card__text">{t.tasks[id].description}</p>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
