import { useEffect, useState } from 'preact/hooks';

/** Dezelfde grens als `.desktop-only` en het splitscherm in `styles.css` (56,25rem). */
const QUERY = '(min-width: 56.25rem)';

function media(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(QUERY)
    : null;
}

/**
 * Of het scherm breed genoeg is voor wat alleen op de computer kan (zoals Splitsen op
 * bladwijzers). Volgt het als het venster smaller of breder wordt. Zonder `matchMedia` (in tests)
 * geldt een breed scherm.
 */
export function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => media()?.matches ?? true);
  useEffect(() => {
    const list = media();
    if (!list) return;
    const update = () => setDesktop(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, []);
  return desktop;
}
