import { useRef, useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useUndoShortcuts } from '../document/useUndoShortcuts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { PdfSaveError, buildPdf, downloadPdf, editedFileName, readSources } from '../pdf/save';
import { SaveDialog } from './SaveDialog';
import { useDragReorder } from './useDragReorder';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; code: 'encrypted' | 'failed' };

/**
 * Samenvoegen: de bestanden in volgorde, met omhoog, omlaag en weghalen, bestanden
 * toevoegen, en het resultaat als één PDF downloaden. Werkt op dezelfde stand als
 * Pagina's: wat je daar doet, zie je hier, en andersom.
 */
export function MergeView() {
  const {
    doc,
    pages,
    activeSources,
    add,
    adding,
    removeSource,
    moveSource,
    moveSourceTo,
    undo,
    redo,
    canUndo,
    canRedo,
    unsaved,
    markSaved,
  } = useDocument();
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  useUndoShortcuts(undo, redo);

  // Slepen: een bestand oppakken en op een andere plek in de lijst loslaten.
  const list = useRef<HTMLOListElement>(null);
  const { dragged, dropAt, handlers } = useDragReorder<number>({
    list,
    itemSelector: '.merge-list__item',
    direction: 'vertical',
    onDrop: (id, target) => moveSourceTo(id, target),
  });

  const first = activeSources[0];
  const suggestion = first ? editedFileName(first.name, t.merge.suffix) : '';
  const countOf = (id: number) => pages.filter((page) => page.doc === id).length;

  const saveAs = async (fileName: string) => {
    setAsking(false);
    setSave({ status: 'saving' });
    try {
      const files = new Map(
        (doc.status === 'ready' ? doc.sources : []).map((source) => [source.id, source.file]),
      );
      const bytes = await buildPdf(await readSources(files, pages), pages);
      downloadPdf(bytes, fileName);
      markSaved();
      setSave({ status: 'saved', fileName });
    } catch (error) {
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
    }
  };

  return (
    <div class="merge">
      <p class="merge__hint">{t.merge.hint}</p>
      <ol
        ref={list}
        class={`merge-list${dragged !== null ? ' merge-list--dragging' : ''}`}
        aria-label={t.merge.files}
      >
        {activeSources.map((source, index) => {
          const classes = [
            'merge-list__item',
            dragged === source.id && 'merge-list__item--dragging',
            dropAt === index && 'merge-list__item--drop-before',
            dropAt === activeSources.length &&
              index === activeSources.length - 1 &&
              'merge-list__item--drop-after',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li key={source.id} class={classes} data-index={index} {...handlers(source.id)}>
              {/* Alleen voor muis en vinger; met het toetsenbord gaan de pijlknoppen. */}
              <span class="drag-handle merge-list__handle" aria-hidden="true">
                ⠿
              </span>
              <span class="merge-list__position" aria-hidden="true">
                {index + 1}
              </span>
              <span class="merge-list__name">{source.name}</span>
              <span class="merge-list__pages">
                {plural(countOf(source.id), t.document.pagesOne, t.document.pagesOther)}
              </span>
              <span class="merge-list__actions">
                <button
                  type="button"
                  class="button button--secondary button--icon"
                  aria-label={format(t.merge.moveUp, { name: source.name })}
                  title={format(t.merge.moveUp, { name: source.name })}
                  disabled={index === 0}
                  onClick={() => moveSource(source.id, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="button button--secondary button--icon"
                  aria-label={format(t.merge.moveDown, { name: source.name })}
                  title={format(t.merge.moveDown, { name: source.name })}
                  disabled={index === activeSources.length - 1}
                  onClick={() => moveSource(source.id, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  class="button button--secondary button--icon"
                  aria-label={format(t.merge.remove, { name: source.name })}
                  title={
                    activeSources.length === 1
                      ? t.merge.keepOne
                      : format(t.merge.remove, { name: source.name })
                  }
                  disabled={activeSources.length === 1}
                  onClick={() => removeSource(source.id)}
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ol>

      <div class="toolbar" role="toolbar" aria-label={t.merge.files}>
        <div class="toolbar__group">
          <input
            id="merge-add"
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
          <label for="merge-add" class="button button--secondary">
            {adding ? t.merge.adding : t.merge.add}
          </label>
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
            disabled={save.status === 'saving' || !first}
            onClick={() => setAsking(true)}
          >
            {save.status === 'saving' ? t.pages.saving : t.merge.download}
          </button>
        </div>
      </div>

      {unsaved && <p class="page-editor__status">{t.pages.unsaved}</p>}
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
          title={t.merge.saveTitle}
          suggestion={suggestion}
          onConfirm={(fileName) => void saveAs(fileName)}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}
