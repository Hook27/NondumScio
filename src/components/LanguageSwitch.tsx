import { LANGUAGES, LANGUAGE_NAMES } from '../i18n';
import { useI18n } from '../i18n/LanguageContext';

export function LanguageSwitch() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div class="lang-switch" role="group" aria-label={t.language}>
      {LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-label={LANGUAGE_NAMES[code]}
          aria-pressed={language === code}
          onClick={() => setLanguage(code)}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
