import { useEffect, useRef, useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useUndoShortcuts } from '../document/useUndoShortcuts';
import { useI18n } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
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
import { SaveDialog } from './SaveDialog';
import { Thumbnail } from './Thumbnail';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; code: 'encrypted' | 'failed' };

/** Zo ver moet de muis bewegen voordat een klik een sleepbeweging wordt (in pixels). */
const DRAG_THRESHOLD = 6;

type Drag = {
  pointerId: number;
  keys: ReadonlySet<number>;
  /** De pagina waarop het slepen begon. */
  key: number;
  x: number;
  y: number;
  active: boolean;
};

/**
 * Pagina's kiezen, draaien, verwijderen, verplaatsen en uitpakken, met ongedaan maken, en
 * het resultaat als nieuwe PDF downloaden. Het origineel blijft onaangeroerd.
 */
export function PageEditor() {
  const {
    doc,
    pages,
    activeSources,
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
  const drag = useRef<Drag | null>(null);
  // Na een sleepbeweging volgt nog een klik; die mag de selectie niet veranderen.
  const suppressClick = useRef(false);
  // De laatste plek die het streepje aanwees; daar komen de pagina's bij loslaten terecht.
  const lastDrop = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

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
      const bytes = await buildPdf(await readSources(files, current.pages), current.pages);
      downloadPdf(bytes, fileName);
      // Bij uitpakken is het document zelf niet veranderd: "niet gedownload" blijft wat het was.
      if (current.kind === 'save') markSaved();
      setSave({ status: 'saved', fileName });
    } catch (error) {
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
    }
  };

  /* Slepen: met de muis de hele miniatuur, op een aanraakscherm het greepje. */

  /** Waar de pagina's terechtkomen als je hier loslaat (0 = vooraan), of `null`. */
  const dropIndexAt = (x: number, y: number): number | null => {
    const element = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('.thumbs--selectable [role="option"]');
    if (!element || !list.current?.contains(element)) return null;
    const index = Number(element.dataset.index);
    const box = element.getBoundingClientRect();
    return x < box.left + box.width / 2 ? index : index + 1;
  };

  /** Of de muis of vinger ver buiten de miniaturen is (dan breekt loslaten het slepen af). */
  const farOutside = (x: number, y: number) => {
    const box = list.current?.getBoundingClientRect();
    if (!box) return true;
    const margin = 48;
    return (
      x < box.left - margin ||
      x > box.right + margin ||
      y < box.top - margin ||
      y > box.bottom + margin
    );
  };

  /** Werkt de plek van het streepje bij: een nieuwe plek, de vorige, of geen (ver buiten). */
  const updateDrop = (x: number, y: number) => {
    const index = dropIndexAt(x, y);
    if (index !== null) lastDrop.current = index;
    else if (farOutside(x, y)) lastDrop.current = null;
    setDropAt(lastDrop.current);
    return lastDrop.current;
  };

  const endDrag = () => {
    drag.current = null;
    lastDrop.current = null;
    setDragging(false);
    setDropAt(null);
  };

  // Escape breekt het slepen af.
  useEffect(() => {
    if (!dragging) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      suppressClick.current = true;
      endDrag();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dragging]);

  const onPointerDown = (event: PointerEvent, key: number) => {
    if (event.button !== 0) return;
    const fromHandle = (event.target as HTMLElement | null)?.closest('.drag-handle');
    // Op een aanraakscherm alleen via het greepje, zodat gewoon scrollen blijft werken.
    if (event.pointerType === 'touch' && !fromHandle) return;
    drag.current = {
      pointerId: event.pointerId,
      keys: selected.has(key) ? new Set(selected) : new Set([key]),
      key,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
    // Nog niet "vangen": een gewone klik (bijvoorbeeld op het vinkje) moet zijn eigen
    // doel houden. Dat gebeurt pas als het echt slepen wordt.
  };

  const onPointerMove = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.active) {
      const distance = Math.hypot(event.clientX - current.x, event.clientY - current.y);
      if (distance < DRAG_THRESHOLD) return;
      current.active = true;
      // Vanaf nu volgen alle bewegingen deze sleepactie, ook buiten de miniatuur.
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      setDragging(true);
      if (!selected.has(current.key)) setSelection({ keys: current.keys, anchor: current.key });
    }
    event.preventDefault();
    updateDrop(event.clientX, event.clientY);
    // Bij de rand van het venster meeschuiven, maar alleen als er in die richting nog
    // miniaturen buiten beeld staan; anders zou de pagina onder de muis wegschuiven.
    const box = list.current?.getBoundingClientRect();
    if (!box) return;
    if (event.clientY < 40 && box.top < 0) window.scrollBy(0, -16);
    else if (event.clientY > window.innerHeight - 40 && box.bottom > window.innerHeight) {
      window.scrollBy(0, 16);
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.active) {
      suppressClick.current = true;
      const target = updateDrop(event.clientX, event.clientY);
      if (target !== null) apply(movePages(pages, current.keys, target));
    }
    endDrag();
  };

  const removable = canRemove(pages, selected);

  return (
    <div class="page-editor">
      <div class="toolbar" role="toolbar" aria-label={t.pages.toolbar}>
        <div class="toolbar__group">
          <button
            type="button"
            class="button button--secondary"
            onClick={() => setSelection(selectAll(order))}
          >
            {t.pages.selectAll}
          </button>
          <button
            type="button"
            class="button button--secondary"
            disabled={selected.size === 0}
            onClick={() => setSelection(emptySelection)}
          >
            {t.pages.selectNone}
          </button>
        </div>
        <div class="toolbar__group">
          <button
            type="button"
            class="button button--secondary"
            disabled={selected.size === 0}
            onClick={() => rotate(-90)}
          >
            <span aria-hidden="true">↺</span> {t.pages.rotateLeft}
          </button>
          <button
            type="button"
            class="button button--secondary"
            disabled={selected.size === 0}
            onClick={() => rotate(90)}
          >
            <span aria-hidden="true">↻</span> {t.pages.rotateRight}
          </button>
          <button
            type="button"
            class="button button--secondary"
            disabled={!removable}
            title={selected.size > 0 && !removable ? t.pages.keepOne : undefined}
            onClick={remove}
          >
            {t.pages.remove}
          </button>
        </div>
        <div class="toolbar__group">
          <button
            type="button"
            class="button button--secondary"
            disabled={selected.size === 0}
            aria-keyshortcuts="Alt+ArrowLeft"
            onClick={() => moveBy(selected, -1)}
          >
            <span aria-hidden="true">←</span> {t.pages.moveEarlier}
          </button>
          <button
            type="button"
            class="button button--secondary"
            disabled={selected.size === 0}
            aria-keyshortcuts="Alt+ArrowRight"
            onClick={() => moveBy(selected, 1)}
          >
            {t.pages.moveLater} <span aria-hidden="true">→</span>
          </button>
        </div>
        <div class="toolbar__group">
          <button type="button" class="button button--secondary" disabled={!canUndo} onClick={undo}>
            {t.pages.undo}
          </button>
          <button type="button" class="button button--secondary" disabled={!canRedo} onClick={redo}>
            {t.pages.redo}
          </button>
        </div>
        <div class="toolbar__group">
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
            {adding ? t.merge.adding : t.pages.addPdf}
          </label>
        </div>
        <div class="toolbar__group toolbar__group--end">
          <button
            type="button"
            class="button button--secondary"
            disabled={selected.size === 0 || save.status === 'saving'}
            title={t.pages.extractTitle}
            onClick={askExtract}
          >
            {t.pages.extract}
          </button>
          <button
            type="button"
            class="button"
            disabled={save.status === 'saving'}
            onClick={askSave}
          >
            {save.status === 'saving' ? t.pages.saving : t.pages.save}
          </button>
        </div>
      </div>

      <p class="page-editor__status" aria-live="polite">
        {format(t.pages.selected, { n: selected.size, total: pages.length })}
        {selected.size > 0 && !removable && ` · ${t.pages.keepOne}`}
        {unsaved && ` · ${t.pages.unsaved}`}
      </p>
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
      <p class="page-editor__hint">{t.pages.hint}</p>

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
              onPointerDown={(event) => onPointerDown(event, page.key)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={endDrag}
              onClick={(event) => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                setActive(index);
                // Het vinkje werkt als Ctrl-klik: erbij of eraf, zonder de rest te wissen.
                // Zo kun je ook op een telefoon (zonder Ctrl of Shift) meer pagina's kiezen.
                const viaCheckbox = (event.target as HTMLElement | null)?.closest('.select-box');
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
      {request && (
        <SaveDialog
          title={request.kind === 'save' ? t.saveDialog.saveTitle : t.saveDialog.extractTitle}
          suggestion={request.suggestion}
          onConfirm={(fileName) => void saveAs(request, fileName)}
          onCancel={() => setRequest(null)}
        />
      )}
    </div>
  );
}
