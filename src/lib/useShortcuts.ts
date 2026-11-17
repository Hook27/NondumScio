import { useEffect } from 'preact/hooks';

/** Knoppen en vinkjes zijn geen tekstvelden: daar werken de sneltoetsen gewoon. */
const NOT_TYPING = new Set(['checkbox', 'radio', 'button', 'submit', 'reset']);

/**
 * Wordt er getypt (of een schuif of keuzelijst bediend)? Dan gaan de toetsen naar dat veld en niet
 * naar de sneltoetsen. Een vinkje of knop telt niet als typen.
 */
export function typingIn(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const field = target.closest('input, textarea, select, [contenteditable]');
  if (!field) return false;
  return !(field instanceof HTMLInputElement && NOT_TYPING.has(field.type));
}

/** Staat er een venster open (opslaan, bevestigen, bekijken)? Dan horen de toetsen daarbij. */
export function windowOpen(): boolean {
  return document.querySelector('dialog[open]') !== null;
}

/**
 * Sneltoetsen voor een heel scherm, met overal dezelfde regel: niet tijdens het typen in een veld
 * en niet zolang er een venster open is. Zie de bedieningsafspraak (bladeren met ← → ↑ ↓, PgUp,
 * PgDn, Home, End; zoomen met + − 0; Ctrl+Z, Ctrl+Y en Ctrl+Shift+Z voor ongedaan maken en
 * opnieuw).
 */
export function useShortcuts(onKey: (event: KeyboardEvent) => void, deps?: readonly unknown[]) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (typingIn(event.target) || windowOpen()) return;
      onKey(event);
    };
    // Het doel onthouden: opruimen kan na het einde van een test vallen, als `document` al weg is.
    const target = document;
    target.addEventListener('keydown', listener);
    return () => target.removeEventListener('keydown', listener);
    // De afhankelijkheden geeft de aanroeper mee, zoals bij useEffect (zonder: bij elke weergave).
  }, deps);
}
