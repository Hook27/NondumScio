// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { SaveBusy, SaveStopped, useRedactionProgress } from './SaveBusy';

const nl = messages.nl;

afterEach(() => cleanup());

describe('SaveBusy', () => {
  it('toont wat er gebeurt met Stoppen; na een klik "Bezig met stoppen…" zonder knop', () => {
    const onStop = vi.fn();
    render(
      <LanguageProvider initial="nl">
        <SaveBusy text="Bezig: 2 van 5 delen…" onStop={onStop} />
      </LanguageProvider>,
    );
    expect(screen.getByText('Bezig: 2 van 5 delen…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: nl.pages.stop }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.getByText(nl.pages.stopping)).toBeTruthy();
    // Geen tweede keer stoppen.
    expect(screen.queryByRole('button', { name: nl.pages.stop })).toBeNull();
  });

  it('Gestopt: gewone tekst, geen melding als fout', () => {
    render(
      <LanguageProvider initial="nl">
        <SaveStopped />
      </LanguageProvider>,
    );
    const stopped = screen.getByRole('status');
    expect(stopped.textContent).toBe(nl.pages.stopped);
    expect(stopped.classList.contains('page-editor__status')).toBe(true);
  });
});

describe('useRedactionProgress', () => {
  function setup() {
    let api: ReturnType<typeof useRedactionProgress> | null = null;
    function Probe() {
      api = useRedactionProgress();
      return null;
    }
    render(
      <LanguageProvider initial="nl">
        <Probe />
      </LanguageProvider>,
    );
    return () => api!;
  }

  it('eerst het laden van de tekstherkenning (ook bij 0 %), dan de pagina’s; start wist het', () => {
    const progress = setup();
    expect(progress().text).toBeNull();
    let run = progress().start();
    act(() => run.onOcrStatus!(0));
    expect(progress().text).toBe(format(nl.redact.ocrLoading, { percent: 0 }));
    act(() => run.onOcrStatus!(0.42));
    expect(progress().text).toBe(format(nl.redact.ocrLoading, { percent: 42 }));
    act(() => run.onProgress!(2, 7));
    expect(progress().text).toBe(format(nl.redact.progress, { done: 2, total: 7 }));
    // Een volgende opslag begint zonder de voortgang van de vorige.
    act(() => {
      run = progress().start();
    });
    expect(progress().text).toBeNull();
  });
});
