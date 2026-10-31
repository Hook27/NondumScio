import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { IconButton } from '../components/Icon';
import { SaveDialog } from '../components/SaveDialog';
import { PaneHead } from '../components/WorkspaceParts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { initialPages, type PageItem } from '../pages/plan';
import { PdfSaveError, buildPdf, downloadPdf, readSources, type SaveErrorCode } from '../pdf/save';
import { dateFromName, mergeName, moveId, orderEntries, type MergeEntry } from './merge';
import { PreviewDialog } from './PreviewDialog';
import { countPages } from './readText';
import { proposeNames } from './recognize';
import { clearRename, newId, setRenameState, useRenameState, type ExtraDoc } from './store';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; code: SaveErrorCode };

/**
 * Samenvoegen: de brieven van Hernoemen (en losse, al hernoemde PDF's) tot één PDF, de nieuwste
 * eerst. De volgorde volgt de datum tot je zelf schuift; aan/uit staat los van "meenemen" bij
 * Hernoemen. Het samenvoegen zelf gaat via de gewone opslag van de app (`buildPdf`).
 */
export function RenameMerge() {
  const { t } = useI18n();
  const r = t.rename;
  const m = r.merge;
  const { docs, extras, mergeOrder, mergeSkip, bookmarks, changed } = useRenameState();
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<'save' | 'clear' | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const table = useRef<HTMLTableElement>(null);
  // Na schuiven: de focus terug op dezelfde pijl in de verschoven rij.
  const moved = useRef<{ id: number; direction: -1 | 1 } | null>(null);

  const names = proposeNames(docs);
  const entries: MergeEntry[] = [
    ...docs.map((doc, i) => ({
      id: doc.id,
      date: doc.date.length === 6 ? doc.date : '',
      name: names[i]!,
      pageCount: doc.pageCount,
      external: false,
      error: doc.error,
    })),
    ...extras.map((extra) => ({
      id: extra.id,
      date: extra.date,
      name: extra.file.name,
      pageCount: extra.pageCount,
      external: true,
      error: extra.error,
    })),
  ];
  const ordered = orderEntries(entries, mergeOrder);
  const chosen = ordered.filter((entry) => !mergeSkip.has(entry.id) && !entry.error);
  const pageTotal = chosen.reduce((total, entry) => total + entry.pageCount, 0);
  const fileOf = (id: number) =>
    docs.find((doc) => doc.id === id)?.file ?? extras.find((extra) => extra.id === id)!.file;

  useLayoutEffect(() => {
    const pending = moved.current;
    if (!pending) return;
    moved.current = null;
    const button = (direction: number) =>
      table.current?.querySelector<HTMLButtonElement>(`[data-move="${pending.id}:${direction}"]`);
    // Staat de rij nu bovenaan of onderaan, dan de andere pijl.
    const same = button(pending.direction);
    (same && !same.disabled ? same : button(-pending.direction))?.focus();
  });

  const move = (id: number, direction: -1 | 1) => {
    moved.current = { id, direction };
    setRenameState(() => ({
      mergeOrder: moveId(
        ordered.map((entry) => entry.id),
        id,
        direction,
      ),
    }));
  };

  const toggle = (id: number, on: boolean) =>
    setRenameState((current) => {
      const skip = new Set(current.mergeSkip);
      if (on) skip.delete(id);
      else skip.add(id);
      return { mergeSkip: skip };
    });

  const addExtras = async (files: File[]) => {
    const pdfs = files.filter(
      (file) => /\.pdf$/i.test(file.name) || file.type === 'application/pdf',
    );
    if (pdfs.length === 0) return;
    for (const file of pdfs) {
      const extra: ExtraDoc = {
        id: newId(),
        file,
        date: dateFromName(file.name),
        pageCount: 0,
        error: false,
      };
      try {
        extra.pageCount = await countPages(file);
      } catch {
        extra.error = true;
      }
      setRenameState((current) => ({ extras: [...current.extras, extra] }));
    }
    setNotice(plural(pdfs.length, m.addedOne, m.added));
  };

  /** Voegt de gekozen PDF's samen in de volgorde van de lijst, met een bladwijzer per brief. */
  const saveAs = async (fileName: string) => {
    setAsking(null);
    setSave({ status: 'saving' });
    try {
      const files = new Map(chosen.map((entry) => [entry.id, fileOf(entry.id)]));
      let key = 0;
      const pages: PageItem[] = chosen.flatMap((entry) => {
        const items = initialPages(entry.pageCount, entry.id, key);
        key += entry.pageCount;
        return items;
      });
      const options = bookmarks
        ? {
            bookmarks: chosen.map((entry) => ({
              doc: entry.id,
              title: entry.name.replace(/\.pdf$/i, ''),
            })),
          }
        : {};
      const bytes = await buildPdf(await readSources(files, pages), pages, options);
      downloadPdf(bytes, fileName);
      setSave({ status: 'saved', fileName });
    } catch (error) {
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
    }
  };

  const clear = () => {
    clearRename();
    setAsking(null);
    setNotice(null);
    setSave({ status: 'idle' });
  };

  const summary =
    chosen.length === 0
      ? m.nothing
      : format(m.summary, {
          files: plural(chosen.length, r.filesOne, format(r.files, { n: chosen.length })),
          pages: plural(pageTotal, t.document.pagesOne, t.document.pagesOther),
        });

  return (
    <section class="workspace rename" aria-labelledby="rename-merge-title">
      <div class="workspace__tools">
        <div class="document__bar">
          <div class="document__info">
            <h2 id="rename-merge-title" class="document__name">
              {m.title}
            </h2>
          </div>
        </div>
        <div class="toolbar toolbar--tools" role="toolbar" aria-label={m.title}>
          <div class="toolbar__group toolbar__group--wide">
            <input
              id="rename-merge-add"
              class="visually-hidden"
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={(event) => {
                const files = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = '';
                void addExtras(files);
              }}
            />
            <label for="rename-merge-add" class="button button--secondary">
              {m.add}
            </label>
            <button
              type="button"
              class="button"
              disabled={save.status === 'saving' || chosen.length === 0}
              onClick={() => setAsking('save')}
            >
              {save.status === 'saving' ? m.saving : m.download}
            </button>
          </div>
          <div class="toolbar__group toolbar__group--wide">
            <button
              type="button"
              class="button button--secondary"
              disabled={mergeOrder === null}
              onClick={() => setRenameState(() => ({ mergeOrder: null }))}
            >
              {m.sort}
            </button>
            {extras.length > 0 && (
              <button
                type="button"
                class="button button--secondary"
                onClick={() => setRenameState(() => ({ extras: [] }))}
              >
                {m.clearExtras}
              </button>
            )}
            <button
              type="button"
              class="button button--secondary"
              disabled={entries.length === 0}
              onClick={() => (changed ? setAsking('clear') : clear())}
            >
              {r.clear}
            </button>
          </div>
        </div>
        <label class="merge-option">
          <input
            type="checkbox"
            checked={bookmarks}
            onChange={(event) => {
              const on = event.currentTarget.checked;
              setRenameState(() => ({ bookmarks: on }));
            }}
          />
          {m.bookmarks}
        </label>
        <p class="page-editor__status" aria-live="polite">
          {summary}
        </p>
        {notice && (
          <p class="page-editor__saved" role="status">
            {notice}
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
        <p class="annotate__hint">{m.intro}</p>
        <p class="annotate__hint">{m.addHint}</p>
      </div>
      <div class="workspace__view" data-scroll-root>
        <PaneHead title={m.order} />
        {ordered.length === 0 ? (
          <p class="rename-merge__empty">{m.empty}</p>
        ) : (
          <table class="rename-table rename-merge" ref={table}>
            <thead>
              <tr>
                <th scope="col" class="rename-merge__position">
                  <span class="visually-hidden">{m.columns.position}</span>
                </th>
                <th scope="col" class="rename-table__include">
                  <span class="visually-hidden">{m.columns.include}</span>
                </th>
                <th scope="col" class="rename-merge__date">
                  {m.columns.date}
                </th>
                <th scope="col">{m.columns.name}</th>
                <th scope="col" class="rename-merge__pages">
                  {m.columns.pages}
                </th>
                <th scope="col" class="rename-merge__order">
                  {m.columns.order}
                </th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((entry, index) => {
                const on = !mergeSkip.has(entry.id) && !entry.error;
                return (
                  <tr key={entry.id} class={on ? undefined : 'rename-table__skip'}>
                    <td class="rename-merge__position">{index + 1}</td>
                    <td class="rename-table__include">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={entry.error}
                        aria-label={format(m.includeLabel, { name: entry.name })}
                        onChange={(event) => toggle(entry.id, event.currentTarget.checked)}
                      />
                    </td>
                    <td class="rename-merge__date">{entry.date || r.noDate}</td>
                    <td class="rename-table__original">
                      <span class="rename-table__file">
                        {entry.name}
                        {entry.external && <span class="rename-merge__tag">{m.external}</span>}
                      </span>
                      {entry.error ? (
                        <span class="rename-table__problem">{r.readError}</span>
                      ) : (
                        <button
                          type="button"
                          class="link-button"
                          aria-label={format(r.viewLabel, { name: entry.name })}
                          onClick={() => setViewing(entry.id)}
                        >
                          {r.view}
                        </button>
                      )}
                    </td>
                    <td class="rename-merge__pages">{entry.error ? '' : entry.pageCount}</td>
                    <td class="rename-merge__order">
                      <span class="rename-merge__arrows">
                        <IconButton
                          icon="arrowUp"
                          label={format(t.merge.moveUp, { name: entry.name })}
                          data-move={`${entry.id}:-1`}
                          disabled={index === 0}
                          onClick={() => move(entry.id, -1)}
                        />
                        <IconButton
                          icon="arrowDown"
                          label={format(t.merge.moveDown, { name: entry.name })}
                          data-move={`${entry.id}:1`}
                          disabled={index === ordered.length - 1}
                          onClick={() => move(entry.id, 1)}
                        />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {asking === 'save' && (
        <SaveDialog
          title={m.saveTitle}
          suggestion={mergeName(
            chosen.map((entry) => entry.date),
            m.fileName,
          )}
          onConfirm={(fileName) => void saveAs(fileName)}
          onCancel={() => setAsking(null)}
        />
      )}
      {asking === 'clear' && (
        <ConfirmDialog
          title={r.clearTitle}
          text={r.clearText}
          cancel={t.closeDialog.cancel}
          confirm={r.clear}
          onCancel={() => setAsking(null)}
          onConfirm={clear}
        />
      )}
      {viewing !== null &&
        (() => {
          const entry = ordered.find((e) => e.id === viewing);
          return entry ? (
            <PreviewDialog
              file={fileOf(entry.id)}
              title={entry.name}
              onClose={() => setViewing(null)}
            />
          ) : null;
        })()}
    </section>
  );
}
