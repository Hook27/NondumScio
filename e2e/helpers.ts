import type { Page } from '@playwright/test';
import { LANGUAGES, STORAGE_KEY, messages, type Language } from '../src/i18n';
import { TASK_IDS } from '../src/router';
import { THEME_STORAGE_KEY, type Theme } from '../src/theme';

export { LANGUAGES, TASK_IDS, messages };
export type { Language, Theme };

/** Alle adressen van de app: de startpagina, elke taak en een onbekend adres. */
export const ROUTES = ['/', ...TASK_IDS.map((id) => `/#/${id}`), '/#/bestaat-niet'] as const;

type Preferences = { lang?: Language; theme?: Theme };

/**
 * Maakt van een app-adres ("/" of "/#/merge") een pad ten opzichte van de basis-URL.
 * Zo werken de tests ook als de site in een submap staat, zoals een PR-voorbeeld
 * (https://pdf.nondumsc.io/pr-preview/pr-14/): "/" zou daar naar de hoofdsite wijzen.
 */
export function url(path: string): string {
  return `.${path}`;
}

/**
 * Opent een pagina met een bepaalde taal en/of thema alsof de bezoeker die eerder gekozen
 * had. Dat gebeurt via de opslag van de browser, en één keer: een latere herlaadbeurt
 * (`page.reload()`) laat de keuzes van de test zelf dus ongemoeid.
 */
export async function openPage(page: Page, path = '/', prefs: Preferences = {}): Promise<void> {
  await page.goto(url('/'));
  await page.evaluate(
    ({ lang, theme, langKey, themeKey }) => {
      localStorage.clear();
      if (lang) localStorage.setItem(langKey, lang);
      if (theme) localStorage.setItem(themeKey, theme);
    },
    { ...prefs, langKey: STORAGE_KEY, themeKey: THEME_STORAGE_KEY },
  );
  await page.goto(url(path));
  await page.reload();
}
