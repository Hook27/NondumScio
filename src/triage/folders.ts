/**
 * Archief / Triage, werkwijze "Map opruimen": mappen op de computer lezen met de mappen-toegang van
 * de browser (File System Access, alleen in Edge en Chrome). Zoals DocumentTriage, maar zonder
 * server: je wijst één hoofdmap aan, en alles daarbinnen gaat via die toegang. Hier wordt alleen
 * gelezen; schrijven (verplaatsen, nieuwe mappen) komt pas bij Uitvoeren.
 */

/** Wat we van een map gebruiken: een echte map van de browser heeft dit ook (en zo kan een test een nagemaakte map geven). */
export interface FolderHandle {
  readonly kind: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FolderHandle>;
  /** Het bestand met deze naam (een fout als het er niet is, of als het een map is). */
  getFileHandle?(name: string): Promise<FileEntryHandle>;
  values(): AsyncIterable<FolderHandle | FileEntryHandle>;
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

/** Wat we van een bestand gebruiken. */
export interface FileEntryHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  /** Verplaatsen naar een andere map, met een (nieuwe) naam: Edge en Chrome sinds versie 111. */
  move?(destination: FolderHandle, name: string): Promise<void>;
}

/** De map waar "Prullenbak" naartoe verplaatst (in de bronmap); wordt zelf niet ingelezen. */
export const TRASH_FOLDER = '_Prullenbak (triage)';

/** Of de browser mappen kan laten kiezen (Edge en Chrome wel, Firefox en Safari niet). */
export const canPickFolders = (target: object = globalThis): boolean =>
  typeof (target as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

/**
 * Het Windows-venster om de hoofdmap aan te wijzen (alleen lezen). Geeft null als je annuleert;
 * een andere fout (bijvoorbeeld een map die de browser weigert) gaat door.
 */
export async function pickRoot(): Promise<FolderHandle | null> {
  const picker = (
    globalThis as unknown as {
      showDirectoryPicker: (options: { id: string; mode: 'read' }) => Promise<FolderHandle>;
    }
  ).showDirectoryPicker;
  try {
    return await picker({ id: 'nondumscio-triage', mode: 'read' });
  } catch (error) {
    if ((error as { name?: string } | null)?.name === 'AbortError') return null;
    throw error;
  }
}

/**
 * Of we in de map mogen lezen; met `ask` vraagt de browser het (dat kan alleen na een klik). Een
 * map zonder deze vragen (zoals een nagemaakte) mag altijd.
 */
export async function mayRead(folder: FolderHandle, ask: boolean): Promise<boolean> {
  const options = { mode: 'read' as const };
  if (typeof folder.queryPermission !== 'function') return true;
  if ((await folder.queryPermission(options)) === 'granted') return true;
  if (!ask || typeof folder.requestPermission !== 'function') return false;
  return (await folder.requestPermission(options)) === 'granted';
}

/**
 * Of we in de map mogen wijzigen (verplaatsen, mappen aanmaken); de browser vraagt het (alleen na
 * een klik). Een map zonder deze vragen (zoals een nagemaakte) mag altijd.
 */
export async function mayWrite(folder: FolderHandle): Promise<boolean> {
  const options = { mode: 'readwrite' as const };
  if (typeof folder.queryPermission !== 'function') return true;
  if ((await folder.queryPermission(options)) === 'granted') return true;
  if (typeof folder.requestPermission !== 'function') return false;
  return (await folder.requestPermission(options)) === 'granted';
}

/** Mapnamen die we overslaan: verborgen mappen (met een punt ervoor), zoals DocumentTriage. */
const hidden = (name: string) => name.startsWith('.');

/** Op naam, zoals de Verkenner: zonder op hoofdletters te letten, en "2" vóór "10". */
const byName = (a: string, b: string) =>
  a.localeCompare(b, 'nl', { sensitivity: 'base', numeric: true });

/** De map op dit pad (namen vanaf de hoofdmap); null als hij (nog) niet bestaat. */
export async function folderAt(
  root: FolderHandle,
  path: readonly string[],
): Promise<FolderHandle | null> {
  let folder = root;
  for (const name of path) {
    try {
      folder = await folder.getDirectoryHandle(name);
    } catch {
      return null;
    }
  }
  return folder;
}

/** De submappen van een map, op naam, zonder verborgen mappen; zoals het mapvenster van DocumentTriage. */
export async function subfolders(folder: FolderHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of folder.values()) {
    if (entry.kind === 'directory' && !hidden(entry.name)) names.push(entry.name);
  }
  return names.sort(byName);
}

