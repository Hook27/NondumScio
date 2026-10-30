import type { FunctionComponent } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useI18n } from '../i18n/LanguageContext';
import { ADVANCED_IDS, hrefFor, type AdvancedId } from '../router';

/**
 * Geavanceerd: zelfstandige onderdelen voor op de computer. Ze hebben een eigen adres en werken
 * los van de gewone taken (eigen bestanden). Op een smal scherm staat er alleen een melding; het
 * menu en de startpagina tonen Geavanceerd daar niet (zie `.desktop-only` in de stijl).
 */
export function AdvancedHome() {
  const { t } = useI18n();
  const a = t.advanced;
  return (
    <>
      <h1 id="page-title" tabIndex={-1}>
        {a.title}
      </h1>
      <p class="lead mobile-only">{a.desktopOnly}</p>
      <div class="desktop-only">
        <p class="lead">{a.intro}</p>
        <ul class="card-grid">
          {ADVANCED_IDS.map((id) => (
            <li key={id}>
              <a class="card" href={hrefFor({ name: 'advancedTool', id })}>
                <h2 class="card__title">{a.tools[id].title}</h2>
                <p class="card__text">{a.tools[id].description}</p>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <p>
        <a href={hrefFor({ name: 'home' })}>{t.allTasks}</a>
      </p>
    </>
  );
}

/** De pagina van één onderdeel, met dezelfde smalle kop als een taak. */
export function AdvancedToolPage({ id }: { id: AdvancedId }) {
  const { t } = useI18n();
  const a = t.advanced;
  const tool = a.tools[id];
  return (
    <>
      <div class="task-head">
        <a class="task-head__back" href={hrefFor({ name: 'advanced' })}>
          {a.back}
        </a>
        <h1 id="page-title" class="task-head__title" tabIndex={-1}>
          {tool.title}
        </h1>
        <p class="task-head__lead">{tool.description}</p>
      </div>
      <p class="lead mobile-only">{a.desktopOnly}</p>
      <div class="desktop-only">
        <Tool id={id} />
      </div>
    </>
  );
}

/** Laadt een onderdeel pas als het geopend wordt, zodat de rest van de app er niet zwaarder van wordt. */
const tools: Record<AdvancedId, () => Promise<FunctionComponent>> = {
  rename: async () => (await import('../rename/RenameTool')).RenameTool,
};

function Tool({ id }: { id: AdvancedId }) {
  const [Component, setComponent] = useState<FunctionComponent | null>(null);
  useEffect(() => {
    let cancelled = false;
    void tools[id]().then((loaded) => {
      if (!cancelled) setComponent(() => loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return Component ? <Component /> : null;
}
