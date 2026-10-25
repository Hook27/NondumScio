import { useEffect, useRef, useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useUndoShortcuts } from '../document/useUndoShortcuts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { PdfSaveError, buildPdf, downloadPdf, editedFileName, readSources } from '../pdf/save';
import { Icon, IconButton } from './Icon';
import { PagePicker, RangeField } from './MergePages';
import { SaveDialog } from './SaveDialog';
import { useDragReorder } from './useDragReorder';
import { PageThumbs, PaneHead, Split, useInfo } from './WorkspaceParts';

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
    setSourcePages,
    undo,
    redo,
    canUndo,
    canRedo,
    unsaved,
    markSaved,
    bookmarks,
    setBookmarksOn,
    setBookmarkTitle,
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

  // Welk bestand rechts zijn pagina's met vinkjes toont (anders: het resultaat).
  const [picking, setPicking] = useState<number | null>(null);
  const pickingSource = activeSources.find((source) => source.id === picking);
  // Bij wisselen van het rechtervak gaat de focus naar de kop daarvan: zo komt het op een
  // telefoon in beeld, en weet een schermlezer dat er iets veranderd is.
  const switched = useRef(false);
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    document.getElementById('merge-view-title')?.focus();
  }, [picking]);
  const showPicker = (id: number | null) => {
    switched.current = true;
    setPicking(id);
  };
  const info = useInfo(
    <>
      <p>{t.merge.hint}</p>
      <p>{t.merge.pagesHint}</p>
      <p>{t.merge.bookmarksHint}</p>
    </>,
  );

  const first = activeSources[0];
  const suggestion = first ? editedFileName(first.name, t.merge.suffix) : '';
  // Per bestand: welke pagina's meedoen en met welke extra draaiing.
  const chosenOf = (id: number) =>
    new Set(pages.filter((page) => page.doc === id).map((page) => page.source));
  const rotationsOf = (id: number) =>
    new Map(pages.filter((page) => page.doc === id).map((page) => [page.source, page.rotation]));

  // De titel van de bladwijzer voor een bestand: eigen titel, anders de naam zonder .pdf.
  const defaultTitle = (name: string) => name.replace(/\.pdf$/i, '');
  const titleOf = (id: number, name: string) =>
    bookmarks.titles.get(id)?.trim() || defaultTitle(name);

  const saveAs = async (fileName: string) => {
    setAsking(false);
    setSave({ status: 'saving' });
    try {
      const files = new Map(
        (doc.status === 'ready' ? doc.sources : []).map((source) => [source.id, source.file]),
      );
      const options = bookmarks.on
        ? {
            bookmarks: activeSources.map((source) => ({
              doc: source.id,
              title: titleOf(source.id, source.name),
            })),
          }
        : {};
      const bytes = await buildPdf(await readSources(files, pages), pages, options);
      downloadPdf(bytes, fileName);
      markSaved();
      setSave({ status: 'saved', fileName });
    } catch (error) {
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
    }
  };

  return (
    <Split
      tools={
        <div class="merge">
          <ol
            ref={list}
            class={`merge-list${dragged !== null ? ' merge-list--dragging' : ''}`}
            aria-label={t.merge.files}
          >
            {activeSources.map((source, index) => {
              const classes = [
                'merge-list__item',
                dragged === source.id && 'merge-list__item--dragging',
                picking === source.id && 'merge-list__item--picking',
                dropAt === index && 'merge-list__item--drop-before',
                dropAt === activeSources.length &&
                  index === activeSources.length - 1 &&
                  'merge-list__item--drop-after',
              ]
                .filter(Boolean)
                .join(' ');
              const chosen = chosenOf(source.id);
              const removeLabel = format(t.merge.remove, { name: source.name });
              return (
                <li key={source.id} class={classes} data-index={index} {...handlers(source.id)}>
                  <div class="merge-list__head">
                    {/* Alleen voor muis en vinger; met het toetsenbord gaan de pijlknoppen. */}
                    <span class="drag-handle merge-list__handle" aria-hidden="true">
                      ⠿
                    </span>
                    <span class="merge-list__position" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span class="merge-list__name" data-tip={source.name}>
                      {source.name}
                    </span>
                    <span class="merge-list__pages">
                      {chosen.size < source.pageCount
                        ? format(t.merge.pagesChosen, { n: chosen.size, total: source.pageCount })
                        : plural(chosen.size, t.document.pagesOne, t.document.pagesOther)}
                    </span>
                  </div>
                  <div class="merge-list__tools">
                    <RangeField
                      source={source}
                      chosen={chosen}
                      onChange={(sources) => setSourcePages(source.id, sources)}
                    />
                    <span class="merge-list__actions">
                      <IconButton
                        icon="grid"
                        label={`${t.merge.showPages}: ${source.name}`}
                        tip={t.merge.showPages}
                        aria-pressed={picking === source.id}
                        aria-controls="merge-view"
                        onClick={() => showPicker(picking === source.id ? null : source.id)}
                      />
                      <IconButton
                        icon="arrowUp"
                        label={format(t.merge.moveUp, { name: source.name })}
                        disabled={index === 0}
                        onClick={() => moveSource(source.id, -1)}
                      />
                      <IconButton
                        icon="arrowDown"
                        label={format(t.merge.moveDown, { name: source.name })}
                        disabled={index === activeSources.length - 1}
                        onClick={() => moveSource(source.id, 1)}
                      />
                      <IconButton
                        icon="close"
                        label={removeLabel}
                        tip={activeSources.length === 1 ? t.merge.keepOne : removeLabel}
                        disabled={activeSources.length === 1}
                        onClick={() => removeSource(source.id)}
                      />
                    </span>
                  </div>
                  {bookmarks.on && (
                    <div class="merge-list__bookmark">
                      <label for={`merge-bookmark-${source.id}`} class="merge-range__label">
                        {t.merge.bookmarkLabel}
                        <span class="visually-hidden">
                          {' '}
                          {format(t.merge.bookmarkFor, { name: source.name })}
                        </span>
                      </label>
                      <input
                        id={`merge-bookmark-${source.id}`}
                        class="merge-bookmark__input"
                        type="text"
                        autocomplete="off"
                        value={bookmarks.titles.get(source.id) ?? defaultTitle(source.name)}
                        placeholder={defaultTitle(source.name)}
                        onInput={(event) => setBookmarkTitle(source.id, event.currentTarget.value)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>

          <label class="merge-option">
            <input
              type="checkbox"
              checked={bookmarks.on}
              onChange={(event) => setBookmarksOn(event.currentTarget.checked)}
            />
            {t.merge.bookmarks}
          </label>

          <div class="toolbar toolbar--tools" role="toolbar" aria-label={t.merge.actions}>
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
                <Icon name="filePlus" />
                {adding ? t.merge.adding : t.merge.add}
              </label>
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
              <button
                type="button"
                class="button"
                disabled={save.status === 'saving' || !first}
                onClick={() => setAsking(true)}
              >
                <Icon name="download" />
                {save.status === 'saving' ? t.pages.saving : t.merge.download}
              </button>
            </div>
          </div>

          <div class="tools-status">
            <p class="page-editor__status">{unsaved ? t.pages.unsaved : ''}</p>
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
          {asking && (
            <SaveDialog
              title={t.merge.saveTitle}
              suggestion={suggestion}
              onConfirm={(fileName) => void saveAs(fileName)}
              onCancel={() => setAsking(false)}
            />
          )}
        </div>
      }
      view={
        <div id="merge-view" class="merge-view">
          {pickingSource ? (
            <>
              <PaneHead
                title={format(t.merge.picking, { name: pickingSource.name })}
                titleId="merge-view-title"
                sticky
                meta={format(t.merge.pagesChosen, {
                  n: chosenOf(pickingSource.id).size,
                  total: pickingSource.pageCount,
                })}
              >
                <IconButton
                  icon="close"
                  label={t.merge.showResult}
                  onClick={() => showPicker(null)}
                />
              </PaneHead>
              <PagePicker
                source={pickingSource}
                chosen={chosenOf(pickingSource.id)}
                rotations={rotationsOf(pickingSource.id)}
                onChange={(sources) => setSourcePages(pickingSource.id, sources)}
              />
            </>
          ) : (
            <>
              <PaneHead
                title={t.merge.result}
                titleId="merge-view-title"
                meta={plural(pages.length, t.document.pagesOne, t.document.pagesOther)}
              />
              <PageThumbs label={t.merge.result} />
            </>
          )}
        </div>
      }
    />
  );
}
