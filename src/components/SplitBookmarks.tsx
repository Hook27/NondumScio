import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import {
  autoName,
  bookmarkParts,
  duplicateNames,
  fileNameOf,
  flattenMarks,
  maxDepth,
  zipPath,
  type Mark,
  type Part,
} from '../split/bookmarks';
import { defaultBookmarkTitle } from './FilesParts';
import { IconButton } from './Icon';
import { useOutlines } from './OutlinePanel';

/*
 * Splitsen op bladwijzers (alleen op de computer), zoals de losse tool "PDF → Splitsen op
 * bladwijzers": de bladwijzers bepalen de delen, je vinkt aan wat meegaat en past zo nodig de
 * namen aan, en downloadt de delen als ZIP of per stuk. Het rekenwerk staat in `split/bookmarks.ts`.
 */

/** Een rij van de tabel: een deel met wat je ervan gekozen hebt. */
export type BookmarkRow = Part & {
  include: boolean;
  /** De naam in het veld: zelf aangepast, of voorgesteld. */
  name: string;
  /** Waaronder het deel wordt opgeslagen (de naam opgeschoond, met .pdf). */
  fileName: string;
  /** Het pad in de ZIP: de naam, zo nodig in de map van de hoofdbladwijzer. */
  path: string;
  /** Een ander deel dat meegaat, heeft hetzelfde pad in de ZIP. */
  duplicate: boolean;
  /** De pagina's van het deel: plekken in het plan, vanaf 1. */
  positions: number[];
};

type Choice = { key: string; include: boolean[]; names: (string | null)[] };

/**
 * De delen volgens de bladwijzers van de geopende bestanden, met wat je hebt aan- of uitgevinkt en
 * welke namen je hebt aangepast. Verandert het niveau, de grenspagina of het pagina-plan, dan
 * begint de keuze opnieuw (alles aan, voorgestelde namen); een ander voorvoegsel past alleen de
 * namen aan die je niet zelf hebt veranderd. Met `folders` komt elk deel in de ZIP in de map van
 * zijn hoofdbladwijzer; dat verandert niets aan de keuze.
 */
export function useBookmarkSplit(
  level: number,
  overlap: boolean,
  prefix: string,
  folders: boolean,
) {
  const { pages, activeSources } = useDocument();
  const { t } = useI18n();
  const s = t.split;
  const outlines = useOutlines(activeSources);
  const loaded = activeSources.every((source) => outlines.has(source.id));

  const { marks, parts } = useMemo(() => {
    const marks = flattenMarks(
      activeSources.map((source) => ({ doc: source.id, entries: outlines.get(source.id) ?? [] })),
      pages,
      s.untitled,
    );
    const fileTitles = new Map(
      activeSources.map((source) => [source.id, defaultBookmarkTitle(source.name)]),
    );
    const parts = bookmarkParts(marks, pages, {
      level,
      overlap,
      frontMatter: s.frontMatter,
      fileTitles,
    });
    return { marks, parts };
  }, [outlines, pages, activeSources, level, overlap, s]);

  const key = `${level}|${overlap}|${parts.map((p) => `${p.from}-${p.to}:${p.title}`).join('|')}`;
  const fresh = (): Choice => ({
    key,
    include: parts.map(() => true),
    names: parts.map(() => null),
  });
  const [stored, setStored] = useState<Choice>({ key: '', include: [], names: [] });
  const choice = stored.key === key ? stored : fresh();
  const change = (update: (current: Choice) => Choice) =>
    setStored((previous) => update(previous.key === key ? previous : fresh()));

  const fallback = s.untitledFile;
  const named = parts.map((part, index) => {
    const name = choice.names[index] ?? autoName(part.title, index, parts.length, prefix, fallback);
    const fileName = fileNameOf(name, fallback);
    const path = zipPath(fileName, part.top, folders, fallback);
    return { name, fileName, path, include: choice.include[index]! };
  });
  // Dubbel is hetzelfde pad: dezelfde naam in een andere map mag.
  const duplicates = duplicateNames(named.map((row) => (row.include ? row.path : null)));
  const rows: BookmarkRow[] = parts.map((part, index) => ({
    ...part,
    ...named[index]!,
    duplicate: duplicates.has(index),
    positions: Array.from({ length: part.to - part.from + 1 }, (_, i) => part.from + i + 1),
  }));

  return {
    loaded,
    marks,
    rows,
    setInclude: (index: number, include: boolean) =>
      change((current) => ({
        ...current,
        include: current.include.map((on, i) => (i === index ? include : on)),
      })),
    setAll: (include: boolean) =>
      change((current) => ({ ...current, include: current.include.map(() => include) })),
    setName: (index: number, name: string) =>
      change((current) => ({
        ...current,
        names: current.names.map((old, i) => (i === index ? name : old)),
      })),
  };
}

