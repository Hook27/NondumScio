import { useEffect, useRef, useState } from 'preact/hooks';
import type { Source } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatRanges, parseRanges, type RangeProblem } from '../pages/ranges';
import { Thumbnail } from './Thumbnail';

/**
 * Per bestand kiezen welke pagina's meedoen: met een bereik ("1-3, 5") of, uitgeklapt, met
 * een vinkje per miniatuur. Beide werken op hetzelfde pagina-plan als Pagina's.
 */
export function MergePages({
  source,
  chosen,
  rotations,
  onChange,
}: {
  source: Source;
  /** De paginanummers (vanaf 0) van dit bestand die nu in het plan staan. */
  chosen: ReadonlySet<number>;
  /** Extra draaiing per paginanummer, zodat de miniaturen kloppen met Pagina's. */
  rotations: ReadonlyMap<number, number>;
  onChange: (sources: ReadonlySet<number>) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = `merge-pick-${source.id}`;

  return (
    <div class="merge-pages">
      <div class="merge-pages__bar">
        <RangeField source={source} chosen={chosen} onChange={onChange} />
        <button
          type="button"
          class="button button--secondary"
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={`${open ? t.merge.hidePages : t.merge.showPages}: ${source.name}`}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? t.merge.hidePages : t.merge.showPages}
        </button>
      </div>
      {open && (
        <fieldset id={panelId} class="merge-pick">
          <legend class="visually-hidden">{format(t.merge.pick, { name: source.name })}</legend>
          {Array.from({ length: source.pageCount }, (_, i) => {
            const checked = chosen.has(i);
            // De laatste pagina van een bestand blijft staan; het hele bestand weghalen gaat met ✕.
            const last = checked && chosen.size === 1;
            return (
              <label key={i} class={`merge-pick__page${checked ? '' : ' merge-pick__page--off'}`}>
                <input
                  type="checkbox"
                  class="merge-pick__check"
                  checked={checked}
                  disabled={last}
                  title={last ? t.merge.keepPage : undefined}
                  onChange={() => {
                    const next = new Set(chosen);
                    if (checked) next.delete(i);
                    else next.add(i);
                    onChange(next);
                  }}
                />
                <Thumbnail
                  pdf={source.pdf}
                  pageNumber={i + 1}
                  rotation={rotations.get(i) ?? 0}
                  label={format(t.document.page, { n: i + 1 })}
                  decorative
                />
                <span class="visually-hidden">{format(t.document.page, { n: i + 1 })}</span>
              </label>
            );
          })}
        </fieldset>
      )}
    </div>
  );
}

/** Het bereikveld: toepassen met Enter of door het veld te verlaten, Escape zet het terug. */
function RangeField({
  source,
  chosen,
  onChange,
}: {
  source: Source;
  chosen: ReadonlySet<number>;
  onChange: (sources: ReadonlySet<number>) => void;
}) {
  const { t } = useI18n();
  const current = formatRanges([...chosen].map((i) => i + 1));
  const [draft, setDraft] = useState(current);
  const [problem, setProblem] = useState<RangeProblem | null>(null);
  const fieldId = `merge-range-${source.id}`;
  const errorId = `${fieldId}-error`;

  // Verandert de keuze ergens anders (vinkjes, ongedaan maken, Pagina's), dan volgt het veld.
  // Alleen bij een echte verandering: een laat uitgevoerd effect mag wat je typt niet wissen.
  const synced = useRef(current);
  useEffect(() => {
    if (synced.current === current) return;
    synced.current = current;
    setDraft(current);
    setProblem(null);
  }, [current]);

  const apply = () => {
    if (draft.trim() === current) {
      setDraft(current);
      setProblem(null);
      return;
    }
    const result = parseRanges(draft, source.pageCount);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    setProblem(null);
    const next = formatRanges(result.pages);
    setDraft(next);
    if (next !== current) onChange(new Set(result.pages.map((page) => page - 1)));
  };

  const message = (error: RangeProblem) => {
    if (error.code === 'empty') return t.merge.rangeErrors.empty;
    if (error.code === 'invalid') return format(t.merge.rangeErrors.invalid, { part: error.part });
    const text = plural(
      source.pageCount,
      t.merge.rangeErrors.outOfRangeOne,
      t.merge.rangeErrors.outOfRangeOther,
    );
    return format(text, { page: error.page });
  };

  return (
    <div class="merge-range">
      <label for={fieldId} class="merge-range__label">
        {t.merge.pagesLabel}
        <span class="visually-hidden"> {format(t.merge.pagesOfFile, { name: source.name })}</span>
      </label>
      <input
        id={fieldId}
        class="merge-range__input"
        type="text"
        autocomplete="off"
        spellcheck={false}
        value={draft}
        aria-invalid={problem !== null}
        aria-describedby={problem ? errorId : undefined}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onBlur={apply}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            apply();
          } else if (event.key === 'Escape') {
            setDraft(current);
            setProblem(null);
          }
        }}
      />
      {problem && (
        <p id={errorId} class="merge-range__error" role="alert">
          {message(problem)}
        </p>
      )}
    </div>
  );
}
