/** De taken die de werkbank aanbiedt. De id is ook het adres: `#/merge`. */
export const TASK_IDS = ['merge', 'split', 'pages', 'convert', 'edit', 'redact'] as const;

export type TaskId = (typeof TASK_IDS)[number];

/**
 * De onderdelen onder Geavanceerd: zelfstandige gereedschappen voor op de computer, elk met een
 * eigen adres onder `#/advanced/` (bijvoorbeeld `#/advanced/rename`).
 */
export const ADVANCED_IDS = ['rename'] as const;

export type AdvancedId = (typeof ADVANCED_IDS)[number];

export type Route =
  | { name: 'home' }
  | { name: 'task'; id: TaskId }
  | { name: 'advanced' }
  | { name: 'advancedTool'; id: AdvancedId }
  | { name: 'notFound' };

function isTaskId(value: string): value is TaskId {
  return (TASK_IDS as readonly string[]).includes(value);
}

function isAdvancedId(value: string): value is AdvancedId {
  return (ADVANCED_IDS as readonly string[]).includes(value);
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
  if (clean === 'advanced') return { name: 'advanced' };
  const tool = /^advanced\/([^/]+)$/.exec(clean)?.[1];
  if (tool !== undefined && isAdvancedId(tool)) return { name: 'advancedTool', id: tool };
  return { name: 'notFound' };
}

/** Het adres (met `#`) dat bij een route hoort. */
export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'task':
      return `#/${route.id}`;
    case 'advanced':
      return '#/advanced';
    case 'advancedTool':
      return `#/advanced/${route.id}`;
    case 'notFound':
      return '#/';
  }
}

export function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  if (a.name === 'task' && b.name === 'task') return a.id === b.id;
  if (a.name === 'advancedTool' && b.name === 'advancedTool') return a.id === b.id;
  return true;
}
