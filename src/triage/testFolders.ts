import type { FileEntryHandle, FolderHandle } from './folders';

/**
 * Een nagemaakte map voor de tests, zoals de mappen-toegang van de browser hem geeft: een "nep-
 * bestandssysteem" om veilig te testen wat Uitvoeren doet. Beschrijf hem als een boom: een bestand
 * is een tekst (de inhoud), een map een object. De volgorde in de boom is de volgorde waarin de map
 * zijn inhoud geeft (niet gesorteerd, zoals op een echte schijf). De boom verandert echt mee:
 * verplaatsen en mappen aanmaken zie je daarna in het object terug.
 *
 * - `locked`: deze mappen (pad vanaf de map zelf, zoals "Documenten/Dicht") geven een fout bij lezen.
 * - `permission`: vraagt om toestemming (lezen); `write`: apart voor wijzigen.
 * - `noMove`: bestanden zonder `move` (een browser die niet echt kan verplaatsen).
 * - `failMove`: deze bestandsnamen geven een fout bij verplaatsen.
 */
export type Tree = { [name: string]: string | Tree };

export type FakeOptions = {
  locked?: readonly string[];
  permission?: { state: PermissionState; answer?: PermissionState };
  write?: { state: PermissionState; answer?: PermissionState };
  noMove?: boolean;
  failMove?: readonly string[];
};

/** Bij elke nagemaakte map: zijn boom (om erheen te verplaatsen). */
const trees = new WeakMap<object, Tree>();

const fail = (message: string, name: string) => new DOMException(message, name);

function fakeFile(name: string, parent: Tree, options: FakeOptions): FileEntryHandle {
  // De naam en de map veranderen bij verplaatsen, zoals bij een echt bestand.
  let current = name;
  let where = parent;
  const handle: FileEntryHandle = {
    kind: 'file',
    get name() {
      return current;
    },
    async getFile() {
      const value = where[current];
      if (typeof value !== 'string') throw fail('Niet gevonden', 'NotFoundError');
      return new File([value], current, { type: 'application/pdf' });
    },
  };
  if (!options.noMove) {
    handle.move = async (destination: FolderHandle, newName: string) => {
      if (options.failMove?.includes(current)) throw fail('Mislukt', 'InvalidStateError');
      const value = where[current];
      if (typeof value !== 'string') throw fail('Niet gevonden', 'NotFoundError');
      const target = trees.get(destination);
      if (!target) throw fail('Geen map', 'TypeMismatchError');
      if (newName in target) throw fail('Bestaat al', 'InvalidModificationError');
      delete where[current];
      target[newName] = value;
      where = target;
      current = newName;
    };
  }
  return handle;
}

export function fakeFolder(
  name: string,
  tree: Tree,
  options: FakeOptions = {},
  path = '',
): FolderHandle {
  const here = path ? `${path}/${name}` : name;
  const permission = options.permission;
  const handle: FolderHandle = {
    kind: 'directory',
    name,
    async getDirectoryHandle(child: string, opts?: { create?: boolean }) {
      let sub = tree[child];
      if (sub === undefined && opts?.create) sub = tree[child] = {};
      if (sub === undefined) throw fail('Niet gevonden', 'NotFoundError');
      if (typeof sub !== 'object') throw fail('Een bestand', 'TypeMismatchError');
      return fakeFolder(child, sub, options, here);
    },
    async getFileHandle(child: string) {
      const value = tree[child];
      if (value === undefined) throw fail('Niet gevonden', 'NotFoundError');
      if (typeof value !== 'string') throw fail('Een map', 'TypeMismatchError');
      return fakeFile(child, tree, options);
    },
    values() {
      if (options.locked?.includes(here)) {
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(fail('Geen toegang', 'NotAllowedError')),
          }),
        };
      }
      const entries = Object.entries(tree).map(([child, value]): FolderHandle | FileEntryHandle =>
        typeof value === 'string'
          ? fakeFile(child, tree, options)
          : fakeFolder(child, value, options, here),
      );
      return (async function* () {
        yield* entries;
      })();
    },
  };
  trees.set(handle, tree);
  if (permission || options.write) {
    const read = permission ?? { state: 'granted' as PermissionState };
    const pick = (mode: 'read' | 'readwrite') =>
      mode === 'readwrite' && options.write ? options.write : read;
    handle.queryPermission = async ({ mode }) => pick(mode).state;
    handle.requestPermission = async ({ mode }) => {
      const asked = pick(mode);
      if (asked.answer) asked.state = asked.answer;
      return asked.state;
    };
  }
  return handle;
}
