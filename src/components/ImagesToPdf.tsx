import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatFileSize } from '../lib/format';
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
import { Icon, IconButton } from './Icon';
import { SaveDialog } from './SaveDialog';
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

/**
 * De afbeeldingen en keuzes voor "Afbeeldingen naar PDF". Staat bij de omzetter zelf, zodat
 * ze blijven staan als je even naar "PDF naar afbeeldingen" wisselt en terugkomt.
 */
export function useImagesToPdf() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState<PageSizeChoice>('fit');
  const [margin, setMargin] = useState<MarginChoice>('none');
  const nextId = useRef(1);
  const urls = useRef(new Set<string>());

  // De adressen van de miniaturen wijzen naar geheugen: geef ze vrij als we weggaan.
  useEffect(() => {
    const open = urls.current;
    return () => {
      for (const url of open) URL.revokeObjectURL(url);
      open.clear();
    };
  }, []);

  const forget = (item: ImageItem) => {
    URL.revokeObjectURL(item.url);
    urls.current.delete(item.url);
  };

  /** Voegt achteraan toe wat JPEG of PNG is (aan de inhoud herkend); de rest wordt gemeld. */
  const add = useCallback(async (files: File[]) => {
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
    setItems((current) => [...current, ...added]);
  }, []);

  const remove = (id: number) => {
    setItems((current) => {
      const gone = current.find((item) => item.id === id);
      if (gone) forget(gone);
      return current.filter((item) => item.id !== id);
    });
  };

  const move = (id: number, step: -1 | 1) =>
    setItems((current) => {
      const from = current.findIndex((item) => item.id === id);
      const to = from + step;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to]!, next[from]!];
      return next;
    });

  const clear = () => {
    for (const item of items) forget(item);
    setItems([]);
    setSkipped([]);
  };

  return { items, skipped, add, remove, move, clear, pageSize, setPageSize, margin, setMargin };
}

type ImagesState = ReturnType<typeof useImagesToPdf>;

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; index?: number };

/**
 * Afbeeldingen naar PDF: JPG- en PNG-afbeeldingen kiezen, in volgorde zetten en er één PDF
 * van maken, een pagina per afbeelding. Niets wordt geüpload; alles gebeurt in de browser.
 */
export function ImagesToPdf({ state, head }: { state: ImagesState; head: ComponentChildren }) {
  const { t, language } = useI18n();
  const { items, skipped, add, remove, move, clear, pageSize, setPageSize, margin, setMargin } =
    state;
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [asking, setAsking] = useState(false);
  const info = useInfo(<p>{t.convert.imagesHint}</p>);

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
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
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
          <IconButton icon="close" label={t.convert.clear} onClick={clear} />
        </div>
        {skippedMessages}

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

        <div
          class="toolbar toolbar--tools toolbar--bar-only"
          role="toolbar"
          aria-label={t.convert.actions}
        >
          <div class="toolbar__group toolbar__group--wide">
            <input
              id="images-add"
              class="visually-hidden"
              type="file"
              accept="image/jpeg,image/png,.jpg,.jpeg,.png"
              multiple
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = '';
                void add(files);
              }}
            />
            <label for="images-add" class="button button--secondary">
              <Icon name="filePlus" />
              {t.convert.add}
            </label>
            <button type="button" class="button" disabled={busy} onClick={() => setAsking(true)}>
              <Icon name="download" />
              {busy ? t.convert.making : t.convert.make}
            </button>
          </div>
        </div>

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

      <div class="workspace__view">
        <PaneHead title={t.convert.imagesTitle} meta={count} />
        <ol class="image-list" aria-label={t.convert.listLabel}>
          {items.map((item, index) => (
            <li key={item.id} class="image-item">
              <span class="image-item__number" aria-hidden="true">
                {index + 1}
              </span>
              <img class="image-item__thumb" src={item.url} alt="" />
              <div class="image-item__info">
                <p class="image-item__name">{item.name}</p>
                <p class="image-item__meta">
                  {item.type === 'png' ? 'PNG' : 'JPG'} · {formatFileSize(item.size, language)}
                </p>
              </div>
              <div class="image-item__actions">
                <IconButton
                  icon="arrowUp"
                  label={format(t.convert.moveUp, { name: item.name })}
                  disabled={index === 0}
                  onClick={() => move(item.id, -1)}
                />
                <IconButton
                  icon="arrowDown"
                  label={format(t.convert.moveDown, { name: item.name })}
                  disabled={index === items.length - 1}
                  onClick={() => move(item.id, 1)}
                />
                <IconButton
                  icon="trash"
                  label={format(t.convert.remove, { name: item.name })}
                  onClick={() => remove(item.id)}
                />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
