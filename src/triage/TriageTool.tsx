import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ZOOM_STEPS, pageSize, renderPage, stepZoom, targetWidths } from '../compare/visual';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dropzone } from '../components/Dropzone';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatFileSize } from '../lib/format';
import type { LoadErrorCode } from '../pdf/detect';
import { PdfLoadError } from '../pdf/loader';
import { downloadFile } from '../pdf/save';
import {
  addTriageFiles,
  askFolder,
  chooseFolder,
  clearTriage,
  decide,
  getTriageState,
  moveToNumber,
  navigate,
  select,
  setFit,
  setPage,
  setDecision,
  setPageCount,
  setView,
  setZoom,
  useTriageState,
  type Fit,
  type TriageView,
} from './store';
import {
  byFolder,
  counts,
  exportName,
  groups,
  isMove,
  sameDecision,
  sortFolders,
  triageCsv,
  triageTxt,
  type Choice,
  type Decision,
  type ExportTexts,
  type TriageFile,
} from './triage';

type Texts = ReturnType<typeof useI18n>['t'];

const VIEWS: readonly TriageView[] = ['review', 'overview'];
const FITS: readonly Fit[] = ['page', 'width'];

/**
 * Archief / Triage: PDF's één voor één bekijken en per PDF beslissen: bewaren, verplaatsen naar een
 * map of verwijderen, met een toets (K, M of 1–9, X); daarna komt vanzelf de volgende die nog niet
 * beoordeeld is. Het overzicht toont de lijsten (en daar kun je nog wijzigen), om te downloaden als
 * .txt of .csv. Overgenomen uit de losse pdf-triage.html (de lijst) en DocumentTriage (verplaatsen,
 * naar de volgende onbeoordeelde); bladeren en zoomen zoals bij PDF → Platte tekst. Er gebeurt
 * niets met de bestanden zelf.
 */
export function TriageTool() {
  const { t } = useI18n();
  const { view } = useTriageState();
  useKeys();
  return (
    <section class="workspace triage" aria-label={t.triage.toolbar}>
      <div class="workspace__tools">
        <ModeChoice />
        <Slot />
        <Progress />
        <FileList />
        <DecideBar />
      </div>
      <div class="workspace__view" data-scroll-root>
        {view === 'review' ? <Review /> : <Overview />}
      </div>
      <FolderDialog />
    </section>
  );
}

/**
 * De toetsen bij Beoordelen: K bewaren, X verwijderen, M naar een nieuwe map, 1–9 naar een gekozen
 * map, ← → ander bestand, ↑ ↓ (en Page Up, Page Down, Home, End) bladeren. Niet in een invoerveld, niet met Ctrl/Alt en niet als er een venster
 * open is.
 */
function useKeys() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const now = getTriageState();
      const current = now.files[now.cur];
      if (now.view !== 'review' || !current) return;
      const last = now.pageCounts[current.id] ?? 1;
      const actions: Record<string, () => void> = {
        k: () => decide('keep'),
        x: () => decide('remove'),
        m: () => askFolder({ kind: 'current' }),
        ArrowLeft: () => navigate(-1),
        ArrowRight: () => navigate(1),
        ArrowUp: () => setPage(current.page - 1),
        PageUp: () => setPage(current.page - 1),
        ArrowDown: () => setPage(current.page + 1),
        PageDown: () => setPage(current.page + 1),
        Home: () => setPage(1),
        End: () => setPage(last),
      };
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const action = /^[1-9]$/.test(key) ? () => moveToNumber(Number(key)) : actions[key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    // Het doel onthouden: het opruimen kan lopen als de testomgeving `document` al weg heeft.
    const target = document;
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, []);
}

/** De werkwijze: een lijst maken (nu), of een map opruimen (volgt). */
function ModeChoice() {
  const { t } = useI18n();
  const m = t.triage.modes;
  return (
    <>
      <div class="segmented triage-mode" role="group" aria-label={m.label}>
        <button type="button" class="segmented__button" aria-pressed="true">
          {m.list}
        </button>
        <button type="button" class="segmented__button" aria-pressed="false" disabled>
          {m.folder}
        </button>
      </div>
      <p class="compare-settings__hint triage-mode__hint">{t.triage.folderSoon}</p>
    </>
  );
}

