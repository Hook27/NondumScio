import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks';
import {
  detectTheme,
  readStoredTheme,
  storeTheme,
  systemThemeQuery,
  isTheme,
  type Theme,
} from './theme';

type ThemeState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({
  children,
  initial,
}: {
  children: ComponentChildren;
  /** Alleen voor tests: sla de detectie over en start met dit thema. */
  initial?: Theme;
}) {
  const [theme, setThemeState] = useState<Theme>(
    () => initial ?? detectTheme(readStoredTheme(), systemThemeQuery()?.matches ?? false),
  );
  // Heeft de gebruiker gekozen? Dan blijft die keuze staan; anders volgen we het systeem.
  const [chosen, setChosen] = useState<boolean>(
    () => initial !== undefined || isTheme(readStoredTheme()),
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (chosen) return;
    const query = systemThemeQuery();
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) =>
      setThemeState(event.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [chosen]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    setChosen(true);
    storeTheme(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme moet binnen een ThemeProvider worden gebruikt');
  return value;
}
