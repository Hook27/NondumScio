import { useEffect, useRef, useState } from 'preact/hooks';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useDocument } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import { canRemove, removePages, rotatePages, type PageItem } from '../pages/plan';
import {
  emptySelection,
  keepExisting,
  selectAll,
  selectByClick,
  type Selection,
} from '../pages/selection';
import { PdfSaveError, buildPdf, downloadPdf, editedFileName } from '../pdf/save';
import { Thumbnail } from './Thumbnail';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; code: 'encrypted' | 'failed' };

/** Is de toetsenbordfocus in een tekstveld? Dan laten we sneltoetsen met rust. */
function typingIn(target: EventTarget | null) {
  return (
    target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]')
  );
}

/**
 * Pagina's kiezen, draaien en verwijderen, met ongedaan maken, en het resultaat als nieuwe
 * PDF downloaden. Het origineel blijft onaangeroerd.
 */
export function PageEditor({
  docId,
  name,
  file,
  pdf,
}: {
  docId: number;
  name: string;
  file: File;
  pdf: PDFDocumentProxy;
}) {
  const { pages, edit, undo, redo, canUndo, canRedo, unsaved, markSaved } = useDocument();
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

  // Ctrl+Z en Ctrl+Y (of Ctrl+Shift+Z) werken overal op de pagina, behalve in tekstvelden.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || typingIn(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        redo();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [undo, redo]);

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
    const key = pages[active]?.key;
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
      const target = Math.max(0, Math.min(active + moves[event.key]!, pages.length - 1));
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

  const download = async () => {
    setSave({ status: 'saving' });
    try {
      const bytes = await buildPdf(new Uint8Array(await file.arrayBuffer()), pages);
      const fileName = editedFileName(name, t.pages.editedSuffix);
      downloadPdf(bytes, fileName);
      markSaved();
      setSave({ status: 'saved', fileName });
    } catch (error) {
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
    }
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
          <button type="button" class="button button--secondary" disabled={!canUndo} onClick={undo}>
            {t.pages.undo}
          </button>
          <button type="button" class="button button--secondary" disabled={!canRedo} onClick={redo}>
            {t.pages.redo}
          </button>
        </div>
        <div class="toolbar__group toolbar__group--end">
          <button
            type="button"
            class="button"
            disabled={save.status === 'saving'}
            onClick={() => void download()}
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
        class="thumbs thumbs--selectable"
        role="listbox"
        aria-multiselectable="true"
        aria-label={format(t.pages.list, { name })}
        onKeyDown={onListKey}
      >
        {pages.map((page, index) => {
          const isSelected = selected.has(page.key);
          const label = [
            format(t.document.page, { n: index + 1 }),
            page.rotation ? format(t.pages.rotated, { n: page.rotation }) : '',
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <div
              key={`${docId}-${page.key}`}
              role="option"
              class={`page-option${isSelected ? ' page-option--selected' : ''}`}
              aria-selected={isSelected}
              aria-label={label}
              tabIndex={index === active ? 0 : -1}
              onClick={(event) => {
                setActive(index);
                setSelection((current) =>
                  selectByClick(current, order, page.key, {
                    toggle: event.ctrlKey || event.metaKey,
                    range: event.shiftKey,
                  }),
                );
              }}
            >
              <Thumbnail
                pdf={pdf}
                pageNumber={page.source + 1}
                rotation={page.rotation}
                caption={index + 1}
                label={label}
                decorative
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
