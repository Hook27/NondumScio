import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useUndoShortcuts } from '../document/useUndoShortcuts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatFileSize } from '../lib/format';
import { moveBy, moveTo } from '../lib/reorder';
import {
  ImageConvertError,
  detectImageType,
  imagesToPdf,
  type ImageType,
  type MarginChoice,
  type PageSizeChoice,
} from '../pdf/images';
import { downloadPdf } from '../pdf/save';
import { RadioGroup } from './ConvertParts';
import { Dropzone } from './Dropzone';
import { ListToolbar } from './FilesParts';
import { Icon, IconButton } from './Icon';
import { SaveDialog } from './SaveDialog';
import { useDragReorder } from './useDragReorder';
import { PaneHead, useInfo } from './WorkspaceParts';

/** Een gekozen afbeelding, met een adres om hem als miniatuur te tonen. */
export type ImageItem = {
  id: number;
  name: string;
  size: number;
  type: ImageType;
  file: File;
  url: string;
};

/** Hoeveel stappen je ongedaan kunt maken, net als bij de pagina's. */
const HISTORY_LIMIT = 100;

type History = {
  past: ImageItem[][];
  present: ImageItem[];
  future: ImageItem[][];
};

/**
 * De afbeeldingen en keuzes voor "Afbeeldingen naar PDF". Staat bij de omzetter zelf, zodat
 * ze blijven staan als je even naar "PDF naar afbeeldingen" wisselt en terugkomt. Toevoegen,
 * verplaatsen en weghalen kun je ongedaan maken.
 */
export function useImagesToPdf() {
  const [history, setHistory] = useState<History>({ past: [], present: [], future: [] });
  const [skipped, setSkipped] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<PageSizeChoice>('fit');
  const [margin, setMargin] = useState<MarginChoice>('none');
  const nextId = useRef(1);
  const urls = useRef(new Set<string>());

  // De adressen van de miniaturen wijzen naar het bestand zelf (geen kopie). Ze blijven
  // bestaan zolang ongedaan maken ze nog kan terugbrengen, en gaan weg als we vertrekken.
  useEffect(() => {
    const open = urls.current;
    return () => {
      for (const url of open) URL.revokeObjectURL(url);
      open.clear();
    };
  }, []);

  /** Legt een wijziging van de lijst vast, zodat die ongedaan kan worden gemaakt. */
  const edit = useCallback((change: (items: readonly ImageItem[]) => readonly ImageItem[]) => {
    setHistory((current) => {
      const next = change(current.present);
      if (next === current.present) return current;
      return {
        past: [...current.past, current.present].slice(-HISTORY_LIMIT),
        present: [...next],
        future: [],
      };
    });
  }, []);

  /** Voegt achteraan toe wat JPEG of PNG is (aan de inhoud herkend); de rest wordt gemeld. */
  const add = useCallback(
    async (files: File[]) => {
      const added: ImageItem[] = [];
      const refused: string[] = [];
      for (const file of files) {
        const type = detectImageType(new Uint8Array(await file.slice(0, 8).arrayBuffer()));
        if (!type) {
          refused.push(file.name);
          continue;
        }
        const url = URL.createObjectURL(file);
        urls.current.add(url);
        added.push({ id: nextId.current++, name: file.name, size: file.size, type, file, url });
      }
      setSkipped(refused);
      if (added.length > 0) edit((items) => [...items, ...added]);
    },
    [edit],
  );

  const indexOf = (items: readonly ImageItem[], id: number) =>
    items.findIndex((item) => item.id === id);

  const remove = (id: number) => edit((items) => items.filter((item) => item.id !== id));
  const move = (id: number, step: -1 | 1) =>
    edit((items) => moveBy(items, indexOf(items, id), step));
  const dropAt = (id: number, target: number) =>
    edit((items) => moveTo(items, indexOf(items, id), target));

  const undo = useCallback(
    () =>
      setHistory((current) => {
        const previous = current.past.at(-1);
        if (!previous) return current;
        return {
          past: current.past.slice(0, -1),
          present: previous,
          future: [current.present, ...current.future],
        };
      }),
    [],
  );
  const redo = useCallback(
    () =>
      setHistory((current) => {
        const [next, ...rest] = current.future;
        if (!next) return current;
        return { past: [...current.past, current.present], present: next, future: rest };
      }),
    [],
  );

  /** Alles weg en opnieuw beginnen (niet ongedaan te maken, zoals het sluiten van een PDF). */
  const clear = () => {
    setHistory({ past: [], present: [], future: [] });
    setSkipped([]);
  };

  return {
    items: history.present,
    skipped,
    add,
    remove,
    move,
    dropAt,
    clear,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    pageSize,
    setPageSize,
    margin,
    setMargin,
  };
}

