import { hasRedactions } from '../annotations/model';
import { useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useUndoShortcuts } from '../document/useUndoShortcuts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { useDesktop } from '../lib/useDesktop';
import { chunkParts, formatRanges, parseParts, type RangeProblem } from '../pages/ranges';
import {
  PdfSaveError,
  type SaveErrorCode,
  buildParts,
  downloadFile,
  downloadPdf,
  editedFileName,
  readSources,
} from '../pdf/save';
import { uniqueNames } from '../split/bookmarks';
import { ZipTooLargeError, zipWriter } from '../lib/zip';
import { FileList, FilesToolbar } from './FilesParts';
import { Icon, IconButton } from './Icon';
import { PreviewDialog } from './PreviewDialog';
import { SaveDialog } from './SaveDialog';
import {
  BookmarkNotes,
  BookmarkOptions,
  BookmarkTable,
  bookmarkSummary,
  useBookmarkSplit,
} from './SplitBookmarks';
import { Thumbnail } from './Thumbnail';
import { PaneHead, Split, useInfo } from './WorkspaceParts';

type Method = 'every' | 'ranges' | 'bookmarks';

/** Wat rechts staat bij Op bladwijzers: de tabel met delen, of de pagina's per deel. */
type PaneView = 'parts' | 'pages';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving'; done: number; total: number }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; code: SaveErrorCode };

/** Wat er na het venster "Opslaan als" gedownload wordt: één deel, of alles als ZIP. */
type Request = { kind: 'part'; index: number } | { kind: 'zip' };

/**
 * Splitsen: de pagina's (in de volgorde van het pagina-plan, dus ook na bewerken bij
 * Pagina's) in delen knippen, per vast aantal pagina's, op bereiken of (op de computer) op
 * bladwijzers. Elk deel kan los worden gedownload, of alle (gekozen) delen samen als één ZIP.
 */
