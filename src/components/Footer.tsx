import { useI18n } from '../i18n/LanguageContext';

/** Het versienummer van deze build, bijvoorbeeld "PR.009". Lokaal staat er "dev". */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev';

export function Footer({ version = APP_VERSION }: { version?: string }) {
  const { t } = useI18n();

  return (
    <footer class="site-footer">
      <span class="version" title={`${t.version} ${version}`}>
        {version}
      </span>
    </footer>
  );
}