/** PDF's kiezen of slepen (meer keren toevoegen kan), en Wis alles; wat er is overgeslagen. */
function Slot() {
  const { t } = useI18n();
  const tr = t.triage;
  const { files, skipped } = useTriageState();
  const [asking, setAsking] = useState(false);
  const skippedText = skipped
    ? format(tr.skipped, {
        list: [
          skipped.notPdf > 0 && plural(skipped.notPdf, tr.notPdfOne, tr.notPdf),
          skipped.duplicate > 0 && plural(skipped.duplicate, tr.duplicateOne, tr.duplicate),
        ]
          .filter(Boolean)
          .join('; '),
      })
    : null;
  return (
    <Dropzone
      title={tr.slot.title}
      dropTitle={tr.dropHere}
      hint={
        files.length === 0 ? tr.slot.hint : plural(files.length, tr.slot.countOne, tr.slot.count)
      }
      inputId="triage-files"
      accept="application/pdf,.pdf"
      chooseLabel={files.length === 0 ? tr.slot.choose : tr.slot.add}
      onFiles={addTriageFiles}
      extraClass="plaintext-slot triage-slot"
    >
      <button
        type="button"
        class="button button--secondary"
        disabled={files.length === 0}
        onClick={() => setAsking(true)}
      >
        {tr.clear}
      </button>
      {skippedText && (
        <p class="plaintext-slot__meta" role="status">
          {skippedText}
        </p>
      )}
      {asking && (
        <ConfirmDialog
          title={tr.clearTitle}
          text={tr.clearText}
          cancel={tr.cancel}
          confirm={tr.clearConfirm}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            clearTriage();
          }}
        />
      )}
    </Dropzone>
  );
}

/** "3 van 10 beoordeeld · ✓ 1 · → 1 · ✕ 1", met een voortgangsbalk. */
function Progress() {
  const { t } = useI18n();
  const tr = t.triage;
  const { files } = useTriageState();
  if (files.length === 0) return null;
  const c = counts(files);
  const progress = format(tr.progress, { done: c.done, total: c.total });
  return (
    <div class="triage-progress">
      <p class="triage-progress__text">
        {progress}
        {' · '}
        <span aria-hidden="true">{`✓ ${c.keep} · → ${c.move} · ✕ ${c.remove}`}</span>
        <span class="visually-hidden">
          {format(tr.tallyLabel, { keep: c.keep, move: c.move, remove: c.remove })}
        </span>
      </p>
      <progress
        class="triage-progress__bar"
        max={c.total}
        value={c.done}
        aria-label={tr.progressLabel}
      />
    </div>
  );
}