/** Een gevonden PDF: het bestand, het pad van zijn map vanaf de bronmap, en hoe je hem terugvindt. */
export type FoundPdf = {
  file: File;
  handle: FileEntryHandle;
  /** De mappen tussen de bronmap en het bestand (leeg = in de bronmap zelf). */
  dirs: string[];
};

/**
 * Leest de PDF's in een map, op naam; met `recursive` ook in de submappen (eerst de bestanden van
 * een map, dan zijn submappen, op naam). Overgeslagen: andere bestanden, verborgen mappen en de
 * prullenbakmap. Een submap die niet te lezen is, wordt overgeslagen, zoals in DocumentTriage; is de
 * map zelf niet te lezen, dan een fout.
 * `onProgress` meldt hoeveel PDF's er al gevonden zijn.
 */
export async function scanPdfs(
  folder: FolderHandle,
  recursive: boolean,
  onProgress?: (found: number) => void,
): Promise<FoundPdf[]> {
  const found: FoundPdf[] = [];
  const walk = async (dir: FolderHandle, dirs: string[], top = false) => {
    const files: FileEntryHandle[] = [];
    const folders: FolderHandle[] = [];
    try {
      for await (const entry of dir.values()) {
        if (entry.kind === 'file') {
          if (/\.pdf$/i.test(entry.name)) files.push(entry);
        } else if (recursive && !hidden(entry.name) && entry.name !== TRASH_FOLDER) {
          folders.push(entry);
        }
      }
    } catch (error) {
      if (top) throw error;
      return;
    }
    files.sort((a, b) => byName(a.name, b.name));
    for (const handle of files) {
      try {
        found.push({ file: await handle.getFile(), handle, dirs });
        onProgress?.(found.length);
      } catch {
        // Een bestand dat niet te lezen is (bijvoorbeeld net weggehaald) slaan we over.
      }
    }
    folders.sort((a, b) => byName(a.name, b.name));
    for (const sub of folders) await walk(sub, [...dirs, sub.name]);
  };
  await walk(folder, [], true);
  return found;
}

/** Een pad als tekst, zoals in de lijsten: "Archief/Foto/Bloemen". */
export const pathText = (path: readonly string[]): string => path.join('/');

/** Een pad uit die tekst; leeg = de hoofdmap. */
export const pathOf = (text: string): string[] => (text === '' ? [] : text.split('/'));

/**
 * Een deel van het pad, zoals DocumentTriage bij de doelmappen: hooguit de laatste twee mappen,
 * met ".../" ervoor als er meer zijn ("…/Foto/Bloemen" in plaats van alleen "Bloemen").
 */
export function shortPath(path: readonly string[]): string {
  if (path.length <= 2) return path.join('/');
  return `.../${path.slice(-2).join('/')}`;
}

/** De map boven dit pad (de hoofdmap blijft de hoofdmap). */
export const parentOf = (path: readonly string[]): string[] => path.slice(0, -1);

/** Onthoudt de hoofdmap in deze browser (IndexedDB), zodat je bij een volgend bezoek verder kunt. */
const DB = 'nondumscio-triage';
const STORE = 'folders';
const KEY = 'root';

function openDb(): Promise<IDBDatabase> | null {
  const idb = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (!idb) return null;
  return new Promise((resolve, reject) => {
    const request = idb.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Een handeling op de opslag; mislukt het (privévenster, geen opslag), dan gewoon niets. */
async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = work(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function rememberRoot(folder: FolderHandle): Promise<void> {
  await withStore('readwrite', (store) => store.put(folder, KEY));
}

export async function rememberedRoot(): Promise<FolderHandle | null> {
  const folder = await withStore<FolderHandle | undefined>('readonly', (store) => store.get(KEY));
  return folder ?? null;
}

export async function forgetRoot(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(KEY));
}
