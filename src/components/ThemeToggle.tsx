import { useI18n } from '../i18n/LanguageContext';
import { useTheme } from '../ThemeContext';

/** Schakelaar voor het donkere thema. Het icoon blijft een maan; de stand zit in `aria-pressed`. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      class="theme-toggle"
      aria-pressed={dark}
      aria-label={t.theme.dark}
      title={t.theme.dark}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="currentColor" />
      </svg>
    </button>
  );
}