/** De lijst met PDF's: een stip per besluit; klik om een PDF te bekijken. */
function FileList() {
  const { t } = useI18n();
  const tr = t.triage;
  const { files, cur } = useTriageState();
  const list = useRef<HTMLOListElement>(null);
  // Het bestand van nu in beeld houden, ook als het vanzelf verder gaat na een besluit.
  useLayoutEffect(() => {
    const item = list.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (item) reveal(item);
  }, [cur, files.length]);
  if (files.length === 0) return null;
  return (
    <ol ref={list} class="triage-list" aria-label={tr.files}>
      {files.map((entry, index) => (
        <li key={entry.id}>
          <button
            type="button"
            class={[
              'triage-list__item',
              entry.decision && `triage-list__item--${kind(entry.decision)}`,
            ]
              .filter(Boolean)
              .join(' ')}
            aria-current={index === cur ? 'true' : undefined}
            // Een schermlezer hoort "brief.pdf, bewaren": de naam zoals hij er staat, en het besluit.
            aria-label={`${entry.name}, ${stateText(entry.decision, t)}`}
            data-tip={entry.name}
            onClick={() => select(index)}
          >
            <span class="triage-list__dot" aria-hidden="true" />
            <span class="triage-list__name">{entry.name}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Het soort besluit, voor de stip en de klasse: bewaren, verplaatsen of verwijderen. */
const kind = (decision: Choice): 'keep' | 'move' | 'remove' =>
  isMove(decision) ? 'move' : decision;

/** Het besluit in woorden: "bewaren", "verplaatsen naar Facturen", "nog niet beoordeeld". */
function stateText(decision: Decision, t: Texts): string {
  const states = t.triage.states;
  if (isMove(decision)) return states.move.replace('{folder}', () => decision.move);
  return states[decision ?? 'none'];
}

/**
 * Schuift het linkervak zo dat dit bestand in beeld staat, met één regel ruimte erboven en eronder,
 * en niet achter de vaste balk onderaan (die is hoger met de mappen erin). Alleen dat vak schuift:
 * `scrollIntoView` zou ook de pagina zelf kunnen schuiven.
 */
function reveal(item: HTMLElement) {
  const pane = item.closest<HTMLElement>('.workspace__tools');
  if (!pane || pane.scrollHeight <= pane.clientHeight) return;
  const box = item.getBoundingClientRect();
  const area = pane.getBoundingClientRect();
  const bar = pane.querySelector('.triage-decide')?.getBoundingClientRect();
  const end = bar ? bar.top : area.bottom;
  // Eén regel ruimte erboven en eronder; is het vak daarvoor te laag, dan minder.
  const room = Math.max(0, Math.min(box.height, (end - area.top - box.height) / 2));
  const top = area.top + room;
  const bottom = end - room;
  if (box.bottom > bottom) pane.scrollTop += box.bottom - bottom;
  else if (box.top < top) pane.scrollTop -= top - box.top;
}

/**
 * Vast onderaan links: naar het vorige of volgende bestand, de gekozen mappen (op naam, met de
 * toets 1–9) en "+ Nieuwe map" (M), en de knoppen Verwijderen en Bewaren.
 */
function DecideBar() {
  const { t } = useI18n();
  const tr = t.triage;
  const { files, cur, folders } = useTriageState();
  const current = files[cur];
  if (!current) return null;
  const decision = current.decision;
  return (
    <div class="triage-decide">
      <div class="plaintext-nav triage-filenav" role="group" aria-label={tr.fileNav}>
        <button
          type="button"
          class="button button--secondary"
          aria-label={tr.previousFile}
          disabled={cur <= 0}
          onClick={() => navigate(-1)}
        >
          ‹
        </button>
        <span class="plaintext-nav__page">
          <span aria-hidden="true">{`${cur + 1} / ${files.length}`}</span>
          <span class="visually-hidden">
            {format(tr.filePos, { n: cur + 1, total: files.length })}
          </span>
        </span>
        <button
          type="button"
          class="button button--secondary"
          aria-label={tr.nextFile}
          disabled={cur >= files.length - 1}
          onClick={() => navigate(1)}
        >
          ›
        </button>
      </div>
      <div class="triage-move" role="group" aria-label={tr.moveTo}>
        <div class="triage-move__head">
          <span class="triage-folders__label" aria-hidden="true">
            {tr.moveTo}
          </span>
          <button
            type="button"
            class="button button--secondary triage-folder"
            aria-keyshortcuts="M"
            data-tip={tr.newFolderTip}
            onClick={() => askFolder({ kind: 'current' })}
          >
            {tr.newFolder}
          </button>
        </div>
        {folders.length > 0 && (
          <div class="triage-folders">
            {sortFolders(folders).map((folder, i) => (
              <button
                key={folder}
                type="button"
                class="button button--secondary triage-folder"
                aria-pressed={sameDecision(decision, { move: folder })}
                aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                data-tip={i < 9 ? format(tr.folderTip, { folder, n: i + 1 }) : folder}
                onClick={() => decide({ move: folder })}
              >
                {i < 9 && (
                  <span class="triage-folder__key" aria-hidden="true">
                    {i + 1}
                  </span>
                )}
                <span class="triage-folder__name">{folder}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div class="triage-decide__buttons" role="group" aria-label={tr.decide}>
        <button
          type="button"
          class="button triage-decide__remove"
          aria-pressed={current.decision === 'remove'}
          aria-keyshortcuts="X"
          data-tip={`${tr.remove} (X)`}
          onClick={() => decide('remove')}
        >
          <span aria-hidden="true">✕</span>
          <span class="triage-decide__label">{tr.remove}</span>
        </button>
        <button
          type="button"
          class="button triage-decide__keep"
          aria-pressed={current.decision === 'keep'}
          aria-keyshortcuts="K"
          data-tip={`${tr.keep} (K)`}
          onClick={() => decide('keep')}
        >
          <span aria-hidden="true">✓</span>
          <span class="triage-decide__label">{tr.keep}</span>
        </button>
      </div>
    </div>
  );
}

/** De keuze tussen Beoordelen en het Overzicht. */
function ViewToggle() {
  const { t } = useI18n();
  const v = t.triage.views;
  const { view } = useTriageState();
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

/** De balk boven het rechtervak: de weergave, en wat daarbij hoort. */
function Bar({ children }: { children?: ComponentChildren }) {
  return (
    <div class="plaintext-bar">
      <ViewToggle />
      {children}
    </div>
  );
}

/** Beoordelen: de PDF van nu, of uitleg zolang er nog niets is. */
function Review() {
  const { t } = useI18n();
  const { files, cur } = useTriageState();
  const current = files[cur];
  if (!current) {
    return (
      <>
        <Bar />
        <p class="compare__placeholder">{t.triage.placeholder}</p>
        <p class="compare-settings__hint">{t.triage.keys}</p>
      </>
    );
  }
  return <PageView key={current.id} entry={current} />;
}

/** Wat er van de pagina bekend is: het aantal pagina's en de maat, of waarom de PDF niet open kon. */
type Info = { count: number; w: number; h: number } | { error: LoadErrorCode };

/** De getekende pagina van nu, of een fout. */
type Drawn = { canvas: HTMLCanvasElement } | { error: true };

/** Eén PDF: bladeren en zoomen zoals bij PDF → Platte tekst. */
function PageView({ entry }: { entry: TriageFile }) {
  const { t, language } = useI18n();
  const v = t.plainText.preview;
  const { fit, zoom } = useTriageState();
  const { file, page } = entry;
  const wrap = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ w: 0, h: 0 });
  const [info, setInfo] = useState<Info | null>(null);
  const [drawn, setDrawn] = useState<Drawn | null>(null);

  useLayoutEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const root = element.closest<HTMLElement>('[data-scroll-root]');
    const measure = () => {
      const top = root
        ? element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
        : 0;
      // Onderaan heeft het vak opvulling; "hele pagina" moet echt passen, anders schuift het
      // scrollwiel eerst een stukje in plaats van door te bladeren.
      const padding = root ? parseFloat(getComputedStyle(root).paddingBottom) || 0 : 0;
      setSpace({ w: element.clientWidth, h: (root?.clientHeight ?? 0) - top - padding - 4 });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (root) observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Het aantal pagina's en de maat van deze pagina; kan de PDF niet open, dan de reden.
  useEffect(() => {
    let cancelled = false;
    pageSize(file, page)
      .then((size): Info | null => size)
      .catch((error: unknown): Info => ({
        error: error instanceof PdfLoadError ? error.code : 'damaged',
      }))
      .then((next) => {
        if (cancelled || !next) return;
        setInfo(next);
        if ('count' in next) setPageCount(entry.id, next.count);
      });
    return () => {
      cancelled = true;
    };
  }, [file, page, entry.id]);

  const size = info && 'count' in info ? info : null;
  const availW = space.w > 0 ? space.w : 600;
  const availH = space.h > 0 ? space.h : 800;
  const ratio = size ? size.w / size.h : 595 / 842;
  const fitCss = fit === 'width' ? availW : Math.min(availW, availH * ratio);
  const widths = targetWidths(Math.floor(fitCss), zoom, window.devicePixelRatio);

  useEffect(() => {
    if (!size) return;
    let cancelled = false;
    renderPage(file, page, widths.dev)
      .then((canvas): Drawn => (canvas ? { canvas } : { error: true }))
      .catch((): Drawn => ({ error: true }))
      .then((next) => {
        if (!cancelled) setDrawn(next);
      });
    return () => {
      cancelled = true;
    };
  }, [file, page, widths.dev, size !== null]);

  // Het scrollwiel bladert door aan de boven- of onderrand van het vak, zoals bij Platte tekst.
  useEffect(() => {
    const root = wrap.current?.closest<HTMLElement>('[data-scroll-root]');
    if (!root) return;
    let locked = false;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const now = getTriageState();
      const current = now.files[now.cur];
      if (!current) return;
      const total = now.pageCounts[current.id] ?? 1;
      const atTop = root.scrollTop <= 0;
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
      const to =
        event.deltaY > 0 && atBottom && current.page < total
          ? current.page + 1
          : event.deltaY < 0 && atTop && current.page > 1
            ? current.page - 1
            : null;
      if (to === null) return;
      event.preventDefault();
      if (locked) return;
      locked = true;
      setTimeout(() => (locked = false), 250);
      setPage(to);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  const count = size?.count ?? 1;
  const lastZoom = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  const percent = size ? Math.round((widths.css / size.w) * 100) : 100;
  const meta = [
    entry.name,
    size && plural(size.count, t.compare.pagesOne, t.compare.pages),
    formatFileSize(file.size, language),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <Bar>
        <div class="plaintext-nav" role="group" aria-label={v.nav} title={t.triage.keys}>
          <button
            type="button"
            class="button button--secondary"
            aria-label={v.first}
            disabled={page <= 1}
            onClick={() => setPage(1)}
          >
            ‹‹
          </button>
          <button
            type="button"
            class="button button--secondary"
            aria-label={v.previous}
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            ‹
          </button>
          <span class="plaintext-nav__page">
            <span aria-hidden="true">{`${page} / ${count}`}</span>
            <span class="visually-hidden">{format(v.page, { n: page, total: count })}</span>
          </span>
          <button
            type="button"
            class="button button--secondary"
            aria-label={v.next}
            disabled={page >= count}
            onClick={() => setPage(page + 1)}
          >
            ›
          </button>
          <button
            type="button"
            class="button button--secondary"
            aria-label={v.last}
            disabled={page >= count}
            onClick={() => setPage(count)}
          >
            ››
          </button>
        </div>
        <div class="plaintext-zoom" role="group" aria-label={v.zoom}>
          <button
            type="button"
            class="button button--secondary"
            aria-label={v.zoomOut}
            disabled={zoom <= ZOOM_STEPS[0]}
            onClick={() => setZoom(stepZoom(zoom, -1))}
          >
            −
          </button>
          <output class="plaintext-zoom__value">{`${percent}%`}</output>
          <button
            type="button"
            class="button button--secondary"
            aria-label={v.zoomIn}
            disabled={zoom >= lastZoom}
            onClick={() => setZoom(stepZoom(zoom, 1))}
          >
            +
          </button>
          {FITS.map((option) => (
            <button
              key={option}
              type="button"
              class="button button--secondary"
              aria-pressed={fit === option && zoom === 100}
              onClick={() => setFit(option)}
            >
              {option === 'page' ? v.fitPage : v.fitWidth}
            </button>
          ))}
        </div>
        {/* In de balk zelf: op een klein scherm kost een eigen regel te veel ruimte. */}
        <p class="triage-meta" data-tip={entry.name}>
          {meta}
        </p>
      </Bar>
      <div class="plaintext-preview" ref={wrap}>
        {info && 'error' in info ? (
          <p class="compare-visual__msg" role="alert">
            {t.compare.errors[info.error]}
          </p>
        ) : drawn && 'error' in drawn ? (
          <p class="compare-visual__msg">{v.error}</p>
        ) : (
          <div
            class="plaintext-preview__page"
            style={{ width: `${widths.css}px`, height: `${widths.css / ratio}px` }}
          >
            {drawn && (
              <CanvasBox
                canvas={drawn.canvas}
                width={widths.css}
                label={format(v.canvas, { n: page })}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** Een getekend canvas op zijn weergavebreedte (getekend is het fijner, zie `targetWidths`). */
function CanvasBox({
  canvas,
  width,
  label,
}: {
  canvas: HTMLCanvasElement;
  width: number;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    canvas.className = 'plaintext-preview__canvas';
    canvas.style.width = `${width}px`;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
    box.current?.replaceChildren(canvas);
  }, [canvas, width, label]);
  return <div ref={box} />;
}

/** De woorden van de lijsten in de taal van de app. */
const exportTexts = (t: Texts): ExportTexts => t.triage.export;

/**
 * Het overzicht: de groepen (verplaatsen per map), en de lijst downloaden als .txt of .csv, zoals
 * pdf-triage.html, met de datum en tijd in de naam. Per PDF kun je het besluit nog wijzigen, en
 * alle PDF's die nog niet beoordeeld zijn in één keer naar een map sturen, zoals in DocumentTriage.
 */
function Overview() {
  const { t } = useI18n();
  const tr = t.triage;
  const o = tr.overview;
  const { files } = useTriageState();
  const [status, setStatus] = useState<string | null>(null);
  const all = groups(files);
  const save = (extension: 'txt' | 'csv') => {
    const name = exportName(new Date(), extension);
    const text =
      extension === 'txt' ? triageTxt(files, exportTexts(t)) : triageCsv(files, exportTexts(t));
    downloadFile(
      new TextEncoder().encode(text),
      name,
      extension === 'txt' ? 'text/plain' : 'text/csv',
    );
    setStatus(format(o.downloaded, { name }));
  };
  const item = (entry: TriageFile) => (
    <li key={entry.id} class="triage-group__item">
      <span class="triage-list__dot" aria-hidden="true" />
      <span class="triage-list__name">{entry.name}</span>
      {isMove(entry.decision) && (
        <span class="triage-group__folder">
          <span aria-hidden="true">→ </span>
          <span class="visually-hidden">{`${tr.moveTo} `}</span>
          {entry.decision.move}
        </span>
      )}
      <Change entry={entry} />
    </li>
  );
  return (
    <>
      <Bar>
        <div class="plaintext-bar__actions">
          <button
            type="button"
            class="button button--secondary"
            disabled={files.length === 0}
            onClick={() => save('txt')}
          >
            {o.txt}
          </button>
          <button
            type="button"
            class="button button--secondary"
            disabled={files.length === 0}
            onClick={() => save('csv')}
          >
            {o.csv}
          </button>
        </div>
      </Bar>
      {status && (
        <p class="plaintext__done" role="status">
          {status}
        </p>
      )}
      {files.length === 0 && <p class="compare__placeholder">{o.empty}</p>}
      {(['keep', 'move', 'remove', 'none'] as const).map((key) =>
        all[key].length === 0 ? null : (
          <section key={key} class={`triage-group triage-group--${key}`}>
            <div class="triage-group__head">
              <h2 class="triage-group__title">{format(o[key], { n: all[key].length })}</h2>
              {key === 'none' && (
                <button
                  type="button"
                  class="button button--secondary triage-group__all"
                  onClick={() => askFolder({ kind: 'undecided' })}
                >
                  {o.moveAll}
                </button>
              )}
            </div>
            <ul class="triage-group__list">
              {key === 'move'
                ? byFolder(files).flatMap(({ files: moved }) => moved.map(item))
                : all[key].map(item)}
            </ul>
          </section>
        ),
      )}
    </>
  );
}

/** Het besluit voor één PDF in het overzicht wijzigen: bewaren, verplaatsen (venster) of verwijderen. */
function Change({ entry }: { entry: TriageFile }) {
  const { t } = useI18n();
  const o = t.triage.overview;
  const set = (choice: 'keep' | 'remove') =>
    setDecision(entry.id, entry.decision === choice ? null : choice);
  return (
    <span class="triage-change" role="group" aria-label={format(o.change, { name: entry.name })}>
      <button
        type="button"
        class="triage-change__button"
        aria-label={format(o.setKeep, { name: entry.name })}
        aria-pressed={entry.decision === 'keep'}
        data-tip={t.triage.keep}
        onClick={() => set('keep')}
      >
        ✓
      </button>
      <button
        type="button"
        class="triage-change__button"
        aria-label={format(o.setMove, { name: entry.name })}
        aria-pressed={isMove(entry.decision)}
        data-tip={t.triage.moveTo}
        onClick={() => askFolder({ kind: 'file', id: entry.id })}
      >
        →
      </button>
      <button
        type="button"
        class="triage-change__button"
        aria-label={format(o.setRemove, { name: entry.name })}
        aria-pressed={entry.decision === 'remove'}
        data-tip={t.triage.remove}
        onClick={() => set('remove')}
      >
        ✕
      </button>
    </span>
  );
}

/**
 * Het venster "Verplaatsen naar een map": een naam typen (een nieuwe map), of een gekozen map
 * aanklikken. Enter verplaatst, Escape of Annuleren sluit. Een lege naam geeft een melding.
 */
function FolderDialog() {
  const { asking } = useTriageState();
  return asking ? <FolderForm undecided={asking.kind === 'undecided'} /> : null;
}

function FolderForm({ undecided }: { undecided: boolean }) {
  const { t } = useI18n();
  const d = t.triage.folderDialog;
  const { folders } = useTriageState();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [empty, setEmpty] = useState(false);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', '');
    input.current?.focus();
    return () => {
      if (element.open && typeof element.close === 'function') element.close();
    };
  }, []);

  const sorted = sortFolders(folders);
  return (
    <dialog
      ref={dialog}
      class="save-dialog triage-folder-dialog"
      aria-labelledby="triage-folder-title"
      onCancel={(event) => {
        event.preventDefault();
        askFolder(null);
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!chooseFolder(value)) setEmpty(true);
        }}
      >
        <h2 id="triage-folder-title" class="save-dialog__title">
          {undecided ? d.titleUndecided : d.title}
        </h2>
        <label for="triage-folder-name" class="save-dialog__label">
          {d.label}
        </label>
        <input
          ref={input}
          id="triage-folder-name"
          class="save-dialog__input triage-folder-dialog__input"
          type="text"
          value={value}
          spellcheck={false}
          autocomplete="off"
          aria-describedby="triage-folder-hint"
          aria-invalid={empty}
          onInput={(event) => {
            setValue(event.currentTarget.value);
            setEmpty(false);
          }}
        />
        <p id="triage-folder-hint" class="compare-settings__hint">
          {d.hint}
        </p>
        {empty && (
          <p class="triage-folder-dialog__error" role="alert">
            {d.empty}
          </p>
        )}
        {sorted.length > 0 && (
          <div class="triage-folders" role="group" aria-label={d.existing}>
            <span class="triage-folders__label" aria-hidden="true">
              {d.existing}
            </span>
            {sorted.map((folder) => (
              <button
                key={folder}
                type="button"
                class="button button--secondary triage-folder"
                onClick={() => chooseFolder(folder)}
              >
                <span class="triage-folder__name">{folder}</span>
              </button>
            ))}
          </div>
        )}
        <div class="save-dialog__actions">
          <button type="button" class="button button--secondary" onClick={() => askFolder(null)}>
            {d.cancel}
          </button>
          <button type="submit" class="button">
            {d.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}
