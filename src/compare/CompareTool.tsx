import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Dropzone } from '../components/Dropzone';
import { PaneHead } from '../components/WorkspaceParts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatFileSize } from '../lib/format';
import {
  GAP_FACTOR,
  countRows,
  displayList,
  type CompareLevel,
  type CompareOptions,
  type Row,
  type Segment,
  type Unit,
} from './diff';
import { pageRows, pageSize, profileRows, type PageNote, type ProfileDoc } from './profile';
import {
  clearCompare,
  expandRows,
  isReading,
  openFiles,
  setOnlyDiff,
  setOptions,
  setTab,
  setView,
  swapSides,
  useCompareState,
  type CompareDoc,
  type CompareTab,
  type CompareView,
  type Side,
  type Slot,
} from './store';

const SIDES: readonly Side[] = ['a', 'b'];
const LEVELS: readonly CompareLevel[] = ['paragraph', 'sentence', 'line'];
const VIEWS: readonly CompareView[] = ['split', 'unified'];
const TABS: readonly CompareTab[] = ['text', 'profile'];
const LETTER: Record<Side, string> = { a: 'A', b: 'B' };

/**
 * PDF's vergelijken: een origineel (A) en een nieuwe versie (B) openen en zien welke tekst is
 * toegevoegd, verwijderd of gewijzigd. Werkt los van de gewone taken; de stand staat buiten het
 * scherm (`store.ts`). Overgenomen uit de losse pdf-vergelijker; bewuste afwijkingen: er is geen
 * knop Vergelijk (vergelijken gaat vanzelf zodra A en B er zijn, en opnieuw bij elke andere
 * instelling), een PDF met een wachtwoord krijgt dezelfde melding als in de rest van de app, er is
 * geen keuze "Negeer witruimte" (die maakte geen verschil) en de alinea-gevoeligheid is in te
 * stellen, met een lagere standaard (zie `DEFAULT_OPTIONS`).
 */
export function CompareTool() {
  const { t } = useI18n();
  const c = t.compare;
  const state = useCompareState();
  const { result, tooMany, tab } = state;
  const reading = isReading(state);
  const empty = state.a.status === 'empty' && state.b.status === 'empty';

  return (
    <>
      {/* Op een vaste plek boven het werkvak, zodat hij niet verspringt (zoals bij Slim hernoemen). */}
      <div class="compare-mode">
        <TabToggle />
      </div>
      <section class="workspace compare" aria-label={c.toolbar}>
        <div class="workspace__tools">
          {SIDES.map((side) => (
            <SlotView key={side} side={side} slot={state[side]} />
          ))}
          {tooMany && (
            <p class="compare__note" role="status">
              {c.tooMany}
            </p>
          )}
          <div class="toolbar toolbar--tools" role="toolbar" aria-label={c.toolbar}>
            <div class="toolbar__group toolbar__group--wide">
              <button
                type="button"
                class="button button--secondary"
                disabled={reading || empty}
                onClick={swapSides}
              >
                {c.swap}
              </button>
              <button
                type="button"
                class="button button--secondary"
                disabled={empty}
                onClick={clearCompare}
              >
                {c.clear}
              </button>
            </div>
          </div>
          {/* De tellers en instellingen horen bij de tekst. */}
          {tab === 'text' && (
            <>
              {result && <Counts rows={result.rows} />}
              <Settings />
              <p class="annotate__hint">{c.colorsHint}</p>
            </>
          )}
          <p class="annotate__hint">{c.about}</p>
        </div>
        <div class="workspace__view" data-scroll-root>
          {tab === 'text' ? <Results /> : <ProfileView />}
        </div>
      </section>
    </>
  );
}

/** De keuze tussen de tekst en het documentprofiel. */
function TabToggle() {
  const { t } = useI18n();
  const tabs = t.compare.tabs;
  const { tab } = useCompareState();
  return (
    <div class="segmented" role="group" aria-label={tabs.label}>
      {TABS.map((option) => (
        <button
          key={option}
          type="button"
          class="segmented__button"
          aria-pressed={tab === option}
          onClick={() => setTab(option)}
        >
          {tabs[option]}
        </button>
      ))}
    </div>
  );
}

