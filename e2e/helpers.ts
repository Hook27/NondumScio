import { expect, type Locator, type Page } from '@playwright/test';
import { LANGUAGES, STORAGE_KEY, messages, type Language } from '../src/i18n';
import { ADVANCED_IDS, TASK_IDS } from '../src/router';
import { THEME_STORAGE_KEY, type Theme } from '../src/theme';

export { LANGUAGES, TASK_IDS, messages };
export type { Language, Theme };

/** Alle adressen van de app: de startpagina, elke taak en een onbekend adres. */
export const ROUTES = [
  '/',
  ...TASK_IDS.map((id) => `/#/${id}`),
  '/#/advanced',
  ...ADVANCED_IDS.map((id) => `/#/advanced/${id}`),
  '/#/bestaat-niet',
] as const;

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
 * De ruimere wachttijd voor de eerste controle na het openen van een PDF (en na het tekenen): onder
 * volle belasting duurt dat soms langer dan de standaard 5 s. Eén waarde voor alle specs.
 */
export const SLOW = { timeout: 15_000 };

/** Hoe vaak `openPage` per pagina is aangeroepen (zie daar). */
const openCalls = new WeakMap<Page, number>();

/**
 * Opent een pagina met een bepaalde taal en/of thema alsof de bezoeker die eerder gekozen
 * had. Dat gebeurt via de opslag van de browser, vóórdat de app start, en één keer: een latere
 * herlaadbeurt (`page.reload()`) laat de keuzes van de test zelf dus ongemoeid.
 *
 * Eén keer laden in plaats van drie: een opstartscript zet de opslag vóór de app, alleen bij het
 * eerste laden na deze aanroep (elke aanroep krijgt een volgnummer, dat in de sessie-opslag van het
 * tabblad bewaard wordt). Staat de pagina al op de site, dan wordt er nog herladen: een ander adres
 * na het hekje laadt de app anders niet opnieuw.
 */
export async function openPage(page: Page, path = '/', prefs: Preferences = {}): Promise<void> {
  const round = (openCalls.get(page) ?? 0) + 1;
  openCalls.set(page, round);
  await page.addInitScript(
    ({ lang, theme, langKey, themeKey, round }) => {
      const KEY = 'e2e-open-page';
      if (Number(sessionStorage.getItem(KEY) ?? 0) >= round) return;
      sessionStorage.setItem(KEY, String(round));
      localStorage.clear();
      if (lang) localStorage.setItem(langKey, lang);
      if (theme) localStorage.setItem(themeKey, theme);
    },
    { ...prefs, langKey: STORAGE_KEY, themeKey: THEME_STORAGE_KEY, round },
  );
  const fresh = page.url() === 'about:blank';
  await page.goto(url(path));
  if (!fresh) await page.reload();
}

/**
 * Opent een taak (zoals `/#/pages`) met taal en thema, kiest een PDF en wacht ruim tot hij open
 * is: de naam van het bestand staat dan als kop boven het werkvak.
 */
export async function openPdf(
  page: Page,
  path: string,
  file: { name: string; mimeType: string; buffer: Buffer },
  prefs: Preferences = {},
): Promise<void> {
  await openPage(page, path, prefs);
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await expect(page.getByRole('heading', { level: 2, name: file.name })).toBeVisible(SLOW);
}

/**
 * Klikt een downloadknop, vult in het venster "Opslaan als" eventueel een andere naam in
 * en bevestigt met "Downloaden". Geeft de download terug.
 */
export async function downloadVia(page: Page, button: Locator, fileName?: string) {
  await button.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  if (fileName !== undefined) await dialog.getByRole('textbox').fill(fileName);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: messages.nl.saveDialog.download }).click(),
  ]);
  return download;
}
