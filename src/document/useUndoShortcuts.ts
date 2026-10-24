import { useEffect } from 'preact/hooks';

/** Is de toetsenbordfocus in een tekstveld? Dan laten we sneltoetsen met rust. */
export function typingIn(target: EventTarget | null) {
  return (
    target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]')
  );
}

/** Ctrl+Z en Ctrl+Y (of Ctrl+Shift+Z) voor ongedaan maken en opnieuw, behalve in tekstvelden. */
export function useUndoShortcuts(undo: () => void, redo: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || typingIn(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undo, redo]);
}
