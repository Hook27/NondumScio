import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { memo } from '../lib/memo';
import { useStable } from '../lib/useStable';
import type { PageItem } from '../pages/plan';
import { PATTERN_IDS } from '../search/patterns';
import { MAX_CANDIDATES, type Candidate } from '../search/run';
import type { RedactSearch } from '../search/useRedactSearch';

/**
 * Zoeken en markeren bij Redigeren: zoektermen en patronen invullen, de treffers nalopen
 * (aanvinken wat weg moet) en er redactievakken van maken. Wat er gevonden is, staat ook als
 * oranje vakken op de pagina's (zie `AnnotatePage`); pas bij "Zet vakken" worden het echte vakken.
 */
export function RedactSearchPanel({
  search,
  pages,
}: {
  search: RedactSearch;
  pages: readonly PageItem[];
}) {
  const { t } = useI18n();
  const s = t.redact.search;
  const { form, phase, loading, candidates, summary, applied } = search;
  const running = phase.status === 'running';
  const chosen = candidates.filter((candidate) => candidate.checked).length;
  const pageCount = new Set(candidates.map((candidate) => candidate.page)).size;
  // De lijst tekent niet opnieuw als er alleen iets op de pagina's gebeurt (bijvoorbeeld slepen).
  const { toggle, focusOn } = useStable({
    toggle: (id: number) => search.toggle(id),
    focusOn: (id: number) => search.focusOn(id),
  });

  const togglePattern = (id: (typeof PATTERN_IDS)[number], on: boolean) =>
    search.setForm({
      patterns: on ? [...form.patterns, id] : form.patterns.filter((other) => other !== id),
    });

  return (
    <fieldset class="split-method annotate__options search">
      <legend class="split-method__legend">{s.legend}</legend>
      <div class="convert__field">
        <label for="search-terms" class="convert__label">
          {s.terms}
        </label>
        <textarea
          id="search-terms"
          class="merge-bookmark__input search__terms"
          rows={3}
          spellcheck={false}
          placeholder={s.termsPlaceholder}
          value={form.terms}
          onInput={(event) => search.setForm({ terms: event.currentTarget.value })}
        />
      </div>
      <fieldset class="search__patterns">
        <legend class="convert__label">{s.patterns}</legend>
        {PATTERN_IDS.map((id) => (
          <label key={id} class="merge-option">
            <input
              type="checkbox"
              checked={form.patterns.includes(id)}
              onChange={(event) => togglePattern(id, event.currentTarget.checked)}
            />
            {s[id]}
          </label>
        ))}
      </fieldset>
      <label class="merge-option">
        <input
          type="checkbox"
          checked={form.wholeWords}
          onChange={(event) => search.setForm({ wholeWords: event.currentTarget.checked })}
        />
        {s.wholeWords}
      </label>
      <label class="merge-option">
        <input
          type="checkbox"
          checked={form.ocr}
          onChange={(event) => search.setForm({ ocr: event.currentTarget.checked })}
        />
        {s.ocr}
      </label>
      {form.ocr && <p class="page-editor__status">{s.ocrHelp}</p>}
      <div class="annotate__row">
        <button
          type="button"
          class="button"
          disabled={!search.canSearch || running}
          onClick={search.run}
        >
          {running ? s.finding : s.find}
        </button>
        {running && (
          <button type="button" class="button button--secondary" onClick={search.stop}>
            {t.redact.stop}
          </button>
        )}
      </div>

      <div class="search__status" aria-live="polite">
        {phase.status === 'running' && (
          <p class="page-editor__status">
            {loading !== null
              ? format(t.redact.ocrLoading, { percent: Math.round(loading * 100) })
              : format(s.progress, { done: phase.done, total: phase.total })}
          </p>
        )}
        {phase.status === 'idle' && summary && (
          <>
            <p class="page-editor__status">
              {candidates.length === 0
                ? s.noHits
                : `${plural(candidates.length, s.hitsOne, format(s.hitsOther, { n: candidates.length }))} ${plural(
                    pageCount,
                    s.onPageOne,
                    format(s.onPagesOther, { n: pageCount }),
                  )}`}
            </p>
            {summary.covered > 0 && (
              <p class="page-editor__status">{format(s.covered, { n: summary.covered })}</p>
            )}
            {summary.skipped > 0 && (
              <p class="page-editor__status">
                {plural(
                  summary.skipped,
                  s.skippedOne,
                  format(s.skippedOther, { n: summary.skipped }),
                )}
              </p>
            )}
            {summary.recognized > 0 && (
              <p class="page-editor__status">
                {plural(
                  summary.recognized,
                  s.recognizedOne,
                  format(s.recognizedOther, { n: summary.recognized }),
                )}
              </p>
            )}
            {summary.capped && (
              <p class="page-editor__status">{format(s.capped, { max: MAX_CANDIDATES })}</p>
            )}
          </>
        )}
        {phase.status === 'idle' && applied !== null && candidates.length === 0 && (
          <p class="page-editor__status">
            {plural(applied, s.appliedOne, format(s.appliedOther, { n: applied }))}
          </p>
        )}
      </div>
      {phase.status === 'error' && (
        <p class="page-editor__error" role="alert">
          {s.errors[phase.code]}
        </p>
      )}

      {candidates.length > 0 && (
        <>
          <p class="annotate__hint">{s.check}</p>
          <div class="annotate__row">
            <button
              type="button"
              class="button button--secondary"
              onClick={() => search.setAll(true)}
            >
              {s.checkAll}
            </button>
            <button
              type="button"
              class="button button--secondary"
              onClick={() => search.setAll(false)}
            >
              {s.checkNone}
            </button>
          </div>
          <HitList candidates={candidates} pages={pages} toggle={toggle} focusOn={focusOn} />
          <div class="annotate__row">
            <button type="button" class="button" disabled={chosen === 0} onClick={search.apply}>
              {format(s.apply, { n: chosen })}
            </button>
            <button type="button" class="button button--secondary" onClick={search.clear}>
              {s.clear}
            </button>
          </div>
        </>
      )}
    </fieldset>
  );
}

/** De lijst met treffers; tekent alleen opnieuw als de treffers of de pagina's veranderen. */
const HitList = memo(function HitList({
  candidates,
  pages,
  toggle,
  focusOn,
}: {
  candidates: Candidate[];
  pages: readonly PageItem[];
  toggle: (id: number) => void;
  focusOn: (id: number) => void;
}) {
  const { t } = useI18n();
  const s = t.redact.search;
  const positions = new Map(pages.map((page, index) => [page.key, index + 1]));
  return (
    <ul class="search__hits" aria-label={s.list}>
      {candidates.map((candidate, index) => {
        const position = positions.get(candidate.page) ?? 0;
        return (
          <li key={candidate.id} class="search__hit">
            <input
              type="checkbox"
              checked={candidate.checked}
              aria-label={format(s.hitLabel, {
                n: index + 1,
                page: position,
                text: candidate.text,
              })}
              onChange={() => toggle(candidate.id)}
            />
            <button type="button" class="search__go" onClick={() => focusOn(candidate.id)}>
              <span class="search__page">{format(s.pageShort, { n: position })}</span>
              <span class="search__context">
                {candidate.before}
                <mark>{candidate.text}</mark>
                {candidate.after}
              </span>
              {candidate.viaOcr && <span class="search__tag">{s.viaOcr}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
});
