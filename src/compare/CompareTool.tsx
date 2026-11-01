import { useLayoutEffect, useRef } from 'preact/hooks';
import { Dropzone } from '../components/Dropzone';
import { PaneHead } from '../components/WorkspaceParts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatFileSize } from '../lib/format';
import { countRows, displayList, type Row, type Segment, type Unit } from './diff';
import {
  clearCompare,
  expandRows,
  isReading,
  openFiles,
  swapSides,
  useCompareState,
  type CompareDoc,
  type Side,
  type Slot,
} from './store';

const SIDES: readonly Side[] = ['a', 'b'];
const LETTER: Record<Side, string> = { a: 'A', b: 'B' };

/**
 * PDF's vergelijken: een origineel (A) en een nieuwe versie (B) openen en zien welke tekst is
 * toegevoegd, verwijderd of gewijzigd. Werkt los van de gewone taken; de stand staat buiten het
 * scherm (`store.ts`). Overgenomen uit de losse pdf-vergelijker; bewuste afwijkingen: er is geen
 * knop Vergelijk (vergelijken gaat vanzelf zodra A en B er zijn) en een PDF met een wachtwoord
 * krijgt dezelfde melding als in de rest van de app.
 */
export function CompareTool() {
  const { t } = useI18n();
  const c = t.compare;
  const state = useCompareState();
  const { result, tooMany } = state;
  const reading = isReading(state);
  const empty = state.a.status === 'empty' && state.b.status === 'empty';

  return (
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
        {result && <Counts rows={result.rows} />}
        <p class="annotate__hint">{c.colorsHint}</p>
        <p class="annotate__hint">{c.settings}</p>
        <p class="annotate__hint">{c.about}</p>
      </div>
      <div class="workspace__view" data-scroll-root>
        <Results />
      </div>
    </section>
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

/** Het rechtervak: de tekstverschillen, of wat er nog nodig is om te vergelijken. */
function Results() {
  const { t } = useI18n();
  const c = t.compare;
  const state = useCompareState();
  const { a, b, result } = state;

  if (!result || a.status !== 'ready' || b.status !== 'ready') {
    const missing = SIDES.find((side) => state[side].status !== 'ready');
    const one = SIDES.some((side) => state[side].status === 'ready');
    return (
      <>
        <PaneHead title={c.textTitle} />
        <p class="compare__placeholder">
          {isReading(state)
            ? c.readingStart
            : one && missing
              ? format(c.waitingFor, { side: LETTER[missing] })
              : c.placeholder}
        </p>
      </>
    );
  }

  const units = (n: number) => plural(n, c.unitsOne, c.units);
  const pages = (n: number) => plural(n, c.pagesOne, c.pages);
  const summary = format(c.summary, {
    a: `${pages(a.doc.pageCount)}, ${units(result.unitsA)}`,
    b: `${pages(b.doc.pageCount)}, ${units(result.unitsB)}`,
  });
  const differs = result.rows.some((row) => row.kind !== 'equal');

  return (
    <>
      <PaneHead title={c.textTitle} meta={summary} />
      {result.fallback && <p class="compare__warning">{c.fallback}</p>}
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

/** De verschillen naast elkaar: links A, rechts B, elk stuk op een eigen rij. */
function DiffTable({ rows, nameA, nameB }: { rows: readonly Row[]; nameA: string; nameB: string }) {
  const { t } = useI18n();
  const c = t.compare;
  const { expanded } = useCompareState();
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
    <table class="compare-diff" ref={table}>
      <thead>
        <tr>
          <th scope="col">{`A · ${nameA}`}</th>
          <th scope="col">{`B · ${nameB}`}</th>
        </tr>
      </thead>
      <tbody>
        {displayList(rows, true, expanded).map((entry) =>
          entry.t === 'gap' ? (
            <tr key={`gap-${entry.from}`} class="compare-diff__gap">
              <td colSpan={2}>
                <button
                  type="button"
                  class="compare-diff__expand"
                  onClick={() => {
                    focusRow.current = entry.from;
                    expandRows(entry.from, entry.to);
                  }}
                >
                  {plural(entry.count, c.gapOne, c.gap)}
                </button>
              </td>
            </tr>
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

function Cell({
  unit,
  kind,
  parts,
  side,
}: {
  unit: Unit | null;
  kind: Row['kind'];
  parts: Segment[] | null;
  side: Side;
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
      {kind !== 'equal' && <span class="visually-hidden">{`${c.kinds[kind]}: `}</span>}
      {parts
        ? parts.map((part, i) => (part.mark ? <Mark key={i}>{part.text}</Mark> : part.text))
        : unit.val}
    </td>
  );
}
