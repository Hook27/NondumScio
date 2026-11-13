// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { guardFileDrops } from './dropGuard';

/** Een sleep-gebeurtenis zoals de browser die geeft (jsdom kent `DragEvent` niet). */
function dragEvent(type: 'dragover' | 'drop', kinds: string[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const dataTransfer = { types: kinds, dropEffect: 'copy' };
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return { event, dataTransfer };
}

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  document.body.innerHTML = '';
});

describe('een bestand naast een sleepvak loslaten', () => {
  it('wordt tegengehouden: de browser opent het niet in het tabblad', () => {
    stop = guardFileDrops(window);
    const over = dragEvent('dragover', ['Files']);
    document.body.dispatchEvent(over.event);
    expect(over.event.defaultPrevented).toBe(true);
    // De muisaanwijzer toont "niet toegestaan".
    expect(over.dataTransfer.dropEffect).toBe('none');
    const drop = dragEvent('drop', ['Files']);
    document.body.dispatchEvent(drop.event);
    expect(drop.event.defaultPrevented).toBe(true);
  });

  it('een sleepvak dat het bestand zelf opvangt, houdt zijn eigen afhandeling', () => {
    stop = guardFileDrops(window);
    const zone = document.createElement('section');
    document.body.append(zone);
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      (event as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer.dropEffect =
        'copy';
    });
    const over = dragEvent('dragover', ['Files']);
    zone.dispatchEvent(over.event);
    expect(over.dataTransfer.dropEffect).toBe('copy');
  });

  it('slepen zonder bestanden (zoals tekst) gaat gewoon zijn gang', () => {
    stop = guardFileDrops(window);
    const over = dragEvent('dragover', ['text/plain']);
    document.body.dispatchEvent(over.event);
    expect(over.event.defaultPrevented).toBe(false);
  });

  it('is weer uit te zetten', () => {
    guardFileDrops(window)();
    const drop = dragEvent('drop', ['Files']);
    document.body.dispatchEvent(drop.event);
    expect(drop.event.defaultPrevented).toBe(false);
  });
});
