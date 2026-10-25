import { useEffect, useRef, useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useUndoShortcuts } from '../document/useUndoShortcuts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import {
  canRemove,
  movePages,
  movePagesBy,
  pickPages,
  removePages,
  rotatePages,
  type PageItem,
} from '../pages/plan';
import { formatRanges } from '../pages/ranges';
import {
  emptySelection,
  keepExisting,
  selectAll,
  selectByClick,
  type Selection,
} from '../pages/selection';
import { PdfSaveError, buildPdf, downloadPdf, editedFileName, readSources } from '../pdf/save';
import { FileList } from './FilesParts';
import { Icon, IconButton, TipAnchor } from './Icon';
import { SaveDialog } from './SaveDialog';
import { useDragReorder } from './useDragReorder';
import { PaneHead, Split, useInfo } from './WorkspaceParts';
import { Thumbnail } from './Thumbnail';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; code: 'encrypted' | 'failed' };

/**
 * Pagina's kiezen, draaien, verwijderen, verplaatsen en uitpakken, met ongedaan maken, en
 * het resultaat als nieuwe PDF downloaden. Het origineel blijft onaangeroerd.
 */
export function PageEditor() {
  const {
    doc,
    pages,
    activeSources,
    annotations,
    sourceOf,
    add,
    adding,
    edit,
    undo,
    redo,
    canUndo,
    canRedo,
    unsaved,
    markSaved,
  } = useDocument();
  // De naam van het eerste bestand is de basis voor voorgestelde bestandsnamen.
  const name = activeSources[0]?.name ?? '';
  const multiple = activeSources.length > 1;
  const { t } = useI18n();
  const [selection, setSelection] = useState<Selection>(emptySelection);
  const [active, setActive] = useState(0);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const list = useRef<HTMLDivElement>(null);

  const order = pages.map((page) => page.key);
  const selected = selection.keys;

  // Na verwijderen of ongedaan maken: selectie en focus binnen de bestaande pagina's houden.
  useEffect(() => {
    setSelection((current) => keepExisting(current, order));
    setActive((index) => Math.min(index, Math.max(pages.length - 1, 0)));
    // `order` volgt rechtstreeks uit `pages`.
  }, [pages]);

  const apply = (next: PageItem[]) => {
    edit(next);
    setSave({ status: 'idle' });
  };
  const rotate = (delta: number) => apply(rotatePages(pages, selected, delta));
  const remove = () => {
    if (canRemove(pages, selected)) apply(removePages(pages, selected));
  };

  /**
   * Eén plek naar voren of naar achteren. Met `focusKey` gaat de toetsenbordfocus mee met
   * die pagina naar haar nieuwe plek.
   */
  const moveBy = (keys: ReadonlySet<number>, step: -1 | 1, focusKey?: number) => {
    const next = movePagesBy(pages, keys, step);
    if (next === pages) return;
    apply(next);
    if (focusKey !== undefined) {
      const index = next.findIndex((page) => page.key === focusKey);
      // Pas na het tekenen van de nieuwe volgorde.
      requestAnimationFrame(() => focusOption(index));
    }
  };

  useUndoShortcuts(undo, redo);

  const focusOption = (index: number) => {
    const target = Math.max(0, Math.min(index, pages.length - 1));
    setActive(target);
    list.current?.querySelectorAll<HTMLElement>('[role="option"]')[target]?.focus();
  };

  /** Hoeveel miniaturen er naast elkaar staan, voor pijltje omhoog en omlaag. */
  const columns = () => {
    const options = [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    const top = options[0]?.offsetTop;
    const count = options.filter((option) => option.offsetTop === top).length;
    return Math.max(count, 1);
  };

  const onListKey = (event: KeyboardEvent) => {
    // De pagina waar de toetsenbordfocus echt staat (betrouwbaarder dan de bewaarde plek,
    // die vlak na een verplaatsing nog niet bijgewerkt kan zijn).
    const focused = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="option"]');
    const current = focused ? Number(focused.dataset.index) : active;
    const key = pages[current]?.key;
    if (event.altKey && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      if (key === undefined) return;
      const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
      // De gekozen pagina's; is de pagina met focus niet gekozen, dan alleen die.
      if (selected.has(key)) {
        moveBy(selected, step, key);
      } else {
        const only = new Set([key]);
        setSelection({ keys: only, anchor: key });
        moveBy(only, step, key);
      }
      return;
    }
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns(),
      ArrowUp: -columns(),
      Home: -pages.length,
      End: pages.length,
    };
    if (event.key in moves) {
      event.preventDefault();
      const target = Math.max(0, Math.min(current + moves[event.key]!, pages.length - 1));
      focusOption(target);
      if (event.shiftKey) {
        setSelection((current) =>
          selectByClick(current, order, order[target]!, { range: true, toggle: false }),
        );
      }
      return;
    }
    if (event.key === ' ' && key !== undefined) {
      event.preventDefault();
      setSelection((current) => selectByClick(current, order, key, { toggle: true }));
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelection(selectAll(order));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove();
    } else if (event.key === 'Escape') {
      setSelection(emptySelection);
    }
  };

  /** Wat er na het venster "Opslaan als" gedownload wordt. */
  type SaveRequest = { kind: 'save' | 'extract'; suggestion: string; pages: PageItem[] };
  const [request, setRequest] = useState<SaveRequest | null>(null);

  const askSave = () =>
    setRequest({ kind: 'save', suggestion: editedFileName(name, t.pages.editedSuffix), pages });

  const askExtract = () => {
    const picked = pickPages(pages, selected);
    if (picked.length === 0) return;
    const positions = pages.flatMap((page, i) => (selected.has(page.key) ? [i + 1] : []));
    const suffix = format(t.pages.extractSuffix, { ranges: formatRanges(positions) });
    setRequest({ kind: 'extract', suggestion: editedFileName(name, suffix), pages: picked });
  };

  const saveAs = async (current: SaveRequest, fileName: string) => {
    setRequest(null);
    setSave({ status: 'saving' });
    try {
      const files = new Map(
        (doc.status === 'ready' ? doc.sources : []).map((source) => [source.id, source.file]),
      );
      const bytes = await buildPdf(await readSources(files, current.pages), current.pages, {
        annotations,
      });
      downloadPdf(bytes, fileName);
      // Bij uitpakken is het document zelf niet veranderd: "niet gedownload" blijft wat het was.
      if (current.kind === 'save') markSaved();
      setSave({ status: 'saved', fileName });
    } catch (error) {
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
    }
  };

  /* Slepen: met de muis de hele miniatuur, op een aanraakscherm het greepje. */

  // De pagina's die meegaan: de gekozen pagina's, of alleen de opgepakte als die niet gekozen is.
  const moving = useRef<ReadonlySet<number>>(new Set());
  const { dragged, dropAt, handlers, consumeClick } = useDragReorder<number>({
    list,
    itemSelector: '.thumbs--selectable [role="option"]',
    direction: 'grid',
    onStart: (key) => {
      moving.current = selected.has(key) ? new Set(selected) : new Set([key]);
      if (!selected.has(key)) setSelection({ keys: moving.current, anchor: key });
    },
    onDrop: (_key, target) => apply(movePages(pages, moving.current, target)),
  });
  const dragging = dragged !== null;

  const removable = canRemove(pages, selected);

  const info = useInfo(<p>{t.pages.hint}</p>);

  return (
    <Split
      tools={
        <div class="page-editor">
          <FileList />
          <div class="toolbar toolbar--tools" role="toolbar" aria-label={t.pages.toolbar}>
            <div class="toolbar__group">
              <IconButton
                icon="selectAll"
                label={t.pages.selectAll}
                onClick={() => setSelection(selectAll(order))}
              />
              <IconButton
                icon="selectNone"
                label={t.pages.selectNone}
                disabled={selected.size === 0}
                onClick={() => setSelection(emptySelection)}
              />
            </div>
            <div class="toolbar__group">
              <IconButton
                icon="rotateLeft"
                label={t.pages.rotateLeft}
                disabled={selected.size === 0}
                onClick={() => rotate(-90)}
              />
              <IconButton
                icon="rotateRight"
                label={t.pages.rotateRight}
                disabled={selected.size === 0}
                onClick={() => rotate(90)}
              />
              <IconButton
                icon="trash"
                label={t.pages.remove}
                tip={selected.size > 0 && !removable ? t.pages.keepOne : t.pages.remove}
                disabled={!removable}
                onClick={remove}
              />
            </div>
            <div class="toolbar__group">
              <IconButton
                icon="arrowLeft"
                label={t.pages.moveEarlier}
                tip={`${t.pages.moveEarlier} (Alt + ←)`}
                disabled={selected.size === 0}
                aria-keyshortcuts="Alt+ArrowLeft"
                onClick={() => moveBy(selected, -1)}
              />
              <IconButton
                icon="arrowRight"
                label={t.pages.moveLater}
                tip={`${t.pages.moveLater} (Alt + →)`}
                disabled={selected.size === 0}
                aria-keyshortcuts="Alt+ArrowRight"
                onClick={() => moveBy(selected, 1)}
              />
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
            <div class="toolbar__group toolbar__group--wide">
              <input
                id="add-pdf"
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
              <label for="add-pdf" class="button button--secondary">
                <Icon name="filePlus" />
                {adding ? t.merge.adding : t.merge.add}
              </label>
              <TipAnchor tip={t.pages.extractTitle}>
                <button
                  type="button"
                  class="button button--secondary"
                  disabled={selected.size === 0 || save.status === 'saving'}
                  onClick={askExtract}
                >
                  <Icon name="extract" />
                  {t.pages.extract}
                </button>
              </TipAnchor>
              <button
                type="button"
                class="button"
                disabled={save.status === 'saving'}
                onClick={askSave}
              >
                <Icon name="download" />
                {save.status === 'saving' ? t.pages.saving : t.pages.save}
              </button>
            </div>
          </div>

          <div class="tools-status">
            <p class="page-editor__status" aria-live="polite">
              {format(t.pages.selected, { n: selected.size, total: pages.length })}
              {selected.size > 0 && !removable && ` · ${t.pages.keepOne}`}
              {unsaved && ` · ${t.pages.unsaved}`}
            </p>
            {info.button}
          </div>
          {info.panel}
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
          {request && (
            <SaveDialog
              title={request.kind === 'save' ? t.saveDialog.saveTitle : t.saveDialog.extractTitle}
              suggestion={request.suggestion}
              onConfirm={(fileName) => void saveAs(request, fileName)}
              onCancel={() => setRequest(null)}
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
          <div
            ref={list}
            class={`thumbs thumbs--selectable${dragging ? ' thumbs--dragging' : ''}`}
            role="listbox"
            aria-multiselectable="true"
            aria-label={format(t.pages.list, { name })}
            onKeyDown={onListKey}
          >
            {pages.map((page, index) => {
              const isSelected = selected.has(page.key);
              const classes = [
                'page-option',
                isSelected && 'page-option--selected',
                dragging && isSelected && 'page-option--dragging',
                dropAt === index && 'page-option--drop-before',
                dropAt === pages.length && index === pages.length - 1 && 'page-option--drop-after',
              ]
                .filter(Boolean)
                .join(' ');
              const fileName = multiple ? sourceOf(page)?.name : undefined;
              const label = [
                format(t.document.page, { n: index + 1 }),
                page.rotation ? format(t.pages.rotated, { n: page.rotation }) : '',
                fileName ? format(t.pages.fromFile, { name: fileName }) : '',
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <div
                  key={`page-${page.key}`}
                  role="option"
                  class={classes}
                  data-index={index}
                  data-source={page.source + 1}
                  aria-selected={isSelected}
                  aria-label={label}
                  tabIndex={index === active ? 0 : -1}
                  {...handlers(page.key)}
                  onClick={(event) => {
                    if (consumeClick()) return;
                    setActive(index);
                    // Het vinkje werkt als Ctrl-klik: erbij of eraf, zonder de rest te wissen.
                    // Zo kun je ook op een telefoon (zonder Ctrl of Shift) meer pagina's kiezen.
                    const viaCheckbox = (event.target as HTMLElement | null)?.closest(
                      '.select-box',
                    );
                    setSelection((current) =>
                      selectByClick(current, order, page.key, {
                        toggle: Boolean(viaCheckbox) || event.ctrlKey || event.metaKey,
                        range: !viaCheckbox && event.shiftKey,
                      }),
                    );
                  }}
                >
                  <span class="drag-handle" aria-hidden="true">
                    ⠿
                  </span>
                  {/* Alleen voor het oog: de keuze zelf staat al in aria-selected van de optie. */}
                  <span
                    class={`select-box${isSelected ? ' select-box--checked' : ''}`}
                    aria-hidden="true"
                  >
                    {isSelected ? '✓' : ''}
                  </span>
                  <Thumbnail
                    pdf={sourceOf(page)!.pdf}
                    pageNumber={page.source + 1}
                    rotation={page.rotation}
                    caption={index + 1}
                    label={label}
                    decorative
                  />
                  {fileName && (
                    <span class="page-option__file" aria-hidden="true">
                      {fileName}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      }
    />
  );
}
