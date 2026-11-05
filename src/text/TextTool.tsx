import { useState } from 'preact/hooks';
import { GAP_FACTOR } from '../compare/layout';
import { copyText } from '../compare/report';
import { Dropzone } from '../components/Dropzone';
import { PaneHead } from '../components/WorkspaceParts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatFileSize } from '../lib/format';
import { downloadFile } from '../pdf/save';
import { exportName, quality, type Extraction, type TextOptions } from './extract';
import { clearText, openFiles, setOptions, useTextState, type TextDoc } from './store';

type Texts = ReturnType<typeof useI18n>['t'];

/**
 * PDF → Platte tekst: een PDF openen en de tekst eruit halen, om te kopiëren of als tekstbestand te
 * downloaden. Werkt los van de gewone taken; de stand staat buiten het scherm (`store.ts`).
 * Overgenomen uit de losse pdf-tekst-extractor; bewuste afwijkingen: er is geen knop "Tekst
 * extraheren" (de tekst staat er zodra de PDF gelezen is, en verandert meteen bij elke andere
 * instelling, zoals bij PDF's vergelijken), terugkerende kop- en voetteksten gaan er standaard uit,
 * de alinea-gevoeligheid staat standaard op 1,3 (zie `DEFAULT_TEXT_OPTIONS`), en de tekst is niet
 * te bewerken in het scherm.
 */
export function TextTool() {
  const { t } = useI18n();
  const p = t.plainText;
  const { slot, result, tooMany } = useTextState();
  // Wat er met de tekst gebeurd is (gekopieerd, gedownload), bij welke tekst: bij een andere tekst
  // hoort de melding er niet meer bij. (Geen effect om hem te wissen, zie PDF's vergelijken.)
  const [status, setStatus] = useState<{ result: Extraction | null; text: string } | null>(null);
  const shown = status && status.result === result ? status.text : null;
  const ready = slot.status === 'ready' && result !== null && result.text !== '';
  const name = slot.status === 'ready' ? slot.doc.file.name : '';

  return (
    <section class="workspace plaintext" aria-label={p.toolbar}>
      <div class="workspace__tools">
        <SlotView />
        {tooMany && (
          <p class="compare__note" role="status">
            {p.tooMany}
          </p>
        )}
        <div class="toolbar toolbar--tools" role="toolbar" aria-label={p.toolbar}>
          <div class="toolbar__group toolbar__group--wide">
            <button
              type="button"
              class="button button--secondary"
              disabled={!ready}
              onClick={() =>
                void copyText(result!.text).then((ok) =>
                  setStatus({ result, text: ok ? p.copied : p.copyFailed }),
                )
              }
            >
              {p.copy}
            </button>
            <button
              type="button"
              class="button button--secondary"
              disabled={!ready}
              onClick={() => {
                const file = exportName(name);
                downloadFile(
                  new TextEncoder().encode(result!.text),
                  file,
                  'text/plain;charset=utf-8',
                );
                setStatus({ result, text: format(p.downloaded, { name: file }) });
              }}
            >
              {p.download}
            </button>
          </div>
          <div class="toolbar__group toolbar__group--wide">
            <button
              type="button"
              class="button button--secondary"
              disabled={slot.status === 'empty'}
              onClick={clearText}
            >
              {p.clear}
            </button>
          </div>
        </div>
        {shown && (
          <p class="page-editor__saved" role="status">
            {shown}
          </p>
        )}
        <Settings />
        <p class="annotate__hint">{p.about}</p>
      </div>
      <div class="workspace__view" data-scroll-root>
        <Output />
      </div>
    </section>
  );
}

/** De PDF: kiezen of slepen, en wat er gelezen is. */
function SlotView() {
  const { t, language } = useI18n();
  const p = t.plainText;
  const c = t.compare;
  const { slot } = useTextState();
  const doc = slot.status === 'ready' ? slot.doc : null;
  return (
    <Dropzone
      title={p.slot.title}
      dropTitle={c.dropHere}
      hint={
        slot.status === 'empty'
          ? p.slot.hint
          : slot.status === 'ready'
            ? slot.doc.file.name
            : slot.name
      }
      inputId="plaintext-file"
      accept="application/pdf,.pdf"
      chooseLabel={slot.status === 'empty' ? p.slot.choose : p.slot.replace}
      onFiles={(files) => void openFiles(files)}
      extraClass={`compare-slot${doc?.thumb ? ' compare-slot--thumb' : ''}`}
    >
      {slot.status === 'reading' && (
        <p class="compare-slot__meta" role="status">
          {slot.total > 0 ? format(c.reading, { n: slot.done, total: slot.total }) : c.readingStart}
        </p>
      )}
      {slot.status === 'error' && (
        <p class="compare-slot__meta dropzone__error" role="alert">
          {c.errors[slot.code]}
        </p>
      )}
      {doc && <p class="compare-slot__meta">{docMeta(doc, t, language)}</p>}
      {doc?.thumb && <img class="compare-slot__thumb" src={doc.thumb} alt="" />}
    </Dropzone>
  );
}

