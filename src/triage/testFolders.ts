import type { FileEntryHandle, FolderHandle } from './folders';

/**
 * Een nagemaakte map voor de tests, zoals de mappen-toegang van de browser hem geeft. Beschrijf
 * hem als een boom: een bestand is een tekst (de inhoud), een map een object. De volgorde in de
 * boom is de volgorde waarin de map zijn inhoud geeft (niet gesorteerd, zoals op een echte schijf).
 * Met `locked` geeft die map een fout bij het lezen; met `permission` vraagt hij om toestemming.
 */
export type Tree = { [name: string]: string | Tree };

export type FakeOptions = {
  locked?: readonly string[];
  permission?: { state: PermissionState; answer?: PermissionState };
};

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
    async getDirectoryHandle(child: string) {
      const sub = tree[child];
      if (typeof sub !== 'object') throw new DOMException('Niet gevonden', 'NotFoundError');
      return fakeFolder(child, sub, options, here);
    },
    values() {
      if (options.locked?.includes(here)) {
        return {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(new DOMException('Geen toegang', 'NotAllowedError')),
          }),
        };
      }
      const entries = Object.entries(tree).map(([child, value]): FolderHandle | FileEntryHandle =>
        typeof value === 'string'
          ? {
              kind: 'file',
              name: child,
              getFile: async () => new File([value], child, { type: 'application/pdf' }),
            }
          : fakeFolder(child, value, options, here),
      );
      return (async function* () {
        yield* entries;
      })();
    },
  };
  if (permission) {
    handle.queryPermission = async () => permission.state;
    handle.requestPermission = async () => {
      if (permission.answer) permission.state = permission.answer;
      return permission.state;
    };
  }
  return handle;
}
