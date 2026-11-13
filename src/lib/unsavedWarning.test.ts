// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setUnsavedWork, unsavedSources } from './unsavedWarning';

/** Of het sluiten van het tabblad nu een waarschuwing geeft. */
function warns() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  for (const source of unsavedSources()) setUnsavedWork(source, false);
});

describe('de waarschuwing bij het sluiten van het tabblad', () => {
  it('staat aan zolang er ergens werk is, en uit als alles gedownload is', () => {
    expect(warns()).toBe(false);
    setUnsavedWork('triage', true);
    expect(warns()).toBe(true);
    setUnsavedWork('text', true);
    setUnsavedWork('triage', false);
    // Platte tekst heeft nog werk.
    expect(warns()).toBe(true);
    setUnsavedWork('text', false);
    expect(warns()).toBe(false);
  });

  it('gebruikt één luisteraar, hoeveel onderdelen ook werk hebben', () => {
    const add = vi.spyOn(window, 'addEventListener');
    setUnsavedWork('a', true);
    setUnsavedWork('b', true);
    setUnsavedWork('a', true);
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1);
    add.mockRestore();
  });
});
