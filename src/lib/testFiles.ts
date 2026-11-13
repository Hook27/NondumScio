import { vi } from 'vitest';

/** Alleen voor tests: bestanden die de browser (even) niet kan lezen. */

/** De fout van de browser als een bestand niet gelezen kan worden. */
export const notReadable = () =>
  new DOMException('The requested file could not be read', 'NotReadableError');

/**
 * Laat `file` de eerste `failures` keer weigeren bij het inlezen (`arrayBuffer`), zoals de browser
 * bij een bestand dat even vergrendeld is; daarna leest hij gewoon. Met `Infinity` lukt het nooit.
 */
export function makeFlaky<T extends Blob>(file: T, failures: number) {
  const real = file.arrayBuffer.bind(file);
  let left = failures;
  const arrayBuffer = vi.fn(() => {
    if (left > 0) {
      left -= 1;
      return Promise.reject(notReadable());
    }
    return real();
  });
  Object.defineProperty(file, 'arrayBuffer', { value: arrayBuffer, configurable: true });
  return arrayBuffer;
}

/** Een PDF-bestand dat de eerste `failures` keer weigert. */
export function flakyFile(name: string, failures: number, content = '%PDF-1.7 inhoud') {
  const file = new File([content], name, { type: 'application/pdf' });
  return { file, arrayBuffer: makeFlaky(file, failures) };
}