/** Zolang A en B er niet allebei zijn: wat er nog nodig is (of dat er gelezen wordt). */
function Waiting({ placeholder }: { placeholder: string }) {
  const { t } = useI18n();
  const c = t.compare;
  const state = useCompareState();
  const missing = SIDES.find((side) => state[side].status !== 'ready');
  const one = SIDES.some((side) => state[side].status === 'ready');
  return (
    <p class="compare__placeholder">
      {isReading(state)
        ? c.readingStart
        : one && missing
          ? format(c.waitingFor, { side: LETTER[missing] })
          : placeholder}
    </p>
  );
}

/** Eén van de twee documenten: kiezen of slepen, en wat er gelezen is. */
function SlotView({ side, slot }: { side: Side; slot: Slot }) {
  const { t, language } = useI18n();
  const c = t.compare;
  const s = c.sides[side];
  const doc = slot.status === 'ready' ? slot.doc : null;
  return (
    <Dropzone
      title={s.title}
      dropTitle={c.dropHere}
      hint={
        slot.status === 'empty' ? s.hint : slot.status === 'ready' ? slot.doc.file.name : slot.name
      }
      inputId={`compare-file-${side}`}
      accept="application/pdf,.pdf"
      chooseLabel={slot.status === 'empty' ? s.choose : s.replace}
      onFiles={(files) => void openFiles(side, files)}
      extraClass={`compare-slot${doc?.thumb ? ' compare-slot--thumb' : ''}`}
    >
      {slot.status === 'empty' && <p class="compare-slot__meta">{c.bothHint}</p>}
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
      {doc && <p class="compare-slot__meta">{docMeta(doc, c, language)}</p>}
      {doc?.thumb && <img class="compare-slot__thumb" src={doc.thumb} alt="" />}
    </Dropzone>
  );
}

type CompareTexts = ReturnType<typeof useI18n>['t']['compare'];

/** "3 pagina's · 12 KB · 4.512 tekens", met het aantal pagina's zonder tekstlaag als dat er zijn. */
function docMeta(doc: CompareDoc, c: CompareTexts, language: string) {
  const chars = doc.pages.reduce((total, page) => total + page.chars, 0);
  const noText = doc.pages.filter((page) => page.items.length === 0).length;
  return [
    plural(doc.pageCount, c.pagesOne, c.pages),
    formatFileSize(doc.file.size, language),
    format(chars === 1 ? c.charsOne : c.chars, { n: chars.toLocaleString(language) }),
    noText > 0 && plural(noText, c.noTextOne, c.noText),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Hoeveel stukken er toegevoegd, verwijderd en gewijzigd zijn. */
function Counts({ rows }: { rows: readonly Row[] }) {
  const { t } = useI18n();
  const c = t.compare;
  const counts = countRows(rows);
  return (
    <p class="compare-counts" aria-live="polite">
      {(['added', 'removed', 'changed'] as const).map((kind) => (
        <span key={kind} class={`compare-counts__item compare-counts__item--${kind}`}>
          {format(c.counts[kind], { n: counts[kind] })}
        </span>
      ))}
    </p>
  );
}

/** De aan- en uitzetters bij het vergelijken (alleen hoofdletters negeren staat standaard uit). */
const TOGGLES = [
  'ignoreCase',
  'strip',
  'columns',
  'dehyphen',
] as const satisfies readonly (keyof CompareOptions)[];

/** Waarop vergeleken wordt, de alinea-gevoeligheid en de aan- en uitzetters; ze werken meteen. */
function Settings() {
  const { t, language } = useI18n();
  const c = t.compare;
  const s = c.settings;
  const { options, onlyDiff } = useCompareState();
  // Tijdens het slepen alleen het getal bijwerken; pas bij loslaten opnieuw vergelijken.
  const [dragging, setDragging] = useState<number | null>(null);
  const gap = dragging ?? options.gapFactor;
  const byLine = options.level === 'line';
  return (
    <fieldset class="compare-settings">
      <legend>{s.title}</legend>
      <p id="compare-level-label" class="compare-settings__label">
        {s.level}
      </p>
      <div class="segmented" role="group" aria-labelledby="compare-level-label">
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            class="segmented__button"
            aria-pressed={options.level === level}
            onClick={() => setOptions({ level })}
          >
            {c.levels[level].label}
          </button>
        ))}
      </div>
      <div class="compare-settings__range">
        <label for="compare-gap">{s.gap}</label>
        <input
          id="compare-gap"
          type="range"
          min={GAP_FACTOR.min}
          max={GAP_FACTOR.max}
          step={GAP_FACTOR.step}
          value={gap}
          disabled={byLine}
          aria-describedby="compare-gap-hint"
          onInput={(event) => setDragging(Number(event.currentTarget.value))}
          onChange={(event) => {
            setDragging(null);
            setOptions({ gapFactor: Number(event.currentTarget.value) });
          }}
        />
        <output for="compare-gap">
          {gap.toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
        </output>
      </div>
      <p id="compare-gap-hint" class="compare-settings__hint">
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
      <label class="compare-settings__check">
        <input
          type="checkbox"
          checked={onlyDiff}
          onChange={(event) => setOnlyDiff(event.currentTarget.checked)}
        />
        {s.onlyDiff}
      </label>
    </fieldset>
  );
}

