import { useI18n } from '../i18n/LanguageContext';
import { hrefFor } from '../router';

export function NotFound() {
  const { t } = useI18n();

  return (
    <>
      <h1 id="page-title" tabIndex={-1}>
        {t.notFound.title}
      </h1>
      <p class="lead">{t.notFound.detail}</p>
      <p>
        <a href={hrefFor({ name: 'home' })}>{t.allTasks}</a>
      </p>
    </>
  );
}
