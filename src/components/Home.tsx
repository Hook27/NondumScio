import { useI18n } from '../i18n/LanguageContext';
import { TASK_IDS, hrefFor } from '../router';

export function Home() {
  const { t } = useI18n();

  return (
    <>
      <h1 id="page-title" tabIndex={-1}>
        {t.home.title}
      </h1>
      <p class="lead">{t.home.intro}</p>
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