/** Het rechtervak: de tekstverschillen, of wat er nog nodig is om te vergelijken. */
function Results() {
  const { t } = useI18n();
  const c = t.compare;
  const state = useCompareState();
  const { a, b, result, options } = state;

  if (!result || a.status !== 'ready' || b.status !== 'ready') {
    return (
      <>
        <PaneHead title={c.textTitle} />
        <Waiting placeholder={c.placeholder} />
      </>
    );
  }

  const level = c.levels[options.level];
  const units = (n: number) => plural(n, level.one, level.other);
  const pages = (n: number) => plural(n, c.pagesOne, c.pages);
  const summary = format(c.summary, {
    a: `${pages(a.doc.pageCount)}, ${units(result.unitsA)}`,
    b: `${pages(b.doc.pageCount)}, ${units(result.unitsB)}`,
  });
  const differs = result.rows.some((row) => row.kind !== 'equal');

  return (
    <>
      <PaneHead title={c.textTitle} meta={summary}>
        {differs && <ViewToggle />}
      </PaneHead>
      {result.fallback && (
        <p class="compare__warning">
          {c.fallback}
          {options.level !== 'paragraph' && ` ${c.fallbackTip}`}
        </p>
      )}
      <NoTextWarning a={a.doc} b={b.doc} />
      {differs ? (
        <DiffTable rows={result.rows} nameA={a.doc.file.name} nameB={b.doc.file.name} />
      ) : (
        <div class="compare__same">
          <p class="compare__same-title">{c.noDiff}</p>
          <p>{c.noDiffNote}</p>
        </div>
      )}
    </>
  );
}

const toProfile = (doc: CompareDoc): ProfileDoc => ({
  name: doc.file.name,
  size: doc.file.size,
  pageCount: doc.pageCount,
  pages: doc.pages,
  info: doc.info,
});

/**
 * Het documentprofiel: de gegevens van A en B naast elkaar, met ≠ bij wat verschilt, en per
 * pagina het formaat en het aantal tekens.
 */
function ProfileView() {
  const { t, language } = useI18n();
  const p = t.compare.profile;
  const { a, b } = useCompareState();
  if (a.status !== 'ready' || b.status !== 'ready') {
    return (
      <>
        <PaneHead title={p.title} />
        <Waiting placeholder={p.placeholder} />
      </>
    );
  }
  const rows = profileRows(toProfile(a.doc), toProfile(b.doc), language, { yes: p.yes, no: p.no });
  const differ = rows.filter((row) => row.differs).length;
  return (
    <>
      <PaneHead
        title={p.title}
        meta={format(differ === 1 ? p.summaryOne : p.summary, { n: differ, total: rows.length })}
      />
      <table class="compare-profile">
        <caption>{p.fieldsCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{p.field}</th>
            <th scope="col">{`A · ${a.doc.file.name}`}</th>
            <th scope="col">{`B · ${b.doc.file.name}`}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} class={row.differs ? 'compare-profile__differs' : undefined}>
              <th scope="row">
                {row.differs && (
                  <span class="compare-profile__flag" aria-hidden="true">
                    ≠
                  </span>
                )}
                {p.fields[row.id]}
                {row.differs && <span class="visually-hidden">{` (${p.differs})`}</span>}
              </th>
              <ProfileValue value={row.a} />
              <ProfileValue value={row.b} />
            </tr>
          ))}
        </tbody>
      </table>
      <PageTable a={a.doc} b={b.doc} />
    </>
  );
}

function ProfileValue({ value }: { value: string }) {
  const { t } = useI18n();
  return (
    <td class="compare-profile__value">
      {value === '' ? <span class="compare-profile__empty">{t.compare.profile.empty}</span> : value}
    </td>
  );
}