export type BookmarkSplit = ReturnType<typeof useBookmarkSplit>;

/** Het niveau, de grenspagina, het voorvoegsel en de indeling van de ZIP, onder "Op bladwijzers". */
export function BookmarkOptions({
  marks,
  disabled,
  level,
  overlap,
  prefix,
  folders,
  onLevel,
  onOverlap,
  onPrefix,
  onFolders,
}: {
  marks: readonly Mark[];
  disabled: boolean;
  level: number;
  overlap: boolean;
  prefix: string;
  folders: boolean;
  onLevel: (level: number) => void;
  onOverlap: (overlap: boolean) => void;
  onPrefix: (prefix: string) => void;
  onFolders: (folders: boolean) => void;
}) {
  const { t } = useI18n();
  const s = t.split;
  const depth = maxDepth(marks);
  const levels = Array.from({ length: Math.max(0, depth - 1) }, (_, i) => i + 1);
  return (
    <>
      <div class="split-method__field">
        <label for="split-level">{s.level}</label>
        <select
          id="split-level"
          class="split-method__select"
          value={String(level)}
          disabled={disabled}
          onChange={(event) => onLevel(Number(event.currentTarget.value))}
        >
          <option value="0">{s.levelAll}</option>
          {levels.map((n) => (
            <option key={n} value={String(n)}>
              {n === 1 ? s.levelOne : format(s.levelUpTo, { n })}
            </option>
          ))}
        </select>
      </div>
      <div class="split-method__field">
        <label class="split-method__check">
          <input
            type="checkbox"
            checked={overlap}
            disabled={disabled}
            onChange={(event) => onOverlap(event.currentTarget.checked)}
          />
          {s.overlap}
        </label>
      </div>
      <div class="split-method__field">
        <label for="split-prefix">{s.prefix}</label>
        <input
          id="split-prefix"
          class="split-method__prefix"
          type="text"
          autocomplete="off"
          spellcheck={false}
          value={prefix}
          disabled={disabled}
          onInput={(event) => onPrefix(event.currentTarget.value)}
        />
      </div>
      <div class="split-method__field">
        <label for="split-zip">{s.zipLayout}</label>
        <select
          id="split-zip"
          class="split-method__select"
          value={folders ? 'folders' : 'flat'}
          disabled={disabled}
          onChange={(event) => onFolders(event.currentTarget.value === 'folders')}
        >
          <option value="flat">{s.zipFlat}</option>
          <option value="folders">{s.zipFolders}</option>
        </select>
      </div>
    </>
  );
}

/** Wat er te zeggen valt over de bladwijzers: nog aan het lezen, geen bruikbare, overgeslagen, of "ook". */
export function BookmarkNotes({ split }: { split: BookmarkSplit }) {
  const { t } = useI18n();
  const s = t.split;
  const { loaded, marks, rows } = split;
  if (!loaded) return <p class="split-note">{s.reading}</p>;
  if (rows.length === 0) return <p class="split-note split-note--error">{s.noBookmarks}</p>;
  const skipped = marks.filter((mark) => mark.position === null);
  const shared = rows.filter((row) => row.also.length > 0).length;
  const titles =
    skipped
      .slice(0, 5)
      .map((mark) => mark.title)
      .join(' · ') + (skipped.length > 5 ? ' …' : '');
  return (
    <>
      {skipped.length > 0 && (
        <p class="split-note">
          {format(plural(skipped.length, s.skippedOne, s.skippedOther), { titles })}
        </p>
      )}
      {shared > 0 && <p class="split-note">{plural(shared, s.sharedOne, s.sharedOther)}</p>}
    </>
  );
}

/** De samenvatting boven de tabel: pagina's · bladwijzers · niveaus → wat er geselecteerd is. */
export function bookmarkSummary(
  t: ReturnType<typeof useI18n>['t'],
  pageCount: number,
  split: BookmarkSplit,
): string {
  const s = t.split;
  const depth = maxDepth(split.marks);
  const chosen = split.rows.filter((row) => row.include);
  const chosenPages = chosen.reduce((sum, row) => sum + row.positions.length, 0);
  return [
    plural(pageCount, s.summaryPagesOne, s.summaryPagesOther),
    plural(split.marks.length, s.marksOne, s.marksOther),
    ...(depth > 0 ? [plural(depth, s.levelsOne, s.levelsOther)] : []),
  ]
    .join(' · ')
    .concat(
      ` → ${format(s.selected, {
        n: chosen.length,
        total: split.rows.length,
        pages: plural(chosenPages, s.summaryPagesOne, s.summaryPagesOther),
      })}`,
    );
}