/** "3 pagina's · 12 KB", met het aantal pagina's zonder tekstlaag als dat er zijn. */
function docMeta(doc: TextDoc, t: Texts, language: string) {
  const c = t.compare;
  const noText = doc.pages.filter((page) => page.items.length === 0).length;
  return [
    plural(doc.pageCount, c.pagesOne, c.pages),
    formatFileSize(doc.file.size, language),
    noText > 0 && plural(noText, c.noTextOne, c.noText),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** De aan- en uitzetters; alleen "regels samenvoegen" heeft een eigen plek, bij de gevoeligheid. */
const TOGGLES = ['strip', 'columns', 'dehyphen'] as const satisfies readonly (keyof TextOptions)[];

/** Hoe de tekst wordt opgebouwd; elke instelling werkt meteen. */
function Settings() {
  const { t, language } = useI18n();
  const s = t.plainText.settings;
  const { options } = useTextState();
  // Tijdens het slepen alleen het getal bijwerken; pas bij loslaten opnieuw opbouwen.
  const [dragging, setDragging] = useState<number | null>(null);
  const gap = dragging ?? options.gapFactor;
  return (
    <fieldset class="compare-settings">
      <legend>{s.title}</legend>
      <label class="compare-settings__check">
        <input
          type="checkbox"
          checked={options.joinLines}
          onChange={(event) => setOptions({ joinLines: event.currentTarget.checked })}
        />
        {s.joinLines}
      </label>
      <div class="compare-settings__range plaintext__gap">
        <label for="plaintext-gap">{s.gap}</label>
        <input
          id="plaintext-gap"
          type="range"
          min={GAP_FACTOR.min}
          max={GAP_FACTOR.max}
          step={GAP_FACTOR.step}
          value={gap}
          disabled={!options.joinLines}
          aria-describedby="plaintext-gap-hint"
          onInput={(event) => setDragging(Number(event.currentTarget.value))}
          onChange={(event) => {
            setDragging(null);
            setOptions({ gapFactor: Number(event.currentTarget.value) });
          }}
        />
        <output for="plaintext-gap">
          {gap.toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
        </output>
      </div>
      <p id="plaintext-gap-hint" class="compare-settings__hint">
        {s.gapHint}
      </p>
      {TOGGLES.map((key) => (
        <label key={key} class="compare-settings__check">
          <input
            type="checkbox"
            checked={options[key]}
            onChange={(event) => setOptions({ [key]: event.currentTarget.checked })}
          />
          {s[key]}
        </label>
      ))}
    </fieldset>
  );
}

/** "pagina 3" of "pagina's 3, 5 en 7". */
function pageList(pages: readonly number[], t: Texts) {
  const p = t.plainText;
  if (pages.length === 1) return format(p.pageOne, { n: pages[0]! });
  const list = `${pages.slice(0, -1).join(', ')}${p.and}${pages[pages.length - 1]!}`;
  return format(p.pageMany, { list });
}

/** Het rechtervak: de tekst, met wat er opvalt aan de tekstlaag. */
function Output() {
  const { t, language } = useI18n();
  const p = t.plainText;
  const c = t.compare;
  const { slot, result } = useTextState();
  if (slot.status !== 'ready' || !result) {
    return (
      <>
        <PaneHead title={p.title} />
        <p class="compare__placeholder">
          {slot.status === 'reading' ? c.readingStart : p.placeholder}
        </p>
      </>
    );
  }
  const q = quality(result.pages);
  const chars = result.text.length;
  const meta = [
    format(p.meta, {
      chars: format(chars === 1 ? c.charsOne : c.chars, { n: chars.toLocaleString(language) }),
      read: q.read,
      pages: plural(slot.doc.pageCount, c.pagesOne, c.pages),
    }),
    q.read > 0 && format(p.average, { n: q.average.toLocaleString(language) }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <PaneHead title={p.title} meta={meta} />
      {q.noText.length > 0 && (
        <p class="compare__warning">{format(p.noTextPages, { list: pageList(q.noText, t) })}</p>
      )}
      {q.low.length > 0 && (
        <p class="compare__warning">{format(p.lowPages, { list: pageList(q.low, t) })}</p>
      )}
      {result.text === '' ? (
        <p class="compare__placeholder">{p.empty}</p>
      ) : (
        <pre class="plaintext__output">{result.text}</pre>
      )}
    </>
  );
}