/** Per pagina: formaat en tekens van A en B, met wat opvalt. */
function PageTable({ a, b }: { a: CompareDoc; b: CompareDoc }) {
  const { t, language } = useI18n();
  const p = t.compare.profile;
  const none = '—';
  const note = (n: PageNote) =>
    n.kind === 'chars'
      ? format(p.notes.chars, {
          n: `${n.n > 0 ? '+' : '−'}${Math.abs(n.n).toLocaleString(language)}`,
        })
      : p.notes[n.kind];
  return (
    <table class="compare-profile">
      <caption>{p.pagesCaption}</caption>
      <thead>
        <tr>
          <th scope="col">{p.columns.page}</th>
          <th scope="col">{p.columns.sizeA}</th>
          <th scope="col" class="compare-profile__num">
            {p.columns.charsA}
          </th>
          <th scope="col">{p.columns.sizeB}</th>
          <th scope="col" class="compare-profile__num">
            {p.columns.charsB}
          </th>
          <th scope="col">{p.columns.note}</th>
        </tr>
      </thead>
      <tbody>
        {pageRows(toProfile(a), toProfile(b)).map((row) => (
          <tr key={row.no} class={row.notes.length > 0 ? 'compare-profile__differs' : undefined}>
            <th scope="row">{row.no}</th>
            <td class="compare-profile__value">{row.a ? pageSize(row.a) : none}</td>
            <td class="compare-profile__value compare-profile__num">
              {row.a ? row.a.chars.toLocaleString(language) : none}
            </td>
            <td class="compare-profile__value">{row.b ? pageSize(row.b) : none}</td>
            <td class="compare-profile__value compare-profile__num">
              {row.b ? row.b.chars.toLocaleString(language) : none}
            </td>
            <td>{row.notes.length > 0 ? row.notes.map(note).join(', ') : none}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** De keuze tussen naast elkaar en onder elkaar, met dezelfde knoppen als bij het niveau. */
function ViewToggle() {
  const { t } = useI18n();
  const v = t.compare.views;
  const { view } = useCompareState();
  return (
    <div class="segmented compare-view" role="group" aria-label={v.label}>
      {VIEWS.map((option) => (
        <button
          key={option}
          type="button"
          class="segmented__button"
          aria-pressed={view === option}
          onClick={() => setView(option)}
        >
          {v[option]}
        </button>
      ))}
    </div>
  );
}

/** Een waarschuwing als er pagina's zonder tekstlaag zijn: die tellen bij de tekst niet mee. */
function NoTextWarning({ a, b }: { a: CompareDoc; b: CompareDoc }) {
  const { t } = useI18n();
  const c = t.compare;
  const docs = { a, b };
  const parts: string[] = [];
  let all = false;
  for (const side of SIDES) {
    const doc = docs[side];
    const n = doc.pages.filter((page) => page.items.length === 0).length;
    if (n === 0) continue;
    parts.push(format(c.noTextIn, { n, total: doc.pageCount, side: LETTER[side] }));
    if (n === doc.pageCount) all = true;
  }
  if (parts.length === 0) return null;
  return (
    <p class="compare__warning">
      {format(c.noTextWarning, { list: parts.join(c.noTextAnd) })}
      {all && ` ${c.noTextAll}`}
    </p>
  );
}

/**
 * De verschillen naast elkaar (links A, rechts B, elk stuk op een eigen rij) of onder elkaar (één
 * kolom: wat alleen in A staat met −, wat alleen in B staat met +).
 */
function DiffTable({ rows, nameA, nameB }: { rows: readonly Row[]; nameA: string; nameB: string }) {
  const { t } = useI18n();
  const c = t.compare;
  const { expanded, onlyDiff, options, view } = useCompareState();
  const unified = view === 'unified';
  const level = c.levels[options.level];
  const table = useRef<HTMLTableElement>(null);
  // Na het openklikken van ingeklapte stukken: de focus naar het eerste stuk dat erbij kwam (de
  // knop zelf is dan weg).
  const focusRow = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (focusRow.current === null) return;
    table.current?.querySelector<HTMLElement>(`[data-row="${focusRow.current}"]`)?.focus();
    focusRow.current = null;
  });

  return (
    <table class={`compare-diff${unified ? ' compare-diff--unified' : ''}`} ref={table}>
      <thead>
        <tr>
          {unified ? (
            <th scope="col">{format(c.unifiedHead, { a: nameA, b: nameB })}</th>
          ) : (
            <>
              <th scope="col">{`A · ${nameA}`}</th>
              <th scope="col">{`B · ${nameB}`}</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {displayList(rows, onlyDiff, expanded).map((entry) =>
          entry.t === 'gap' ? (
            <tr key={`gap-${entry.from}`} class="compare-diff__gap">
              <td colSpan={unified ? 1 : 2}>
                <button
                  type="button"
                  class="compare-diff__expand"
                  onClick={() => {
                    focusRow.current = entry.from;
                    expandRows(entry.from, entry.to);
                  }}
                >
                  {plural(entry.count, level.gapOne, level.gap)}
                </button>
              </td>
            </tr>
          ) : unified ? (
            <UnifiedRows key={entry.index} row={entry.row} index={entry.index} />
          ) : (
            <DiffRow key={entry.index} row={entry.row} index={entry.index} />
          ),
        )}
      </tbody>
    </table>
  );
}

function DiffRow({ row, index }: { row: Row; index: number }) {
  const a = row.kind === 'added' ? null : row.a;
  const b = row.kind === 'removed' ? null : row.b;
  return (
    <tr class={`compare-diff__row compare-diff__row--${row.kind}`} data-row={index} tabIndex={-1}>
      <Cell unit={a} kind={row.kind} parts={row.kind === 'changed' ? row.partsA : null} side="a" />
      <Cell unit={b} kind={row.kind} parts={row.kind === 'changed' ? row.partsB : null} side="b" />
    </tr>
  );
}

/**
 * Eén stuk onder elkaar: gelijk als één regel, verwijderd met −, toegevoegd met +, en gewijzigd als
 * twee regels (eerst A met −, dan B met +), zoals in de losse pdf-vergelijker.
 */
function UnifiedRows({ row, index }: { row: Row; index: number }) {
  // De eerste regel van een stuk krijgt het nummer, voor de focus na het openklikken.
  const line = (
    kind: Row['kind'],
    unit: Unit,
    parts: Segment[] | null,
    side: Side,
    first = true,
  ) => (
    <tr
      class={`compare-diff__row compare-diff__row--${kind}`}
      data-row={first ? index : undefined}
      tabIndex={first ? -1 : undefined}
    >
      <Cell
        unit={unit}
        kind={kind}
        parts={parts}
        side={side}
        sign={kind === 'removed' ? '−' : kind === 'added' ? '+' : ' '}
      />
    </tr>
  );
  switch (row.kind) {
    case 'equal':
      return line('equal', row.a, null, 'a');
    case 'removed':
      return line('removed', row.a, null, 'a');
    case 'added':
      return line('added', row.b, null, 'b');
    case 'changed':
      return (
        <>
          {line('removed', row.a, row.partsA, 'a')}
          {line('added', row.b, row.partsB, 'b', false)}
        </>
      );
  }
}

function Cell({
  unit,
  kind,
  parts,
  side,
  sign,
}: {
  unit: Unit | null;
  kind: Row['kind'];
  parts: Segment[] | null;
  side: Side;
  /** Onder elkaar: −, + of een spatie voor de tekst (alleen om te zien; schermlezers krijgen de soort). */
  sign?: string;
}) {
  const { t } = useI18n();
  const c = t.compare;
  if (!unit) return <td class="compare-diff__cell compare-diff__cell--empty" />;
  // Woorden die alleen in A staan zijn weggehaald, woorden die alleen in B staan toegevoegd.
  const Mark = side === 'a' ? 'del' : 'ins';
  return (
    <td class="compare-diff__cell">
      <span class="compare-diff__page">
        <span aria-hidden="true">{format(c.page, { n: unit.page })}</span>
        <span class="visually-hidden">{format(c.pageLabel, { n: unit.page })}</span>
      </span>
      {sign !== undefined && (
        <span class="compare-diff__sign" aria-hidden="true">
          {sign}
        </span>
      )}
      {kind !== 'equal' && <span class="visually-hidden">{`${c.kinds[kind]}: `}</span>}
      {parts
        ? parts.map((part, i) => (part.mark ? <Mark key={i}>{part.text}</Mark> : part.text))
        : unit.val}
    </td>
  );
}