/** Een bereik zoals in de tabel: "4" of "4–10". */
const rangeText = (row: Part) =>
  row.from === row.to ? String(row.from + 1) : `${row.from + 1}–${row.to + 1}`;

/**
 * De tabel met de delen: aan- of uitvinken, de naam aanpassen, bekijken en los downloaden. Een
 * eigen raster (met de rollen van een tabel), zodat een rij in een smal vak over twee regels kan:
 * de naam dan onder de bladwijzer.
 */
export function BookmarkTable({
  split,
  busy,
  onView,
  onDownload,
}: {
  split: BookmarkSplit;
  busy: boolean;
  onView: (index: number) => void;
  onDownload: (index: number) => void;
}) {
  const { t } = useI18n();
  const s = t.split;
  const c = s.table;
  const { rows } = split;
  const chosen = rows.filter((row) => row.include).length;
  const head = useRef<HTMLDivElement>(null);
  // De kop van het rechtervak blijft bovenaan staan; de kolomkoppen eronder. Die kop kan over
  // twee regels gaan, dus meten.
  useLayoutEffect(() => {
    const element = head.current;
    const pane = element?.closest('.workspace__view')?.querySelector<HTMLElement>('.pane-head');
    if (!element || !pane || typeof ResizeObserver !== 'function') return;
    const update = () => element.style.setProperty('--head-top', `${pane.offsetHeight - 4}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(pane);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      {/* Buiten de tabel: daarin horen alleen rijen. */}
      <span id="split-duplicate" class="visually-hidden">
        {s.duplicate}
      </span>
      <div class="bookmark-table" role="table" aria-label={c.label}>
        <div ref={head} class="bookmark-table__head" role="rowgroup">
          <div class="bookmark-table__row" role="row">
            <span class="bookmark-table__check" role="columnheader">
              <input
                type="checkbox"
                aria-label={c.all}
                checked={chosen === rows.length}
                ref={(element) => {
                  if (element) element.indeterminate = chosen > 0 && chosen < rows.length;
                }}
                onChange={(event) => split.setAll(event.currentTarget.checked)}
              />
            </span>
            <span class="bookmark-table__num" role="columnheader">
              {c.number}
            </span>
            <span class="bookmark-table__title" role="columnheader">
              {c.title}
            </span>
            <span class="bookmark-table__pages" role="columnheader">
              {c.pages}
            </span>
            <span class="bookmark-table__count" role="columnheader">
              {c.count}
            </span>
            <span class="bookmark-table__name" role="columnheader">
              {c.name}
            </span>
            <span class="bookmark-table__actions" role="columnheader">
              <span class="visually-hidden">{c.actions}</span>
            </span>
          </div>
        </div>
        <div role="rowgroup">
          {rows.map((row, index) => {
            const n = index + 1;
            return (
              <div
                key={`${index}-${row.from}-${row.to}`}
                class={`bookmark-table__row${row.include ? '' : ' bookmark-table__row--off'}`}
                role="row"
              >
                <span class="bookmark-table__check" role="cell">
                  <input
                    type="checkbox"
                    aria-label={format(s.include, { n, title: row.title })}
                    checked={row.include}
                    onChange={(event) => split.setInclude(index, event.currentTarget.checked)}
                  />
                </span>
                <span class="bookmark-table__num" role="cell">
                  {n}
                </span>
                <span class="bookmark-table__title" role="cell" style={`--depth: ${row.depth - 1}`}>
                  {row.title}
                  {row.also.length > 0 && (
                    <span class="bookmark-table__also">
                      {format(s.also, { titles: row.also.join(' · ') })}
                    </span>
                  )}
                </span>
                <span class="bookmark-table__pages" role="cell">
                  {rangeText(row)}
                </span>
                <span class="bookmark-table__count" role="cell">
                  {row.positions.length}
                </span>
                <span class="bookmark-table__name" role="cell">
                  <input
                    type="text"
                    class={row.duplicate ? 'is-duplicate' : undefined}
                    aria-label={format(s.nameLabel, { n })}
                    aria-describedby={row.duplicate ? 'split-duplicate' : undefined}
                    spellcheck={false}
                    autocomplete="off"
                    value={row.name}
                    onInput={(event) => split.setName(index, event.currentTarget.value)}
                  />
                </span>
                <span class="bookmark-table__actions" role="cell">
                  <button
                    type="button"
                    class="button button--secondary bookmark-table__view"
                    aria-label={format(s.viewPart, { n })}
                    onClick={() => onView(index)}
                  >
                    {s.view}
                  </button>
                  <IconButton
                    icon="download"
                    class="bookmark-table__download"
                    label={format(s.downloadPart, { part: format(s.part, { n }) })}
                    disabled={busy}
                    onClick={() => onDownload(index)}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