type ImagesState = ReturnType<typeof useImagesToPdf>;

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; index?: number };

const IMAGE_ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png';

/**
 * Afbeeldingen naar PDF: JPG- en PNG-afbeeldingen kiezen, in volgorde zetten (slepen, of met
 * de pijlen) en er één PDF van maken, een pagina per afbeelding. De bediening is dezelfde als
 * bij Samenvoegen. Niets wordt geüpload; alles gebeurt in de browser.
 */
export function ImagesToPdf({ state, head }: { state: ImagesState; head: ComponentChildren }) {
  const { t, language } = useI18n();
  const {
    items,
    skipped,
    add,
    remove,
    move,
    dropAt,
    clear,
    undo,
    redo,
    canUndo,
    canRedo,
    pageSize,
    setPageSize,
    margin,
    setMargin,
  } = state;
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [asking, setAsking] = useState(false);
  const info = useInfo(<p>{t.convert.imagesHint}</p>);
  useUndoShortcuts(undo, redo);

  // Slepen: een afbeelding oppakken en op een andere plek in de lijst loslaten.
  const list = useRef<HTMLOListElement>(null);
  const {
    dragged,
    dropAt: dropIndex,
    handlers,
  } = useDragReorder<number>({
    list,
    itemSelector: '.merge-list__item',
    direction: 'vertical',
    onDrop: (id, target) => dropAt(id, target),
  });

  const skippedMessages = skipped.length > 0 && (
    <div class="file-errors" role="alert">
      {skipped.map((name, i) => (
        <p key={`${i}-${name}`}>{format(t.convert.skipped, { name })}</p>
      ))}
    </div>
  );

  if (items.length === 0) {
    return (
      <>
        <div class="convert-mode">{head}</div>
        <Dropzone
          title={t.convert.pickTitle}
          dropTitle={t.convert.dropHere}
          hint={t.convert.pickHint}
          inputId="images-file"
          accept={IMAGE_ACCEPT}
          chooseLabel={t.convert.choose}
          onFiles={(files) => void add(files)}
        >
          {skippedMessages}
        </Dropzone>
      </>
    );
  }

  const count = plural(items.length, t.convert.countOne, t.convert.countOther);
  const totalSize = items.reduce((total, item) => total + item.size, 0);
  const busy = save.status === 'saving';
  const suggestion =
    items.length === 1
      ? `${items[0]!.name.replace(/\.[^.]+$/, '')}.pdf`
      : `${t.convert.defaultName}.pdf`;

  const make = async (fileName: string) => {
    setAsking(false);
    setSave({ status: 'saving' });
    try {
      const inputs = [];
      for (const item of items) {
        inputs.push({ bytes: new Uint8Array(await item.file.arrayBuffer()), type: item.type });
      }
      downloadPdf(await imagesToPdf(inputs, { pageSize, margin }), fileName);
      setSave({ status: 'saved', fileName });
    } catch (error) {
      setSave({
        status: 'error',
        index: error instanceof ImageConvertError ? error.index : undefined,
      });
    }
  };

  return (
    <section class="workspace" aria-labelledby="images-title">
      <div class="workspace__tools">
        {head}
        <div class="document__bar">
          <div class="document__info">
            <h2 id="images-title" class="document__name">
              {count}
            </h2>
            <p class="document__meta">{formatFileSize(totalSize, language)}</p>
          </div>
          <IconButton icon="close" label={t.document.close} onClick={clear} />
        </div>
        {skippedMessages}

        <div class="merge convert">
          <ol
            ref={list}
            class={`merge-list${dragged !== null ? ' merge-list--dragging' : ''}`}
            aria-label={t.convert.listLabel}
          >
            {items.map((item, index) => {
              const classes = [
                'merge-list__item',
                dragged === item.id && 'merge-list__item--dragging',
                dropIndex === index && 'merge-list__item--drop-before',
                dropIndex === items.length &&
                  index === items.length - 1 &&
                  'merge-list__item--drop-after',
              ]
                .filter(Boolean)
                .join(' ');
              const removeLabel = format(t.merge.remove, { name: item.name });
              return (
                <li key={item.id} class={classes} data-index={index} {...handlers(item.id)}>
                  <div class="merge-list__head">
                    {/* Alleen voor muis en vinger; met het toetsenbord gaan de pijlknoppen. */}
                    <span class="drag-handle merge-list__handle" aria-hidden="true">
                      ⠿
                    </span>
                    <span class="merge-list__position" aria-hidden="true">
                      {index + 1}
                    </span>
                    <img class="merge-list__thumb" src={item.url} alt="" draggable={false} />
                    <span class="merge-list__name" data-tip={item.name}>
                      {item.name}
                    </span>
                    <span class="merge-list__pages">
                      {item.type === 'png' ? 'PNG' : 'JPG'} · {formatFileSize(item.size, language)}
                    </span>
                  </div>
                  <div class="merge-list__tools">
                    <span class="merge-list__actions">
                      <IconButton
                        icon="arrowUp"
                        label={format(t.merge.moveUp, { name: item.name })}
                        disabled={index === 0}
                        onClick={() => move(item.id, -1)}
                      />
                      <IconButton
                        icon="arrowDown"
                        label={format(t.merge.moveDown, { name: item.name })}
                        disabled={index === items.length - 1}
                        onClick={() => move(item.id, 1)}
                      />
                      <IconButton
                        icon="close"
                        label={removeLabel}
                        onClick={() => remove(item.id)}
                      />
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>

          <RadioGroup
            legend={t.convert.pageSize}
            name="images-page-size"
            value={pageSize}
            onChange={setPageSize}
            options={[
              { value: 'fit', label: t.convert.fit },
              { value: 'a4', label: t.convert.a4 },
              { value: 'letter', label: t.convert.letter },
            ]}
          />
          <RadioGroup
            legend={t.convert.margin}
            name="images-margin"
            value={margin}
            onChange={setMargin}
            options={[
              { value: 'none', label: t.convert.marginNone },
              { value: 'small', label: t.convert.marginSmall },
              { value: 'normal', label: t.convert.marginNormal },
            ]}
          />

          <ListToolbar
            label={t.convert.actions}
            addId="images-add"
            accept={IMAGE_ACCEPT}
            addLabel={t.convert.add}
            onAdd={(files) => void add(files)}
            undo={undo}
            redo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
          >
            <button type="button" class="button" disabled={busy} onClick={() => setAsking(true)}>
              <Icon name="download" />
              {busy ? t.convert.making : t.convert.make}
            </button>
          </ListToolbar>

          <div class="tools-status">
            <p class="page-editor__status" aria-live="polite">
              {busy ? t.convert.making : ''}
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
              {save.index === undefined
                ? t.convert.failed
                : format(t.convert.imageFailed, {
                    n: save.index + 1,
                    name: items[save.index]?.name ?? '',
                  })}
            </p>
          )}
          {asking && (
            <SaveDialog
              title={t.saveDialog.saveTitle}
              suggestion={suggestion}
              onConfirm={(fileName) => void make(fileName)}
              onCancel={() => setAsking(false)}
            />
          )}
        </div>
      </div>

      <div class="workspace__view">
        <PaneHead title={t.merge.result} meta={count} />
        <ol class="thumbs" aria-label={t.convert.previewLabel}>
          {items.map((item, index) => (
            <li key={item.id}>
              <figure class="thumb">
                <div class="thumb__page">
                  <img src={item.url} alt={item.name} draggable={false} />
                </div>
                <figcaption aria-hidden="true">{index + 1}</figcaption>
              </figure>
              <span class="page-option__file" aria-hidden="true">
                {item.name}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
