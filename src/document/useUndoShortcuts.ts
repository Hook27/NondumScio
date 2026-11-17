import { useShortcuts } from '../lib/useShortcuts';

/**
 * Ctrl+Z ongedaan maken, Ctrl+Y of Ctrl+Shift+Z opnieuw: overal hetzelfde, en zoals alle
 * sneltoetsen niet tijdens het typen in een veld en niet bij een open venster.
 */
export function useUndoShortcuts(undo: () => void, redo: () => void) {
  useShortcuts(
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    },
    [undo, redo],
  );
}