export function SplitView() {
  const { doc, pages, activeSources, sourceOf, annotations, redaction, undo, redo } = useDocument();
  useUndoShortcuts(undo, redo);
  const { t } = useI18n();
  const desktop = useDesktop();
  const [chosen, setMethod] = useState<Method>('every');
  // Op bladwijzers kan alleen op een breed scherm; wordt het venster smal, dan per aantal.
  const method: Method = chosen === 'bookmarks' && !desktop ? 'every' : chosen;
  const [size, setSize] = useState('1');
  const [ranges, setRanges] = useState('');
  const [level, setLevel] = useState(0);
  const [overlap, setOverlap] = useState(false);
  const [prefix, setPrefix] = useState('');
  const [folders, setFolders] = useState(false);
  const [paneView, setPaneView] = useState<PaneView>('parts');
  const [viewing, setViewing] = useState<number | null>(null);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [request, setRequest] = useState<Request | null>(null);
  const info = useInfo(
    <>
      <p>{t.split.hint}</p>
      <p class="desktop-only">{t.split.bookmarksHint}</p>
    </>,
  );
  const marked = useBookmarkSplit(level, overlap, prefix, folders);
  const byBookmarks = method === 'bookmarks';

  // De delen als paginanummers (vanaf 1) in het plan, of wat er niet klopt aan de bereiken.
  let parts: number[][] = [];
  let problem: RangeProblem | null = null;
  if (method === 'every') {
    parts = chunkParts(pages.length, Number(size));
  } else if (byBookmarks) {
    parts = marked.rows.map((row) => row.positions);
  } else if (ranges.trim() !== '') {
    const result = parseParts(ranges, pages.length);
    if (result.ok) parts = result.parts;
    else problem = result.error;
  }
  // Op bladwijzers gaan alleen de aangevinkte delen in de ZIP.
  const chosenRows = marked.rows.filter((row) => row.include);

  const name = activeSources[0]?.name ?? '';
  // "pagina 3" of "pagina’s 1-2", in de lijst en in de bestandsnaam.
  const pagesText = (part: number[]) =>
    format(part.length === 1 ? t.split.pageOne : t.split.pagesOther, {
      ranges: formatRanges(part),
    });
  const partName = (part: number[]) =>
    editedFileName(
      name,
      format(part.length === 1 ? t.split.fileOne : t.pages.extractSuffix, {
        ranges: formatRanges(part),
      }),
    );
  const zipName = editedFileName(name, t.split.suffix).replace(/\.pdf$/, '.zip');
  const busy = save.status === 'saving';

  const problemText = (error: RangeProblem) => {
    if (error.code === 'empty') return t.merge.rangeErrors.empty;
    if (error.code === 'invalid') return format(t.merge.rangeErrors.invalid, { part: error.part });
    return format(plural(pages.length, t.split.outOfRangeOne, t.split.outOfRangeOther), {
      page: error.page,
    });
  };

  /**
   * Maakt de PDF's van de gevraagde delen (bytes van de bronbestanden één keer gelezen). Met
   * `onPart` gaat elk deel meteen daarheen in plaats van in de teruggegeven lijst; met `titles`
   * krijgt elk deel een eigen titel.
   */
  const build = async (
    wanted: number[][],
    onPart?: (bytes: Uint8Array, index: number) => void,
    titles?: string[],
  ) => {
    const files = new Map(
      (doc.status === 'ready' ? doc.sources : []).map((source) => [source.id, source.file]),
    );
    const plans = wanted.map((part) => part.map((position) => pages[position - 1]!));
    const sources = await readSources(files, plans.flat());
    return buildParts(
      sources,
      plans,
      (done, total) => setSave({ status: 'saving', done, total }),
      annotations,
      // Ook een los deel zonder vak hoort bij een document waarin geredigeerd is.
      { ...redaction, wholeDocument: hasRedactions(pages, annotations) },
      onPart,
      titles,
    );
  };

  const saveAs = async (current: Request, fileName: string) => {
    setRequest(null);
    // Op bladwijzers: de aangevinkte delen, met hun eigen naam en de titel van hun bladwijzer.
    const zipParts = byBookmarks ? chosenRows.map((row) => row.positions) : parts;
    const zipNames = byBookmarks
      ? uniqueNames(chosenRows.map((row) => row.path))
      : zipParts.map(partName);
    const titles = byBookmarks ? chosenRows.map((row) => row.title) : undefined;
    const wanted = current.kind === 'zip' ? zipParts : [parts[current.index]!];
    setSave({ status: 'saving', done: 0, total: wanted.length });
    try {
      if (current.kind === 'zip') {
        // Elk deel gaat meteen de ZIP in, zodat niet alle delen tegelijk in het geheugen staan.
        const zip = await zipWriter();
        await build(
          wanted,
          (bytes, i) => {
            try {
              zip.add(zipNames[i]!, bytes);
            } catch (error) {
              throw error instanceof ZipTooLargeError ? new PdfSaveError('tooLarge') : error;
            }
          },
          titles,
        );
        downloadFile(zip.finish(), fileName, 'application/zip');
      } else {
        const [pdf] = await build(wanted);
        downloadPdf(pdf!, fileName);
      }
      setSave({ status: 'saved', fileName });
    } catch (error) {
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
    }
  };

  /** Op bladwijzers: een deel meteen downloaden, onder de naam uit de tabel (zoals het origineel). */
  const downloadRow = async (index: number) => {
    const row = marked.rows[index]!;
    setSave({ status: 'saving', done: 0, total: 1 });
    try {
      const [pdf] = await build([row.positions], undefined, [row.title]);
      downloadPdf(pdf!, row.fileName);
      setSave({ status: 'saved', fileName: row.fileName });
    } catch (error) {
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
    }
  };

  const used = new Set(parts.flat());
  const unused = pages.map((_, i) => i + 1).filter((position) => !used.has(position));
  // Alle pagina's in één raster, elk met het deel waar hij bij hoort; gedempt als hij niet in een
  // (gekozen) deel zit.
  const entries = [
    ...parts.flatMap((part, index) => {
      const off = byBookmarks && !marked.rows[index]!.include;
      return part.map((position) => ({
        position,
        part: index,
        off,
        label: off ? t.split.unselected : format(t.split.part, { n: index + 1 }),
      }));
    }),
    ...(unused.length > 0 && method === 'ranges'
      ? unused.map((position) => ({ position, part: -1, off: true, label: t.split.unused }))
      : []),
  ];

  const viewed = viewing === null ? undefined : marked.rows[viewing];
  const zipCount = byBookmarks ? chosenRows.length : parts.length;
  const zipLabel =
    byBookmarks && chosenRows.length < marked.rows.length
      ? format(t.split.downloadSome, { n: chosenRows.length, total: marked.rows.length })
      : format(t.split.downloadAll, { n: parts.length });

  return (
    <Split
      wide={byBookmarks}
      tools={
        <div class="split">
          <FileList />

          <fieldset class="split-method">
            <legend class="split-method__legend">{t.split.method}</legend>
            <label class="split-method__option">
              <input
                type="radio"
                name="split-method"
                checked={method === 'every'}
                onChange={() => setMethod('every')}
              />
              {t.split.every}
            </label>
            <div class="split-method__field">
              <label for="split-size">{t.split.size}</label>
              <input
                id="split-size"
                class="split-method__number"
                type="number"
                inputMode="numeric"
                min={1}
                max={pages.length}
                value={size}
                disabled={method !== 'every'}
                onInput={(event) => setSize(event.currentTarget.value)}
              />
            </div>
            <label class="split-method__option">
              <input
                type="radio"
                name="split-method"
                checked={method === 'ranges'}
                onChange={() => setMethod('ranges')}
              />
              {t.split.ranges}
            </label>
            <div class="split-method__field">
              <label for="split-ranges">{t.split.rangesLabel}</label>
              <input
                id="split-ranges"
                class="merge-range__input split-method__ranges"
                type="text"
                autocomplete="off"
                spellcheck={false}
                placeholder="1-3, 4-6, 7-"
                value={ranges}
                disabled={method !== 'ranges'}
                aria-invalid={problem !== null}
                aria-describedby={problem ? 'split-ranges-error' : undefined}
                onInput={(event) => setRanges(event.currentTarget.value)}
              />
              {problem && (
                <p id="split-ranges-error" class="merge-range__error" role="alert">
                  {problemText(problem)}
                </p>
              )}
            </div>
            {desktop && (
              <>
                <label class="split-method__option">
                  <input
                    type="radio"
                    name="split-method"
                    checked={byBookmarks}
                    onChange={() => setMethod('bookmarks')}
                  />
                  {t.split.bookmarks}
                </label>
                <BookmarkOptions
                  marks={marked.marks}
                  disabled={!byBookmarks}
                  level={level}
                  overlap={overlap}
                  prefix={prefix}
                  folders={folders}
                  onLevel={setLevel}
                  onOverlap={setOverlap}
                  onPrefix={setPrefix}
                  onFolders={setFolders}
                />
              </>
            )}
          </fieldset>

          {!byBookmarks && (
            <ol class="split-parts" aria-label={t.split.parts}>
              {parts.map((part, index) => {
                const label = format(t.split.part, { n: index + 1 });
                return (
                  <li key={`${index}-${part.join()}`} class="split-parts__item">
                    <span class="split-parts__name">{label}</span>
                    <span class="split-parts__pages">{pagesText(part)}</span>
                    <IconButton
                      icon="download"
                      label={format(t.split.downloadPart, { part: label })}
                      disabled={busy}
                      onClick={() => setRequest({ kind: 'part', index })}
                    />
                  </li>
                );
              })}
            </ol>
          )}

          <FilesToolbar label={t.split.actions}>
            <button
              type="button"
              class="button"
              disabled={busy || zipCount === 0}
              onClick={() => setRequest({ kind: 'zip' })}
            >
              <Icon name="download" />
              {zipLabel}
            </button>
          </FilesToolbar>

          <div class="tools-status">
            <p class="page-editor__status" aria-live="polite">
              {busy
                ? format(t.split.progress, { done: save.done, total: save.total })
                : plural(parts.length, t.split.countOne, t.split.countOther)}
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
              title={
                request.kind === 'zip'
                  ? t.split.saveAllTitle
                  : format(t.split.savePartTitle, { n: request.index + 1 })
              }
              suggestion={request.kind === 'zip' ? zipName : partName(parts[request.index]!)}
              extension={request.kind === 'zip' ? '.zip' : '.pdf'}
              onConfirm={(fileName) => void saveAs(request, fileName)}
              onCancel={() => setRequest(null)}
            />
          )}
          {viewed && (
            <PreviewDialog
              title={viewed.name}
              pages={viewed.positions.flatMap((position, i) => {
                const page = pages[position - 1]!;
                const source = sourceOf(page);
                if (!source) return [];
                return [
                  {
                    pdf: source.pdf,
                    pageNumber: page.source + 1,
                    rotation: page.rotation,
                    label: format(t.split.previewPage, {
                      n: i + 1,
                      total: viewed.positions.length,
                      p: position,
                    }),
                  },
                ];
              })}
              onClose={() => setViewing(null)}
            />
          )}
        </div>
      }
      view={
        <>
          <PaneHead
            title={t.merge.result}
            meta={
              byBookmarks ? undefined : plural(parts.length, t.split.countOne, t.split.countOther)
            }
          >
            {byBookmarks && (
              <div class="segmented split-view" role="group" aria-label={t.split.views.label}>
                {(['parts', 'pages'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    class="segmented__button"
                    aria-pressed={paneView === option}
                    onClick={() => setPaneView(option)}
                  >
                    {t.split.views[option]}
                  </button>
                ))}
              </div>
            )}
          </PaneHead>
          {/* Niet in de kop, die blijft staan: op een klein scherm houdt de tabel zo de ruimte. */}
          {byBookmarks && marked.loaded && marked.marks.length > 0 && (
            <p class="split-summary">{bookmarkSummary(t, pages.length, marked)}</p>
          )}
          {byBookmarks && <BookmarkNotes split={marked} />}
          {byBookmarks && paneView === 'parts' ? (
            marked.rows.length > 0 && (
              <BookmarkTable
                split={marked}
                busy={busy}
                onView={setViewing}
                onDownload={(index) => void downloadRow(index)}
              />
            )
          ) : (
            <ol class="thumbs thumbs--parts" aria-label={t.merge.result}>
              {entries.map(({ position, part, off, label }) => {
                const page = pages[position - 1]!;
                const source = sourceOf(page);
                if (!source) return null;
                const classes = [
                  off && 'thumbs__off',
                  !off && part % 2 === 1 && 'thumbs__part--alt',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <li key={`${part}-${position}-${page.key}`} class={classes || undefined}>
                    <Thumbnail
                      pdf={source.pdf}
                      pageNumber={page.source + 1}
                      rotation={page.rotation}
                      caption={position}
                      label={`${format(t.document.page, { n: position })}, ${label}`}
                    />
                    <span class="page-option__file" aria-hidden="true">
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      }
    />
  );
}
