import { useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useUndoShortcuts } from '../document/useUndoShortcuts';
import { useI18n } from '../i18n/LanguageContext';
import { format } from '../i18n/format';
import {
  PdfSaveError,
  buildPdf,
  downloadPdf,
  editedFileName,
  readSources,
  type SaveErrorCode,
} from '../pdf/save';
import {
  FileList,
  FilesToolbar,
  ResultPane,
  defaultBookmarkTitle,
  useFilePicking,
} from './FilesParts';
import { Icon } from './Icon';
import { SaveDialog } from './SaveDialog';
import { Split, useInfo } from './WorkspaceParts';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; code: SaveErrorCode };

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
    annotations,
    redaction,
    undo,
    redo,
    unsaved,
    markSaved,
    bookmarks,
    setBookmarksOn,
  } = useDocument();
  const { t } = useI18n();
  const [asking, setAsking] = useState(false);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  useUndoShortcuts(undo, redo);
  const { picking, pickingSource, showPicker } = useFilePicking();
  const info = useInfo(
    <>
      <p>{t.merge.hint}</p>
      <p>{t.merge.pagesHint}</p>
      <p>{t.merge.bookmarksHint}</p>
    </>,
  );

  const first = activeSources[0];
  const suggestion = first ? editedFileName(first.name, t.merge.suffix) : '';
  // De titel van de bladwijzer voor een bestand: eigen titel, anders de naam zonder .pdf.
  const titleOf = (id: number, name: string) =>
    bookmarks.titles.get(id)?.trim() || defaultBookmarkTitle(name);

  const saveAs = async (fileName: string) => {
    setAsking(false);
    setSave({ status: 'saving' });
    try {
      const files = new Map(
        (doc.status === 'ready' ? doc.sources : []).map((source) => [source.id, source.file]),
      );
      const options = {
        annotations,
        redaction,
        ...(bookmarks.on
          ? {
              bookmarks: activeSources.map((source) => ({
                doc: source.id,
                title: titleOf(source.id, source.name),
              })),
            }
          : {}),
      };
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
          <FileList picking={picking} onPick={showPicker} bookmarkFields />

          <label class="merge-option">
            <input
              type="checkbox"
              checked={bookmarks.on}
              onChange={(event) => setBookmarksOn(event.currentTarget.checked)}
            />
            {t.merge.bookmarks}
          </label>

          <FilesToolbar label={t.merge.actions}>
            <button
              type="button"
              class="button"
              disabled={save.status === 'saving' || !first}
              onClick={() => setAsking(true)}
            >
              <Icon name="download" />
              {save.status === 'saving' ? t.pages.saving : t.merge.download}
            </button>
          </FilesToolbar>

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
      view={<ResultPane pickingSource={pickingSource} onPick={showPicker} />}
    />
  );
}
