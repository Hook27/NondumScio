import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { Icon, IconButton } from './Icon';
import { PagePicker, RangeField } from './MergePages';
import { useDragReorder } from './useDragReorder';
import { PageThumbs, PaneHead } from './WorkspaceParts';

/*
 * De onderdelen die Samenvoegen en Omzetten (PDF naar afbeeldingen) delen: de bestanden in
 * volgorde, de knoppenbalk met toevoegen en ongedaan maken, en het rechtervak met het
 * resultaat of de pagina's van één bestand om te kiezen. Zo werken ze overal hetzelfde.
 */

/**
 * Welk bestand rechts zijn pagina's met vinkjes toont (anders: het resultaat). Bij wisselen
 * gaat de focus naar de kop van het rechtervak: zo komt het op een telefoon in beeld, en weet
 * een schermlezer dat er iets veranderd is.
 */
export function useFilePicking() {
  const { activeSources } = useDocument();
  const [picking, setPicking] = useState<number | null>(null);
  const pickingSource = activeSources.find((source) => source.id === picking);
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
  return { picking, pickingSource, showPicker };
}

/** De titel van de bladwijzer voor een bestand zonder eigen titel: de naam zonder .pdf. */
export const defaultBookmarkTitle = (name: string) => name.replace(/\.pdf$/i, '');

/**
 * De bestanden in volgorde: slepen (met muis, op een aanraakscherm aan het greepje), omhoog en
 * omlaag, weghalen, een bereikveld en de knop om pagina's met miniaturen te kiezen. Met
 * `bookmarkFields` staat bij elk bestand ook de titel van de nieuwe bladwijzer.
 */
export function FileList({
  picking,
  onPick,
  bookmarkFields = false,
}: {
  picking: number | null;
  onPick: (id: number | null) => void;
  bookmarkFields?: boolean;
}) {
  const {
    pages,
    activeSources,
    removeSource,
    moveSource,
    moveSourceTo,
    setSourcePages,
    bookmarks,
    setBookmarkTitle,
  } = useDocument();
  const { t } = useI18n();

  // Slepen: een bestand oppakken en op een andere plek in de lijst loslaten.
  const list = useRef<HTMLOListElement>(null);
  const { dragged, dropAt, handlers } = useDragReorder<number>({
    list,
    itemSelector: '.merge-list__item',
    direction: 'vertical',
    onDrop: (id, target) => moveSourceTo(id, target),
  });

  // Per bestand: welke pagina's meedoen.
  const chosenOf = (id: number) =>
    new Set(pages.filter((page) => page.doc === id).map((page) => page.source));

  return (
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
                  onClick={() => onPick(picking === source.id ? null : source.id)}
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
            {bookmarkFields && bookmarks.on && (
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
                  value={bookmarks.titles.get(source.id) ?? defaultBookmarkTitle(source.name)}
                  placeholder={defaultBookmarkTitle(source.name)}
                  onInput={(event) => setBookmarkTitle(source.id, event.currentTarget.value)}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * De knoppenbalk onder een lijst: toevoegen, ongedaan maken en opnieuw. De hoofdactie
 * (downloaden) komt als `children` in een eigen groep, die op een telefoon vast onderaan staat.
 * Gedeeld door de bestanden (PDF's) en de afbeeldingen.
 */
export function ListToolbar({
  label,
  addId,
  accept,
  addLabel,
  adding = false,
  onAdd,
  undo,
  redo,
  canUndo,
  canRedo,
  children,
}: {
  label: string;
  addId: string;
  accept: string;
  addLabel: string;
  adding?: boolean;
  onAdd: (files: File[]) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  children: ComponentChildren;
}) {
  const { t } = useI18n();
  return (
    <div class="toolbar toolbar--tools" role="toolbar" aria-label={label}>
      <div class="toolbar__group">
        <input
          id={addId}
          class="visually-hidden"
          type="file"
          accept={accept}
          multiple
          disabled={adding}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = '';
            onAdd(files);
          }}
        />
        <label for={addId} class="button button--secondary">
          <Icon name="filePlus" />
          {addLabel}
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
      <div class="toolbar__group toolbar__group--wide">{children}</div>
    </div>
  );
}

/** De knoppenbalk onder de bestanden (PDF's): bestand toevoegen, ongedaan maken en opnieuw. */
export function FilesToolbar({ label, children }: { label: string; children: ComponentChildren }) {
  const { add, adding, undo, redo, canUndo, canRedo } = useDocument();
  const { t } = useI18n();
  return (
    <ListToolbar
      label={label}
      addId="merge-add"
      accept="application/pdf,.pdf"
      addLabel={adding ? t.merge.adding : t.merge.add}
      adding={adding}
      onAdd={(files) => void add(files)}
      undo={undo}
      redo={redo}
      canUndo={canUndo}
      canRedo={canRedo}
    >
      {children}
    </ListToolbar>
  );
}

/**
 * Het rechtervak: het resultaat (alle pagina's in volgorde), of, na ⊞ bij een bestand, de
 * miniaturen van dat bestand om pagina's aan of uit te zetten.
 */
export function ResultPane({
  pickingSource,
  onPick,
}: {
  pickingSource: ReturnType<typeof useFilePicking>['pickingSource'];
  onPick: (id: number | null) => void;
}) {
  const { pages, setSourcePages } = useDocument();
  const { t } = useI18n();
  const chosenOf = (id: number) =>
    new Set(pages.filter((page) => page.doc === id).map((page) => page.source));
  const rotationsOf = (id: number) =>
    new Map(pages.filter((page) => page.doc === id).map((page) => [page.source, page.rotation]));

  return (
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
            <IconButton icon="close" label={t.merge.showResult} onClick={() => onPick(null)} />
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
  );
}
