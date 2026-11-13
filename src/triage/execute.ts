/**
 * Archief / Triage, Map opruimen: Uitvoeren. Zoals `execute` in DocumentTriage (server.py), maar
 * in de browser: elke PDF met een besluit wordt verplaatst, naar zijn doelmap of naar de
 * prullenbakmap in de bronmap. Bewaren en niet beoordeeld: er gebeurt niets. Bestaat de naam al,
 * dan `naam_1.pdf`, `naam_2.pdf` …, zoals server.py.
 */
import { TRASH_FOLDER, pathText, type FileEntryHandle, type FolderHandle } from './folders';
import { isMove, sameFolder, type TriageFile } from './triage';

/** Eén handeling: een PDF van zijn map naar een andere map (paden vanaf de hoofdmap). */
export type Action = {
  id: number;
  name: string;
  handle: FileEntryHandle;
  /** De map waar de PDF nu staat. */
  from: string[];
  /** De map waar hij heen gaat. */
  to: string[];
  kind: 'move' | 'trash';
};

/**
 * Wat Uitvoeren gaat doen. Verplaatsen naar de map waar de PDF al staat, is niets te doen (en komt
 * er dus niet in). Naar de prullenbak: naar `_Prullenbak (triage)` in de bronmap, met de submappen
 * erbij (`2024/c.pdf` → `_Prullenbak (triage)/2024/c.pdf`), zodat terugzetten makkelijk is.
 */
export function planActions(files: readonly TriageFile[], source: readonly string[]): Action[] {
  const actions: Action[] = [];
  for (const entry of files) {
    const { decision, handle } = entry;
    if (!handle || (decision !== 'remove' && !isMove(decision))) continue;
    const dirs = entry.dirs ?? [];
    const from = [...source, ...dirs];
    const to = isMove(decision)
      ? decision.move === ''
        ? []
        : decision.move.split('/')
      : [...source, TRASH_FOLDER, ...dirs];
    if (isMove(decision) && sameFolder(pathText(from), pathText(to))) continue;
    actions.push({
      id: entry.id,
      name: entry.name,
      handle,
      from,
      to,
      kind: isMove(decision) ? 'move' : 'trash',
    });
  }
  return actions;
}

/**
 * De mappen die Uitvoeren nieuw aanmaakt: nieuwe mappen uit het mapvenster waar echt een PDF heen
 * gaat (V3), en de prullenbakmap (met submappen) als die er nog niet is. Paden vanaf de hoofdmap.
 */
export function plannedFolders(
  actions: readonly Action[],
  newFolders: readonly string[],
): string[] {
  const out: string[] = [];
  const add = (text: string) => {
    if (!out.some((folder) => sameFolder(folder, text))) out.push(text);
  };
  for (const action of actions) {
    for (let i = 1; i <= action.to.length; i++) {
      const prefix = pathText(action.to.slice(0, i));
      if (newFolders.some((folder) => sameFolder(folder, prefix))) add(prefix);
    }
  }
  return out;
}

/** Waarom een handeling mislukte. */
export type FailReason = 'notFound' | 'noFolder' | 'denied' | 'failed';

/** De uitkomst van één handeling: gelukt (met de naam die het bestand kreeg) of mislukt. */
export type Outcome = { ok: true; name: string; to: string[] } | { ok: false; reason: FailReason };

/** De doelmap ontbreekt (en mag niet worden aangemaakt). */
class NoFolder extends Error {
  constructor() {
    super('Doelmap niet gevonden');
    this.name = 'NoFolderError';
  }
}

const errorName = (error: unknown) => (error as { name?: string } | null)?.name ?? '';

/** De reden van een fout, in onze vaste soorten. */
export function reasonOf(error: unknown): FailReason {
  if (error instanceof NoFolder) return 'noFolder';
  const name = errorName(error);
  if (name === 'NotFoundError') return 'notFound';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  return 'failed';
}

/**
 * De map op dit pad. Een ontbrekende map wordt alleen aangemaakt als `create` het toestaat (een
 * nieuwe map uit het mapvenster, of de prullenbakmap); anders `NoFolder`, zoals server.py
 * ("Doelmap niet gevonden").
 */
async function folderFor(
  root: FolderHandle,
  path: readonly string[],
  create: (prefix: string) => boolean,
): Promise<FolderHandle> {
  let folder = root;
  for (let i = 0; i < path.length; i++) {
    const name = path[i]!;
    try {
      folder = await folder.getDirectoryHandle(name);
    } catch (error) {
      if (errorName(error) !== 'NotFoundError') throw error;
      if (!create(pathText(path.slice(0, i + 1)))) throw new NoFolder();
      folder = await folder.getDirectoryHandle(name, { create: true });
    }
  }
  return folder;
}

/** Of er in de map al iets met deze naam staat (een bestand, of een map). */
async function taken(folder: FolderHandle, name: string): Promise<boolean> {
  if (typeof folder.getFileHandle !== 'function') return false;
  try {
    await folder.getFileHandle(name);
    return true;
  } catch (error) {
    // Een map met die naam: ook bezet (server.py kijkt met os.path.exists).
    if (errorName(error) === 'TypeMismatchError') return true;
    // Alleen "niet gevonden" betekent vrij. Bij elke andere fout (geen toegang, onbekend) niet
    // gokken: dan mislukt het verplaatsen van deze PDF, in plaats van iets te overschrijven.
    if (errorName(error) === 'NotFoundError') return false;
    throw error;
  }
}

/** Een vrije naam in de map: de naam zelf, of `naam_1.pdf`, `naam_2.pdf` …, zoals server.py. */
export async function freeName(folder: FolderHandle, name: string): Promise<string> {
  if (!(await taken(folder, name))) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; ; n++) {
    const candidate = `${base}_${n}${extension}`;
    if (!(await taken(folder, candidate))) return candidate;
  }
}

/** Of de browser bestanden kan verplaatsen (Edge en Chrome sinds versie 111). */
export const canMove = (actions: readonly Action[]): boolean =>
  actions.every((action) => typeof action.handle.move === 'function');

/**
 * Voert de handelingen uit, één voor één. Mislukt er een, dan gaan de andere gewoon door (zoals
 * server.py). Een nieuwe map wordt pas aangemaakt als er een PDF heen gaat; de prullenbakmap ook.
 * `onOutcome` meldt elke uitkomst meteen.
 */
export async function runActions(
  root: FolderHandle,
  source: readonly string[],
  actions: readonly Action[],
  newFolders: readonly string[],
  onOutcome: (action: Action, outcome: Outcome) => void,
): Promise<void> {
  const trash = pathText([...source, TRASH_FOLDER]);
  for (const action of actions) {
    let outcome: Outcome;
    try {
      const create =
        action.kind === 'trash'
          ? (prefix: string) =>
              sameFolder(prefix, trash) ||
              prefix.toLocaleLowerCase('nl').startsWith(`${trash.toLocaleLowerCase('nl')}/`)
          : (prefix: string) => newFolders.some((folder) => sameFolder(folder, prefix));
      const destination = await folderFor(root, action.to, create);
      const name = await freeName(destination, action.name);
      await action.handle.move!(destination, name);
      outcome = { ok: true, name, to: action.to };
    } catch (error) {
      outcome = { ok: false, reason: reasonOf(error) };
    }
    onOutcome(action, outcome);
  }
}
