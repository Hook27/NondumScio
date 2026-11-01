import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Dropzone } from '../components/Dropzone';
import { PaneHead } from '../components/WorkspaceParts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatFileSize } from '../lib/format';
import { downloadFile } from '../pdf/save';
import { stamp } from '../rename/stamp';
import {
  GAP_FACTOR,
  countRows,
  displayList,
  type CompareLevel,
  type CompareOptions,
  type Row,
  type Segment,
  type TextComparison,
  type Unit,
} from './diff';
import { pageRows, pageSize, profileRows, type PageNote, type ProfileDoc } from './profile';
import { buildReport, copyText, type ReportDoc } from './report';
import {
  ZOOM_STEPS,
  composeDiff,
  composeOverlay,
  fitWidth,
  renderPage,
  stepZoom,
  targetWidths,
} from './visual';
import {
  clearCompare,
  expandRows,
  getCompareState,
  isReading,
  openFiles,
  setOnlyDiff,
  setOptions,
  setTab,
  setView,
  setVisual,
  swapSides,
  useCompareState,
  type CompareDoc,
  type CompareTab,
  type CompareView,
  type VisualMode,
  type Side,
  type Slot,
} from './store';

const SIDES: readonly Side[] = ['a', 'b'];
const LEVELS: readonly CompareLevel[] = ['paragraph', 'sentence', 'line'];
const VIEWS: readonly CompareView[] = ['split', 'unified'];
const TABS: readonly CompareTab[] = ['text', 'profile', 'visual'];
const MODES: readonly VisualMode[] = ['diff', 'side', 'overlay'];
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
  // Wat er met het rapport gebeurd is, bij welke vergelijking: bij een nieuwe vergelijking hoort de
  // melding er niet meer bij. (Geen effect om hem te wissen: dat loopt pas na een timer en zou een
  // melding van vlak na het vergelijken weer weghalen.)
  const [report, setReport] = useState<{ result: TextComparison | null; text: string } | null>(
    null,
  );
  const reportStatus = report?.result === result ? report.text : null;

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
            <ReportButtons onStatus={(text) => setReport({ result, text })} />
          </div>
          {reportStatus && (
            <p class="page-editor__saved" role="status">
              {reportStatus}
            </p>
          )}
          {/* De tellers en instellingen horen bij de tekst. */}
          {tab === 'text' && (
            <>
              {result && <Counts rows={result.rows} />}
              <Settings />
              <p class="annotate__hint">{c.colorsHint}</p>
            </>
          )}
          {tab === 'visual' && <VisualControls />}
          <p class="annotate__hint">{c.about}</p>
        </div>
        <div class="workspace__view" data-scroll-root>
          {tab === 'text' ? <Results /> : tab === 'profile' ? <ProfileView /> : <VisualView />}
        </div>
      </section>
    </>
  );
}

/** De gegevens van een document die het rapport noemt. */
const reportDoc = (doc: CompareDoc): ReportDoc => ({
  name: doc.file.name,
  size: doc.file.size,
  pageCount: doc.pageCount,
  noText: doc.pages.filter((page) => page.items.length === 0).length,
});

/**
 * Het rapport (profiel en tekstverschillen, met de instellingen) kopiëren of downloaden, zodra A en
 * B vergeleken zijn. Downloaden gaat meteen, met datum en tijd in de naam, zoals de export van de
 * database bij Slim hernoemen.
 */
