import { useEffect, useRef, useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { typingIn, useUndoShortcuts } from '../document/useUndoShortcuts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import {
  COLORS,
  DEFAULT_COLOR,
  DEFAULT_STROKE_WIDTH,
  DEFAULT_TEXT_SIZE,
  LINE_HEIGHT,
  STROKE_WIDTHS,
  TEXT_SIZES,
  annotationsOf,
  boxFrom,
  hasRedactions,
  redactionsOf,
  moved,
  tooSmall,
  unsupportedChars,
  type Annotation,
  type Tool,
} from '../annotations/model';
import {
  PdfSaveError,
  buildPdf,
  downloadPdf,
  editedFileName,
  readSources,
  type SaveErrorCode,
} from '../pdf/save';
import { AnnotatePage, type AnnotateController } from './AnnotatePage';
import { FileList } from './FilesParts';
import { RadioGroup } from './ConvertParts';
import { Icon, IconButton, type IconName } from './Icon';
import { SaveDialog } from './SaveDialog';
import { PaneHead, Split, useInfo } from './WorkspaceParts';
import { DPI_CHOICES } from '../pdf/redactOptions';
import type { RedactionReport } from '../pdf/redact';
import { useRedactSearch } from '../search/useRedactSearch';
import { RedactSearchPanel } from './RedactSearch';
import { OutlinePanel } from './OutlinePanel';

/**
 * De zoomstanden. Bij 25, 33 en 50% staan 4, 3 of 2 pagina's naast elkaar (een overzicht, zoals
 * het raster bij de andere taken); vanaf 75% staat er één pagina per regel, met 100% zo breed
 * als het vak.
 */
const ZOOMS = [
  { percent: 25, columns: 4 },
  { percent: 33, columns: 3 },
  { percent: 50, columns: 2 },
  { percent: 75 },
  { percent: 100 },
  { percent: 125 },
  { percent: 150 },
  { percent: 200 },
  { percent: 300 },
] as const;
const FIT = 4;
/** De ruimte tussen pagina's (in beeldpunten), ook in de stijl. */
const PAGE_GAP = 20;

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; code: SaveErrorCode };

/** Het gereedschap met zijn symbool en de sneltoets. */
const TOOLS = [
  { id: 'select', icon: 'cursor', key: 'v' },
  { id: 'text', icon: 'textTool', key: 't' },
  { id: 'highlight', icon: 'highlighter', key: 'h' },
  { id: 'rect', icon: 'rectangle', key: 'r' },
  { id: 'line', icon: 'lineTool', key: 'l' },
] as const;

/** Bij Redigeren: alleen selecteren en redactievakken zetten. */
const REDACT_TOOLS = [
  { id: 'select', icon: 'cursor', key: 'v' },
  { id: 'redact', icon: 'redactTool', key: 'r' },
] as const;

type DrawingTool = Exclude<Tool, 'select'>;
type ToolEntry = { id: Tool; icon: IconName; key: string };

/**
 * Bewerken: tekst, markeringen en vormen op de pagina's zetten, met een grote paginaweergave
 * en zoomen. De bediening (bestanden, ongedaan maken, downloaden) is zoals bij de andere taken;
 * annotaties horen bij hun pagina en worden bij het downloaden in de pagina zelf getekend.
 *
 * Met `mode="redact"` is het Redigeren: dezelfde weergave, maar met redactievakken als enige
 * gereedschap. Zulke vakken zijn een opdracht: bij het downloaden worden de pagina's waarop ze
 * staan afbeeldingen met het vak zwart erin (zie `pdf/redact.ts`).
 */
