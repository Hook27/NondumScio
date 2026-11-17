import { useState } from 'preact/hooks';
import { useI18n } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import type { RedactionRun } from '../pdf/save';

/**
 * Tijdens het opslaan: wat er gebeurt (met de voortgang als die er is) en de knop Stoppen. Overal
 * hetzelfde: Pagina's, Samenvoegen, Bewerken, Redigeren, Splitsen, Omzetten en samenvoegen bij
 * Slim hernoemen. Na Stoppen staat er "Bezig met stoppen…" tot het werk echt stil ligt.
 */
export function SaveBusy({ text, onStop }: { text: string; onStop: () => void }) {
  const { t } = useI18n();
  const [stopping, setStopping] = useState(false);
  return (
    <div class="save-busy">
      <p class="page-editor__status" aria-live="polite">
        {stopping ? t.pages.stopping : text}
      </p>
      {!stopping && (
        <button
          type="button"
          class="button button--secondary"
          onClick={() => {
            setStopping(true);
            onStop();
          }}
        >
          {t.pages.stop}
        </button>
      )}
    </div>
  );
}

/** Na Stoppen: gewone tekst, geen fout of waarschuwing (je koos er zelf voor). */
export function SaveStopped() {
  const { t } = useI18n();
  return (
    <p class="page-editor__status" role="status">
      {t.pages.stopped}
    </p>
  );
}

/**
 * De voortgang van het redigeren (en het laden van de tekstherkenning) voor `SaveBusy`. `start()`
 * bij het begin van een opslag wist de vorige voortgang en geeft wat met de redactie meegaat;
 * `text` is wat er nu gebeurt (of null).
 */
export function useRedactionProgress() {
  const { t } = useI18n();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [ocr, setOcr] = useState<number | null>(null);
  const start = (): Pick<RedactionRun, 'onProgress' | 'onOcrStatus'> => {
    setProgress(null);
    setOcr(null);
    return {
      onProgress: (done, total) => {
        setOcr(null);
        setProgress({ done, total });
      },
      onOcrStatus: setOcr,
    };
  };
  const text =
    ocr !== null
      ? format(t.redact.ocrLoading, { percent: Math.round(ocr * 100) })
      : progress
        ? format(t.redact.progress, progress)
        : null;
  return { start, text };
}
