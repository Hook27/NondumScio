import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks';
import {
  detectLanguage,
  messages,
  readStoredLanguage,
  storeLanguage,
  type Language,
} from './index';
import type { Messages } from './nl';

type I18n = {
  language: Language;
  setLanguage: (language: Language) => void;
  /** De teksten in de gekozen taal. */
  t: Messages;
};

const LanguageContext = createContext<I18n | null>(null);

export function LanguageProvider({
  children,
  initial,
}: {
  children: ComponentChildren;
  /** Alleen voor tests: sla de detectie over en start in deze taal. */
  initial?: Language;
}) {
  const [language, setLanguageState] = useState<Language>(
    () =>
      initial ??
      detectLanguage(
        readStoredLanguage(),
        navigator.languages?.length ? navigator.languages : [navigator.language],
      ),
  );

  // Het lang-attribuut vertelt browsers en schermlezers in welke taal de pagina is.
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    storeLanguage(next);
  }, []);

  const value = useMemo(
    () => ({ language, setLanguage, t: messages[language] }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): I18n {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useI18n moet binnen een LanguageProvider worden gebruikt');
  return value;
}
