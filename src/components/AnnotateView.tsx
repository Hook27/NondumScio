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
  moved,
  tooSmall,
  unsupportedChars,
  type Annotation,
  type Tool,
} from '../annotations/model';
import { PdfSaveError, buildPdf, downloadPdf, editedFileName, readSources } from '../pdf/save';
import { AnnotatePage, type AnnotateController } from './AnnotatePage';
import { Icon, IconButton } from './Icon';
import { SaveDialog } from './SaveDialog';
import { Split, useInfo } from './WorkspaceParts';

/** De zoomstanden, als factor van "past op de breedte van het vak". */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const FIT = ZOOMS.indexOf(1);

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; code: 'encrypted' | 'failed' };

/** Het gereedschap met zijn symbool en de sneltoets. */
const TOOLS = [
  { id: 'select', icon: 'cursor', key: 'v' },
  { id: 'text', icon: 'textTool', key: 't' },
  { id: 'highlight', icon: 'highlighter', key: 'h' },
  { id: 'rect', icon: 'rectangle', key: 'r' },
  { id: 'line', icon: 'lineTool', key: 'l' },
] as const;

type DrawingTool = Exclude<Tool, 'select'>;

/**
 * Bewerken: tekst, markeringen en vormen op de pagina's zetten, met een grote paginaweergave
 * en zoomen. De bediening (bestanden, ongedaan maken, downloaden) is zoals bij de andere taken;
 * annotaties horen bij hun pagina en worden bij het downloaden in de pagina zelf getekend.
 */
export function AnnotateView() {
  const {
    doc,
    pages,
    activeSources,
    sourceOf,
    annotations,
    annotate,
    newAnnotationId,
    undoAnnotation,
    redoAnnotation,
    canUndoAnnotation,
    canRedoAnnotation,
    add,
    adding,
    markSaved,
    unsaved,
  } = useDocument();
  const { t } = useI18n();
  const info = useInfo(
    <>
      <p>{t.edit.hint}</p>
      <p>{t.edit.shortcuts}</p>
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

  // Het concept (wat je nu tekent, sleept of typt) staat ook in een ref, zodat twee handelingen
  // vlak na elkaar (zoals een klik naast het tekstveld, waarna het veld zijn focus verliest)
  // het niet dubbel vastleggen.
  const [draft, setDraftState] = useState<Annotation | null>(null);
  const draftRef = useRef<Annotation | null>(null);
  const setDraft = (annotation: Annotation | null) => {
    draftRef.current = annotation;
    setDraftState(annotation);
  };

  useUndoShortcuts(undoAnnotation, redoAnnotation);

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
        strokeWidth,
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
      const match = TOOLS.find((entry) => entry.key === key);
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
  const suggestion = first ? editedFileName(first.name, t.edit.suffix) : '';
  const saveAs = async (fileName: string) => {
    setAsking(false);
    setSave({ status: 'saving' });
    try {
      const files = new Map(
        (doc.status === 'ready' ? doc.sources : []).map((source) => [source.id, source.file]),
      );
      const bytes = await buildPdf(await readSources(files, pages), pages, { annotations });
      downloadPdf(bytes, fileName);
      markSaved();
      setSave({ status: 'saved', fileName });
    } catch (error) {
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
    }
  };

  const used = annotations.filter((a) => pages.some((page) => page.key === a.page));
  const unsupported = unsupportedChars(
    [...used, ...(draft ? [draft] : [])].map((a) => (a.kind === 'text' ? a.text : '')).join(''),
  );
  const zoom = ZOOMS[zoomIndex]!;
  const percent = Math.round(zoom * 100);
  const busy = save.status === 'saving';

  return (
    <Split
      tools={
        <div class="merge annotate">
          <span id="annotate-help" class="visually-hidden">
            {t.edit.pageHelp}
          </span>
          <div class="toolbar toolbar--tools" role="toolbar" aria-label={t.edit.toolbar}>
            <div class="toolbar__group" role="group" aria-label={t.edit.tools}>
              {TOOLS.map((entry) => (
                <IconButton
                  key={entry.id}
                  icon={entry.icon}
                  label={t.edit[entry.id]}
                  tip={`${t.edit[entry.id]} (${entry.key.toUpperCase()})`}
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
                disabled={!canUndoAnnotation}
                onClick={undoAnnotation}
              />
              <IconButton
                icon="redo"
                label={t.pages.redo}
                tip={`${t.pages.redo} (Ctrl + Y)`}
                disabled={!canRedoAnnotation}
                onClick={redoAnnotation}
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
                {adding ? t.merge.adding : t.pages.addPdf}
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

          <div class="tools-status">
            <p class="page-editor__status" aria-live="polite">
              {[
                used.length === 0
                  ? t.edit.none
                  : plural(used.length, t.edit.countOne, format(t.edit.count, { n: used.length })),
                unsaved && t.pages.unsaved,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {info.button}
          </div>
          {info.panel}
          {unsupported.length > 0 && (
            <p class="page-editor__error" role="status">
              {format(t.edit.unsupported, { chars: unsupported.join(' ') })}
            </p>
          )}
          {save.status === 'saved' && (
            <p class="page-editor__saved" role="status">
              {format(t.pages.saved, { name: save.fileName })}
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
        <ol ref={container} class="annotate-pages" aria-label={t.edit.pages}>
          {pages.map((page, index) => {
            const source = sourceOf(page);
            if (!source) return null;
            return (
              <li key={page.key} class="annotate-pages__item">
                <p class="annotate-pages__caption">
                  {format(t.document.page, { n: index + 1 })}
                  {activeSources.length > 1 && ` · ${source.name}`}
                </p>
                <AnnotatePage
                  pdf={source.pdf}
                  item={page}
                  position={index + 1}
                  fitWidth={fitWidth}
                  zoom={zoom}
                  annotations={annotationsOf(annotations, page.key)}
                  controller={controller}
                />
              </li>
            );
          })}
        </ol>
      }
    />
  );
}
