/** De taken die de werkbank aanbiedt. De id is ook het adres: `#/merge`. */
export const TASK_IDS = ['merge', 'split', 'pages', 'convert', 'edit', 'redact'] as const;

export type TaskId = (typeof TASK_IDS)[number];

export type Route = { name: 'home' } | { name: 'task'; id: TaskId } | { name: 'notFound' };

function isTaskId(value: string): value is TaskId {
  return (TASK_IDS as readonly string[]).includes(value);
}

/**
 * Zet het deel achter de `#` in het browseradres om naar een route.
 * Accepteert `#/merge`, `#merge`, `#/merge/` en negeert een eventuele `?query`.
 */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '';
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '');

  if (clean === '') return { name: 'home' };
  if (isTaskId(clean)) return { name: 'task', id: clean };
  return { name: 'notFound' };
}

/** Het adres (met `#`) dat bij een route hoort. */
export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'task':
      return `#/${route.id}`;
    case 'notFound':
      return '#/';
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  return a.name === 'task' && b.name === 'task' ? a.id === b.id : true;
}
