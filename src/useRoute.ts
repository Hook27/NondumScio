import { useEffect, useState } from 'preact/hooks';
import { parseHash, type Route } from './router';

/** De huidige route, die meebeweegt met het adres in de browser (en de terugknop). */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    // Het doel onthouden: opruimen kan na het einde van een test vallen, als `window` al weg is.
    const win = window;
    win.addEventListener('hashchange', onChange);
    return () => win.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}