function ReportButtons({ onStatus }: { onStatus: (status: string) => void }) {
  const { t, language } = useI18n();
  const c = t.compare;
  const r = c.report;
  const state = useCompareState();
  const { a, b, result } = state;
  const ready = result !== null && a.status === 'ready' && b.status === 'ready';
  const report = () => {
    if (!result || a.status !== 'ready' || b.status !== 'ready') return '';
    return buildReport({
      a: reportDoc(a.doc),
      b: reportDoc(b.doc),
      options: state.options,
      rows: result.rows,
      fallback: result.fallback,
      profile: profileRows(toProfile(a.doc), toProfile(b.doc), language, {
        yes: c.profile.yes,
        no: c.profile.no,
      }),
      texts: c,
      language,
      now: new Date(),
    });
  };
  return (
    <div class="toolbar__group toolbar__group--wide">
      <button
        type="button"
        class="button button--secondary"
        disabled={!ready}
        onClick={() => void copyText(report()).then((ok) => onStatus(ok ? r.copied : r.copyFailed))}
      >
        {r.copy}
      </button>
      <button
        type="button"
        class="button button--secondary"
        disabled={!ready}
        onClick={() => {
          const name = `${r.fileName}_${stamp()}.txt`;
          downloadFile(new TextEncoder().encode(report()), name, 'text/plain;charset=utf-8');
          onStatus(format(r.downloaded, { name }));
        }}
      >
        {r.download}
      </button>
    </div>
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

/** Het aantal pagina's om door te bladeren: de meeste van A en B (0 zolang ze er niet zijn). */
function pageTotal(state: ReturnType<typeof useCompareState>) {
  const count = (slot: Slot) => (slot.status === 'ready' ? slot.doc.pageCount : 0);
  return Math.max(count(state.a), count(state.b));
}

/** Een getal met een vast aantal cijfers achter de komma, in de taal van de app. */
const decimals = (n: number, digits: number, language: string) =>
  n.toLocaleString(language, { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Links bij het beeld: bladeren, B verschuiven, de weergave, de drempel of B over A, en de zoom. */
function VisualControls() {
  const { t } = useI18n();
  const v = t.compare.visual;
  const state = useCompareState();
  const { visual } = state;
  const total = pageTotal(state);
  const page = Math.min(visual.page, Math.max(1, total));
  const lastZoom = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  return (
    <fieldset class="compare-settings compare-visual__controls">
      <legend>{v.title}</legend>
      <div class="compare-visual__nav">
        <button
          type="button"
          class="button button--secondary"
          aria-label={v.previous}
          disabled={total === 0 || page <= 1}
          onClick={() => setVisual({ page: page - 1 })}
        >
          ◀
        </button>
        <span>{total > 0 ? format(v.page, { n: page, total }) : v.noPages}</span>
        <button
          type="button"
          class="button button--secondary"
          aria-label={v.next}
          disabled={page >= total}
          onClick={() => setVisual({ page: page + 1 })}
        >
          ▶
        </button>
      </div>
      <div class="compare-visual__offset">
        <label for="compare-offset">{v.offset}</label>
        <input
          id="compare-offset"
          type="number"
          step={1}
          value={visual.offset}
          aria-describedby="compare-offset-hint"
          onChange={(event) =>
            setVisual({ offset: Number.parseInt(event.currentTarget.value, 10) || 0 })
          }
        />
      </div>
      <p id="compare-offset-hint" class="compare-settings__hint">
        {v.offsetHint}
      </p>
      {visual.mode === 'diff' && (
        <div class="compare-settings__range">
          <label for="compare-threshold">{v.threshold}</label>
          <input
            id="compare-threshold"
            type="range"
            min={4}
            max={120}
            value={visual.threshold}
            aria-describedby="compare-threshold-hint"
            onInput={(event) => setVisual({ threshold: Number(event.currentTarget.value) })}
          />
          <output for="compare-threshold">{visual.threshold}</output>
          <p id="compare-threshold-hint" class="compare-settings__hint">
            {v.thresholdHint}
          </p>
        </div>
      )}
      {visual.mode === 'overlay' && (
        <div class="compare-settings__range">
          <label for="compare-alpha">{v.alpha}</label>
          <input
            id="compare-alpha"
            type="range"
            min={0}
            max={100}
            value={Math.round(visual.alpha * 100)}
            aria-describedby="compare-alpha-hint"
            onInput={(event) => setVisual({ alpha: Number(event.currentTarget.value) / 100 })}
          />
          <output for="compare-alpha">{`${Math.round(visual.alpha * 100)}%`}</output>
          <p id="compare-alpha-hint" class="compare-settings__hint">
            {v.alphaHint}
          </p>
        </div>
      )}
      <p id="compare-zoom-label" class="compare-settings__label">
        {v.zoom}
      </p>
      <div class="compare-visual__zoom" role="group" aria-labelledby="compare-zoom-label">
        <button
          type="button"
          class="button button--secondary"
          aria-label={v.zoomOut}
          disabled={visual.zoom <= ZOOM_STEPS[0]}
          onClick={() => setVisual({ zoom: stepZoom(visual.zoom, -1) })}
        >
          −
        </button>
        <output class="compare-visual__zoom-value">{`${visual.zoom}%`}</output>
        <button
          type="button"
          class="button button--secondary"
          aria-label={v.zoomIn}
          disabled={visual.zoom >= lastZoom}
          onClick={() => setVisual({ zoom: stepZoom(visual.zoom, 1) })}
        >
          +
        </button>
        <button
          type="button"
          class="button button--secondary"
          disabled={visual.zoom === 100}
          onClick={() => setVisual({ zoom: 100 })}
        >
          {v.fit}
        </button>
      </div>
      <p class="compare-settings__hint">{v.keys}</p>
    </fieldset>
  );
}

/** Wat er rechts te zien is bij het beeld. */
type Drawn =
  | { kind: 'missing'; side: Side; page: number; count: number }
  | { kind: 'error' }
  | {
      kind: 'diff';
      canvas: HTMLCanvasElement;
      ratio: number;
      diff: number;
      ink: number;
      total: number;
    }
  | { kind: 'overlay'; canvas: HTMLCanvasElement; ratio: number }
  | { kind: 'side'; a: HTMLCanvasElement; b: HTMLCanvasElement; ratio: number };

/** Rechts bij het beeld: de pagina's getekend, als verschil, naast elkaar of B over A. */
function VisualView() {
  const { t } = useI18n();
  const v = t.compare.visual;
  const { a, b } = useCompareState();
  if (a.status !== 'ready' || b.status !== 'ready') {
    return (
      <>
        <PaneHead title={v.title} />
        <Waiting placeholder={v.placeholder} />
      </>
    );
  }
  return <VisualCanvas a={a.doc} b={b.doc} />;
}

/** De laatst getekende pagina's, om bij een andere drempel of weergave niet opnieuw te tekenen. */
type Rendered = {
  key: string;
  pages: Promise<[HTMLCanvasElement | null, HTMLCanvasElement | null]>;
};

/** Elk bestand een eigen nummer, voor de sleutel van de getekende pagina's. */
const fileIds = new WeakMap<File, number>();
let lastFileId = 0;
const fileId = (file: File) => {
  if (!fileIds.has(file)) fileIds.set(file, ++lastFileId);
  return fileIds.get(file)!;
};

function VisualCanvas({ a, b }: { a: CompareDoc; b: CompareDoc }) {
  const { t, language } = useI18n();
  const c = t.compare;
  const v = c.visual;
  const state = useCompareState();
  const { visual } = state;
  const total = pageTotal(state);
  const pageA = Math.min(visual.page, total);
  const pageB = pageA + visual.offset;
  const wrap = useRef<HTMLDivElement>(null);
  // De breedte van het vak; zonder meting (zoals in een test) een redelijke schatting.
  const [available, setAvailable] = useState(0);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [busy, setBusy] = useState(false);
  const rendered = useRef<Rendered | null>(null);

  // Bij "passend" hangt de tekenbreedte aan de breedte van het vak: opnieuw meten als die verandert.
  useLayoutEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const measure = () => setAvailable(element.clientWidth - 32);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const side = visual.mode === 'side';
    const widths = targetWidths(
      fitWidth(available > 0 ? available : 940, side),
      visual.zoom,
      window.devicePixelRatio,
    );
    const key = [fileId(a.file), pageA, fileId(b.file), pageB, widths.dev].join('|');
    if (rendered.current?.key !== key) {
      rendered.current = {
        key,
        pages: Promise.all([
          renderPage(a.file, pageA, widths.dev),
          renderPage(b.file, pageB, widths.dev),
        ]),
      };
    }
    setBusy(true);
    rendered.current.pages
      .then(([ca, cb]): Drawn => {
        if (!ca) return { kind: 'missing', side: 'a', page: pageA, count: a.pageCount };
        if (!cb) return { kind: 'missing', side: 'b', page: pageB, count: b.pageCount };
        if (side) return { kind: 'side', a: ca, b: cb, ratio: widths.ratio };
        if (visual.mode === 'overlay') {
          return {
            kind: 'overlay',
            canvas: composeOverlay(ca, cb, visual.alpha),
            ratio: widths.ratio,
          };
        }
        return { kind: 'diff', ratio: widths.ratio, ...composeDiff(ca, cb, visual.threshold) };
      })
      .catch((): Drawn => {
        // De volgende keer opnieuw proberen.
        rendered.current = null;
        return { kind: 'error' };
      })
      .then((next) => {
        if (cancelled) return;
        setDrawn(next);
        setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [a, b, pageA, pageB, visual.mode, visual.threshold, visual.alpha, visual.zoom, available]);

  // Toetsen: ← → bladeren, + − zoomen, 0 = passend (niet in een invoerveld, en niet met Ctrl).
  useEffect(() => {
    const target = document;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      const now = getCompareState().visual;
      const actions: Record<string, () => void> = {
        ArrowLeft: () => setVisual({ page: Math.max(1, Math.min(now.page, total) - 1) }),
        ArrowRight: () => setVisual({ page: Math.min(total, now.page + 1) }),
        '+': () => setVisual({ zoom: stepZoom(now.zoom, 1) }),
        '=': () => setVisual({ zoom: stepZoom(now.zoom, 1) }),
        '-': () => setVisual({ zoom: stepZoom(now.zoom, -1) }),
        _: () => setVisual({ zoom: stepZoom(now.zoom, -1) }),
        '0': () => setVisual({ zoom: 100 }),
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [total]);

  const stat =
    drawn?.kind === 'diff'
      ? format(v.stat.diff, {
          page: decimals((drawn.diff / drawn.total) * 100, 2, language),
          ink: decimals(drawn.ink ? (drawn.diff / drawn.ink) * 100 : 0, 1, language),
          px: drawn.diff.toLocaleString(language),
        })
      : drawn?.kind === 'side'
        ? format(v.stat.side, {
            a: `${drawn.a.width}×${drawn.a.height}`,
            b: `${drawn.b.width}×${drawn.b.height}`,
          })
        : drawn?.kind === 'overlay'
          ? format(v.stat.overlay, { n: Math.round(visual.alpha * 100) })
          : '';

  return (
    <>
      <PaneHead title={v.title} meta={format(v.pages, { a: pageA, b: pageB })}>
        <ModeToggle />
      </PaneHead>
      <p class="compare-visual__stat" aria-live="polite">
        {busy ? v.drawing : stat}
      </p>
      {visual.mode === 'diff' && (
        <ul class="compare-visual__legend">
          <li class="compare-visual__legend-a">{v.legend.a}</li>
          <li class="compare-visual__legend-b">{v.legend.b}</li>
          <li class="compare-visual__legend-same">{v.legend.same}</li>
        </ul>
      )}

      <div class="compare-visual__wrap" ref={wrap}>
        {drawn?.kind === 'missing' && (
          <p class="compare-visual__msg">
            {format(v.missing, {
              n: drawn.page,
              side: LETTER[drawn.side],
              pages: plural(drawn.count, c.pagesOne, c.pages),
            })}
          </p>
        )}
        {drawn?.kind === 'error' && <p class="compare-visual__msg">{v.error}</p>}
        {drawn?.kind === 'diff' && (
          <CanvasBox
            canvas={drawn.canvas}
            ratio={drawn.ratio}
            label={format(v.labels.diff, { a: pageA, b: pageB })}
          />
        )}
        {drawn?.kind === 'overlay' && (
          <CanvasBox
            canvas={drawn.canvas}
            ratio={drawn.ratio}
            label={format(v.labels.overlay, { a: pageA, b: pageB })}
          />
        )}
        {drawn?.kind === 'side' && (
          <div class="compare-visual__side">
            <figure>
              <figcaption>{format(v.labels.a, { n: pageA })}</figcaption>
              <CanvasBox
                canvas={drawn.a}
                ratio={drawn.ratio}
                label={format(v.labels.a, { n: pageA })}
              />
            </figure>
            <figure>
              <figcaption>{format(v.labels.b, { n: pageB })}</figcaption>
              <CanvasBox
                canvas={drawn.b}
                ratio={drawn.ratio}
                label={format(v.labels.b, { n: pageB })}
              />
            </figure>
          </div>
        )}
      </div>
    </>
  );
}

/** De keuze tussen verschil, naast elkaar en overlay, in de kop van het rechtervak. */
function ModeToggle() {
  const { t } = useI18n();
  const modes = t.compare.visual.modes;
  const { visual } = useCompareState();
  return (
    <div class="segmented compare-view" role="group" aria-label={modes.label}>
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          class="segmented__button"
          aria-pressed={visual.mode === mode}
          onClick={() => setVisual({ mode })}
        >
          {modes[mode]}
        </button>
      ))}
    </div>
  );
}

/**
 * Een getekend canvas in het scherm zetten, op zijn weergavebreedte (getekend is fijner, zie
 * `targetWidths`). Is het breder dan het vak, dan schuift het vak zelf.
 */
function CanvasBox({
  canvas,
  ratio,
  label,
}: {
  canvas: HTMLCanvasElement;
  ratio: number;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    canvas.className = 'compare-visual__canvas';
    canvas.style.width = `${Math.round(canvas.width / ratio)}px`;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
    box.current?.replaceChildren(canvas);
  }, [canvas, ratio, label]);
  return <div ref={box} />;
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