export function AnnotateView({ mode = 'annotate' }: { mode?: 'annotate' | 'redact' }) {
  const {
    doc,
    pages,
    activeSources,
    sourceOf,
    annotations,
    redaction,
    setRedaction,
    annotate,
    newAnnotationId,
    undo,
    redo,
    canUndo,
    canRedo,
    add,
    adding,
    markSaved,
    unsaved,
  } = useDocument();
  const { t } = useI18n();
  const redactMode = mode === 'redact';
  const rt = t.redact;
  const tools: readonly ToolEntry[] = redactMode ? REDACT_TOOLS : TOOLS;
  const toolName = (id: Tool) =>
    redactMode ? (id === 'select' ? rt.select : rt.redact) : t.edit[id as Exclude<Tool, 'redact'>];
  const info = useInfo(
    <>
      <p>{redactMode ? rt.hint : t.edit.hint}</p>
      {redactMode && <p>{rt.search.hint}</p>}
      <p>{redactMode ? rt.shortcuts : t.edit.shortcuts}</p>
    </>,
  );

  const [tool, setTool] = useState<Tool>('select');
  const [colors, setColors] = useState<Record<DrawingTool, string>>({ ...DEFAULT_COLOR });
  const [textSize, setTextSize] = useState<number>(DEFAULT_TEXT_SIZE);
  const [strokeWidth, setStrokeWidth] = useState<number>(DEFAULT_STROKE_WIDTH);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [zoomIndex, setZoomIndex] = useState(FIT);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [asking, setAsking] = useState(false);
  const [preview, setPreview] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<RedactionReport | null>(null);
  // Het laden van de tekstherkenning (0 tot 1), en een manier om te stoppen.
  const [ocrLoading, setOcrLoading] = useState<number | null>(null);
  const stopper = useRef<AbortController | null>(null);

  // Het concept (wat je nu tekent, sleept of typt) staat ook in een ref, zodat twee handelingen
  // vlak na elkaar (zoals een klik naast het tekstveld, waarna het veld zijn focus verliest)
  // het niet dubbel vastleggen.
  const [draft, setDraftState] = useState<Annotation | null>(null);
  const draftRef = useRef<Annotation | null>(null);
  const setDraft = (annotation: Annotation | null) => {
    draftRef.current = annotation;
    setDraftState(annotation);
  };

  useUndoShortcuts(undo, redo);

  // Zoeken en markeren (alleen bij Redigeren in beeld): de treffers staan als oranje vakken op de pagina's.
  const search = useRedactSearch({
    pages,
    annotations,
    sourceOf,
    annotate,
    newAnnotationId,
    color: colors.redact,
  });
  useEffect(() => {
    if (search.focus === null) return;
    const shape = document.querySelector(`[data-candidate="${search.focus}"]`);
    shape?.scrollIntoView?.({ block: 'center', inline: 'nearest' });
  }, [search.focus]);

  const selected =
    (draft?.id === selectedId ? draft : annotations.find((a) => a.id === selectedId)) ?? null;
  // Waar de kleur en grootte nu over gaan: de geselecteerde annotatie, of het gekozen gereedschap.
  const subject: DrawingTool | null = selected ? selected.kind : tool === 'select' ? null : tool;

  /* De breedte van het vak, waarop de pagina's passen */

  const container = useRef<HTMLOListElement>(null);
  const [fitWidth, setFitWidth] = useState(0);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => setFitWidth(Math.floor(element.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /* Wat de pagina's mogen doen */

  const controller: AnnotateController = {
    tool,
    selectedId,
    editingId,
    draft,
    preview: redactMode && preview,
    // Bij Redigeren pak je alleen redactievakken aan; de rest van de annotaties staat er alleen.
    interactive: (kind) => !redactMode || kind === 'redact',
    newId: newAnnotationId,
    create: (kind, page, from, to = from) => {
      const id = newAnnotationId();
      if (kind === 'text') {
        // De klik komt ongeveer midden op de eerste regel.
        return {
          id,
          page,
          kind,
          x: from.x,
          y: from.y - (textSize * LINE_HEIGHT) / 2,
          text: '',
          size: textSize,
          color: colors.text,
        };
      }
      if (kind === 'line') {
        return {
          id,
          page,
          kind,
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          color: colors.line,
          strokeWidth,
        };
      }
      return {
        id,
        page,
        kind,
        ...boxFrom(from.x, from.y, to.x, to.y),
        color: colors[kind],
        strokeWidth: kind === 'redact' ? 0 : strokeWidth,
      };
    },
    setDraft,
    commitDraft: () => {
      const current = draftRef.current;
      if (!current) return;
      setDraft(null);
      setEditingId(null);
      if (tooSmall(current)) {
        // Een lege tekst haalt de annotatie weg; een te klein vak is gewoon een klik.
        if (current.kind === 'text') {
          annotate((items) =>
            items.some((a) => a.id === current.id)
              ? items.filter((a) => a.id !== current.id)
              : items,
          );
          setSelectedId(null);
        }
        return;
      }
      annotate((items) =>
        items.some((a) => a.id === current.id)
          ? items.map((a) => (a.id === current.id ? current : a))
          : [...items, current],
      );
      setSelectedId(current.id);
    },
    add: (annotation) => annotate((items) => [...items, annotation]),
    select: setSelectedId,
    edit: setEditingId,
    remove: (id) => {
      annotate((items) => items.filter((a) => a.id !== id));
      setSelectedId(null);
      setEditingId(null);
    },
    nudge: (id, dx, dy) =>
      annotate((items) => items.map((a) => (a.id === id ? moved(a, dx, dy) : a)), `nudge-${id}`),
    toggleCandidate: search.toggle,
    focusedCandidate: search.focus,
  };

  /* Springen naar een pagina (vanuit de bladwijzers): in beeld, met de focus erop, even oplichtend */

  const [flash, setFlash] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );
  const jumpTo = (position: number) => {
    const item = container.current?.children[position] as HTMLElement | undefined;
    if (!item) return;
    item.scrollIntoView?.({ block: 'start' });
    item.querySelector<HTMLElement>('.annotate-page')?.focus({ preventScroll: true });
    setFlash(pages[position]?.key ?? null);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  };

  /* Kleur, lettergrootte en dikte: voor het gereedschap, en voor wat geselecteerd is */

  const restyle = (change: Partial<Annotation>, mergeKey: string) => {
    if (!selected) return;
    const updated = { ...selected, ...change } as Annotation;
    if (draft?.id === selected.id) setDraft(updated);
    else annotate((items) => items.map((a) => (a.id === selected.id ? updated : a)), mergeKey);
  };
  const pickColor = (value: string) => {
    if (subject) setColors((current) => ({ ...current, [subject]: value }));
    restyle({ color: value }, `style-color-${selectedId}`);
  };
  const pickTextSize = (value: number) => {
    setTextSize(value);
    if (selected?.kind === 'text') restyle({ size: value }, `style-size-${selectedId}`);
  };
  const pickStroke = (value: number) => {
    setStrokeWidth(value);
    if (selected && selected.kind !== 'text' && selected.kind !== 'highlight') {
      restyle({ strokeWidth: value }, `style-stroke-${selectedId}`);
    }
  };

  const currentColor = selected?.color ?? (subject ? colors[subject] : null);
  const currentTextSize = selected?.kind === 'text' ? selected.size : textSize;
  const currentStroke =
    selected && (selected.kind === 'rect' || selected.kind === 'line')
      ? selected.strokeWidth
      : strokeWidth;

  /* Sneltoetsen: gereedschap kiezen, annotatie verwijderen */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typingIn(event.target)) return;
      const key = event.key.toLowerCase();
      const match = tools.find((entry) => entry.key === key);
      if (match) {
        setTool(match.id);
        event.preventDefault();
      } else if (event.key === 'Escape') {
        setTool('select');
        setSelectedId(null);
      } else if (
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selectedId !== null &&
        !(event.target instanceof Element && event.target.closest('[data-annotation]'))
      ) {
        controller.remove(selectedId);
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Bij een ander gereedschap hoort geen halve bewerking meer.
  const chooseTool = (next: Tool) => {
    if (editingId !== null) controller.commitDraft();
    setTool(next);
    if (next !== 'select') setSelectedId(null);
  };

  /* Opslaan */

  const first = activeSources[0];
  const suggestion = first
    ? editedFileName(first.name, redactMode ? rt.suffix : t.edit.suffix)
    : '';
  const saveAs = async (fileName: string) => {
    setAsking(false);
    setSave({ status: 'saving' });
    setReport(null);
    setProgress(null);
    setOcrLoading(null);
    const controller = new AbortController();
    stopper.current = controller;
    try {
      const files = new Map(
        (doc.status === 'ready' ? doc.sources : []).map((source) => [source.id, source.file]),
      );
      const bytes = await buildPdf(await readSources(files, pages), pages, {
        annotations,
        redaction: {
          ...redaction,
          onProgress: (done, total) => {
            setOcrLoading(null);
            setProgress({ done, total });
          },
          onDone: setReport,
          onOcrStatus: setOcrLoading,
          signal: controller.signal,
        },
      });
      setProgress(null);
      setOcrLoading(null);
      downloadPdf(bytes, fileName);
      markSaved();
      setSave({ status: 'saved', fileName });
    } catch (error) {
      setProgress(null);
      setOcrLoading(null);
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
    } finally {
      stopper.current = null;
    }
  };

  // Bij Bewerken tellen de annotaties, bij Redigeren de redactievakken.
  const used = annotations.filter(
    (a) => (a.kind === 'redact') === redactMode && pages.some((page) => page.key === a.page),
  );
  const redactedPages = redactMode
    ? pages.filter((page) => redactionsOf(annotationsOf(annotations, page.key)).length > 0).length
    : 0;
  const unsupported = redactMode
    ? []
    : unsupportedChars(
        [...used, ...(draft ? [draft] : [])].map((a) => (a.kind === 'text' ? a.text : '')).join(''),
      );
  const stop = ZOOMS[zoomIndex]!;
  const percent = stop.percent;
  const columns = 'columns' in stop ? stop.columns : 1;
  // In het overzicht delen de pagina's de breedte, met de ruimte ertussen eraf.
  const pageWidth = columns > 1 ? (fitWidth - (columns - 1) * PAGE_GAP) / columns : fitWidth;
  const zoom = 'columns' in stop ? 1 : stop.percent / 100;
  const busy = save.status === 'saving';
  const anyRedaction = hasRedactions(pages, annotations);

  return (
    <Split
      tools={
        <div class="merge annotate">
          <FileList />
          <OutlinePanel dropped={anyRedaction} onJump={jumpTo} />
          <span id="annotate-help" class="visually-hidden">
            {redactMode ? rt.pageHelp : t.edit.pageHelp}
          </span>
          <div
            class="toolbar toolbar--tools"
            role="toolbar"
            aria-label={redactMode ? rt.toolbar : t.edit.toolbar}
          >
            <div class="toolbar__group" role="group" aria-label={t.edit.tools}>
              {tools.map((entry) => (
                <IconButton
                  key={entry.id}
                  icon={entry.icon}
                  label={toolName(entry.id)}
                  tip={`${toolName(entry.id)} (${entry.key.toUpperCase()})`}
                  aria-pressed={tool === entry.id}
                  aria-keyshortcuts={entry.key.toUpperCase()}
                  onClick={() => chooseTool(entry.id)}
                />
              ))}
            </div>
            <div class="toolbar__group">
              <IconButton
                icon="undo"
                label={t.pages.undo}
                tip={`${t.pages.undo} (Ctrl + Z)`}
                disabled={!canUndo}
                onClick={undo}
              />
              <IconButton
                icon="redo"
                label={t.pages.redo}
                tip={`${t.pages.redo} (Ctrl + Y)`}
                disabled={!canRedo}
                onClick={redo}
              />
            </div>
            <div class="toolbar__group" role="group" aria-label={t.edit.zoom}>
              <IconButton
                icon="zoomOut"
                label={t.edit.zoomOut}
                disabled={zoomIndex === 0}
                onClick={() => setZoomIndex(zoomIndex - 1)}
              />
              <button
                type="button"
                class="button button--secondary annotate__zoom"
                aria-label={format(t.edit.zoomReset, { percent })}
                disabled={zoomIndex === FIT}
                onClick={() => setZoomIndex(FIT)}
              >
                {percent}%
              </button>
              <IconButton
                icon="zoomIn"
                label={t.edit.zoomIn}
                disabled={zoomIndex === ZOOMS.length - 1}
                onClick={() => setZoomIndex(zoomIndex + 1)}
              />
            </div>
            <div class="toolbar__group toolbar__group--wide">
              <input
                id="edit-add"
                class="visually-hidden"
                type="file"
                accept="application/pdf,.pdf"
                multiple
                disabled={adding}
                onChange={(event) => {
                  const files = [...(event.currentTarget.files ?? [])];
                  event.currentTarget.value = '';
                  void add(files);
                }}
              />
              <label for="edit-add" class="button button--secondary">
                <Icon name="filePlus" />
                {adding ? t.merge.adding : t.merge.add}
              </label>
              <button
                type="button"
                class="button"
                disabled={busy || !first}
                onClick={() => setAsking(true)}
              >
                <Icon name="download" />
                {busy ? t.pages.saving : t.pages.save}
              </button>
            </div>
          </div>

          {redactMode && <RedactSearchPanel search={search} pages={pages} />}
          {redactMode && (
            <div class="annotate__options">
              <RadioGroup
                legend={rt.resolution}
                name="redact-dpi"
                value={String(redaction.dpi)}
                onChange={(value) => setRedaction({ dpi: Number(value) })}
                options={DPI_CHOICES.map((dpi) => ({
                  value: String(dpi),
                  label: rt[`dpi${dpi}` as 'dpi150' | 'dpi200' | 'dpi300'],
                }))}
              >
                <label class="merge-option">
                  <input
                    type="checkbox"
                    checked={redaction.stripMetadata}
                    onChange={(event) =>
                      setRedaction({ stripMetadata: event.currentTarget.checked })
                    }
                  />
                  {rt.stripMetadata}
                </label>
                <label class="merge-option">
                  <input
                    type="checkbox"
                    checked={redaction.ocr}
                    onChange={(event) => setRedaction({ ocr: event.currentTarget.checked })}
                  />
                  {rt.ocr}
                </label>
                {redaction.ocr && <p class="page-editor__status">{rt.ocrHelp}</p>}
                <label class="merge-option">
                  <input
                    type="checkbox"
                    checked={preview}
                    onChange={(event) => setPreview(event.currentTarget.checked)}
                  />
                  {rt.preview}
                </label>
                {selected && (
                  <div class="annotate__row">
                    <button
                      type="button"
                      class="button button--secondary"
                      onClick={() => controller.remove(selected.id)}
                    >
                      <Icon name="trash" />
                      {t.edit.remove}
                    </button>
                  </div>
                )}
              </RadioGroup>
            </div>
          )}
          {!redactMode && (
            <fieldset class="split-method annotate__options">
              <legend class="split-method__legend">{t.edit.options}</legend>
              {!(subject && currentColor) && <p class="annotate__hint">{t.edit.optionsHint}</p>}
              {subject && currentColor && (
                <>
                  <div class="annotate__row" role="group" aria-label={t.edit.color}>
                    {COLORS.map((color) => (
                      <button
                        key={color.id}
                        type="button"
                        class="swatch"
                        style={{ backgroundColor: color.value }}
                        aria-label={t.edit.colors[color.id]}
                        aria-pressed={currentColor.toLowerCase() === color.value}
                        onClick={() => pickColor(color.value)}
                      />
                    ))}
                  </div>
                  {subject === 'text' && (
                    <div class="convert__field">
                      <label for="annotate-size" class="convert__label">
                        {t.edit.textSize}
                      </label>
                      <select
                        id="annotate-size"
                        class="convert__select"
                        value={currentTextSize}
                        onChange={(event) => pickTextSize(Number(event.currentTarget.value))}
                      >
                        {[...new Set<number>([...TEXT_SIZES, currentTextSize])]
                          .sort((a, b) => a - b)
                          .map((size) => (
                            <option key={size} value={size}>
                              {size} pt
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                  {(subject === 'rect' || subject === 'line') && (
                    <div class="convert__field">
                      <label for="annotate-stroke" class="convert__label">
                        {t.edit.strokeWidth}
                      </label>
                      <select
                        id="annotate-stroke"
                        class="convert__select"
                        value={currentStroke}
                        onChange={(event) => pickStroke(Number(event.currentTarget.value))}
                      >
                        {[...new Set<number>([...STROKE_WIDTHS, currentStroke])]
                          .sort((a, b) => a - b)
                          .map((width) => (
                            <option key={width} value={width}>
                              {width} pt
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                  {selected && (
                    <div class="annotate__row">
                      <button
                        type="button"
                        class="button button--secondary"
                        onClick={() => controller.remove(selected.id)}
                      >
                        <Icon name="trash" />
                        {t.edit.remove}
                      </button>
                    </div>
                  )}
                </>
              )}
            </fieldset>
          )}

          <div class="tools-status">
            <p class="page-editor__status" aria-live="polite">
              {ocrLoading !== null
                ? format(rt.ocrLoading, { percent: Math.round(ocrLoading * 100) })
                : progress
                  ? format(rt.progress, progress)
                  : [
                      used.length === 0
                        ? redactMode
                          ? rt.none
                          : t.edit.none
                        : redactMode
                          ? plural(used.length, rt.countOne, format(rt.count, { n: used.length }))
                          : plural(
                              used.length,
                              t.edit.countOne,
                              format(t.edit.count, { n: used.length }),
                            ),
                      unsaved && t.pages.unsaved,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
            </p>
            {info.button}
          </div>
          {redactMode && busy && (
            <div class="annotate__row">
              <button
                type="button"
                class="button button--secondary"
                onClick={() => stopper.current?.abort()}
              >
                {rt.stop}
              </button>
            </div>
          )}
          {info.panel}
          {redactMode && redactedPages > 0 && (
            <p class="page-editor__status">
              {redaction.ocr
                ? plural(
                    redactedPages,
                    rt.affectedOcrOne,
                    format(rt.affectedOcrOther, { n: redactedPages }),
                  )
                : plural(
                    redactedPages,
                    rt.affectedOne,
                    format(rt.affectedOther, { n: redactedPages }),
                  )}
            </p>
          )}
          {!redactMode && anyRedaction && (
            <p class="page-editor__status">
              {plural(
                pages.filter(
                  (page) => redactionsOf(annotationsOf(annotations, page.key)).length > 0,
                ).length,
                rt.affectedOne,
                format(rt.affectedOther, {
                  n: pages.filter(
                    (page) => redactionsOf(annotationsOf(annotations, page.key)).length > 0,
                  ).length,
                }),
              )}
            </p>
          )}
          {unsupported.length > 0 && (
            <p class="page-editor__error" role="status">
              {format(t.edit.unsupported, { chars: unsupported.join(' ') })}
            </p>
          )}
          {save.status === 'saved' && (
            <p class="page-editor__saved" role="status">
              {format(t.pages.saved, { name: save.fileName })}
              {report && report.pages.length > 0 && (
                <>
                  {report.pages.length > report.recognized.length && (
                    <>
                      {' '}
                      {plural(
                        report.pages.length - report.recognized.length,
                        rt.verifiedOne,
                        format(rt.verifiedOther, {
                          n: report.pages.length - report.recognized.length,
                        }),
                      )}
                    </>
                  )}
                  {report.recognized.length > 0 && (
                    <>
                      {' '}
                      {plural(
                        report.recognized.length,
                        rt.recognizedOne,
                        format(rt.recognizedOther, { n: report.recognized.length }),
                      )}
                    </>
                  )}
                  {report.reduced && ` ${t.convert.reduced}`}
                </>
              )}
            </p>
          )}
          {save.status === 'error' && (
            <p class="page-editor__error" role="alert">
              {t.pages.errors[save.code]}
            </p>
          )}
          {asking && (
            <SaveDialog
              title={t.saveDialog.saveTitle}
              suggestion={suggestion}
              onConfirm={(fileName) => void saveAs(fileName)}
              onCancel={() => setAsking(false)}
            />
          )}
        </div>
      }
      view={
        <>
          <PaneHead
            title={t.merge.result}
            meta={plural(pages.length, t.document.pagesOne, t.document.pagesOther)}
          />
          <ol ref={container} class="annotate-pages" aria-label={t.edit.pages}>
            {pages.map((page, index) => {
              const source = sourceOf(page);
              if (!source) return null;
              return (
                <li
                  key={page.key}
                  class={`annotate-pages__item${flash === page.key ? ' annotate-pages__item--flash' : ''}`}
                >
                  <p class="annotate-pages__caption">
                    {format(t.document.page, { n: index + 1 })}
                    {activeSources.length > 1 && ` · ${source.name}`}
                  </p>
                  <AnnotatePage
                    pdf={source.pdf}
                    item={page}
                    position={index + 1}
                    fitWidth={pageWidth}
                    zoom={zoom}
                    annotations={annotationsOf(annotations, page.key)}
                    candidates={
                      redactMode ? search.candidates.filter((c) => c.page === page.key) : undefined
                    }
                    controller={controller}
                  />
                </li>
              );
            })}
          </ol>
        </>
      }
    />
  );
}
