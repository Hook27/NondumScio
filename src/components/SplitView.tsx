import { hasRedactions } from '../annotations/model';
import { SaveBusy, SaveStopped } from './SaveBusy';
import { useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useUndoShortcuts } from '../document/useUndoShortcuts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { useDesktop } from '../lib/useDesktop';
import { chunkParts, formatRanges, parseParts, type RangeProblem } from '../pages/ranges';
import {
  PdfSaveError,
  type PartReport,
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
import { Icon } from './Icon';
import { PreviewDialog } from './PreviewDialog';
import { SaveDialog } from './SaveDialog';
import { useSaveJob } from './useSaveJob';
import {
  BookmarkNotes,
  BookmarkOptions,
  BookmarkTable,
  bookmarkSummary,
  useBookmarkSplit,
  useRangeSplit,
} from './SplitBookmarks';
import { Thumbnail } from './Thumbnail';
import { PaneHead, Split, useInfo } from './WorkspaceParts';

type Method = 'every' | 'ranges' | 'bookmarks';

/** Wat rechts staat: de tabel met delen, of de pagina's per deel (bij elke manier van splitsen). */
type PaneView = 'parts' | 'pages';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving'; done: number; total: number }
  | { status: 'stopped' }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; code: SaveErrorCode };

/**
 * Splitsen: de pagina's (in de volgorde van het pagina-plan, dus ook na bewerken bij
 * Pagina's) in delen knippen, per vast aantal pagina's, op bereiken of (op de computer) op
 * bladwijzers. Bij elke manier dezelfde weergave: rechts de delen in een tabel (aan- of uitvinken,
 * de naam aanpassen, bekijken, los downloaden) of de pagina's per deel; alle gekozen delen samen
 * gaan als één ZIP.
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
  const job = useSaveJob();
  const [asking, setAsking] = useState(false);
  const info = useInfo(
    <>
      <p>{t.split.hint}</p>
      <p class="desktop-only">{t.split.bookmarksHint}</p>
    </>,
  );
  const marked = useBookmarkSplit(level, overlap, prefix, folders);
  const byBookmarks = method === 'bookmarks';

  const name = activeSources[0]?.name ?? '';
  // De voorgestelde naam van een deel: "rapport (pagina 3).pdf" of "rapport (pagina's 1-2).pdf".
  const partName = (part: readonly number[]) =>
    editedFileName(
      name,
      format(part.length === 1 ? t.split.fileOne : t.pages.extractSuffix, {
        ranges: formatRanges([...part]),
      }),
    );

  // Per aantal en op bereiken: de delen als paginanummers (vanaf 1) in het plan, of wat er niet
  // klopt aan de bereiken.
  let rangeParts: number[][] = [];
  let problem: RangeProblem | null = null;
  if (method === 'every') {
    rangeParts = chunkParts(pages.length, Number(size));
  } else if (method === 'ranges' && ranges.trim() !== '') {
    const result = parseParts(ranges, pages.length);
    if (result.ok) rangeParts = result.parts;
    else problem = result.error;
  }
  const ranged = useRangeSplit(rangeParts, partName);
  // Bij elke manier dezelfde rijen: aan- of uitvinken, de naam, de grootte. Alleen de aangevinkte
  // delen gaan in de ZIP.
  const split = byBookmarks ? marked : ranged;
  const parts = split.rows.map((row) => row.positions);
  const chosenRows = split.rows.filter((row) => row.include);
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
    signal: AbortSignal,
    wanted: number[][],
    onPart?: (bytes: Uint8Array, index: number, report: PartReport) => void,
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
      signal,
    );
  };

  /** De aangevinkte delen als één ZIP, elk onder zijn naam uit de tabel. */
  const saveZip = async (fileName: string) => {
    setAsking(false);
    const zipParts = chosenRows.map((row) => row.positions);
    const zipNames = uniqueNames(chosenRows.map((row) => row.path));
    // Op bladwijzers krijgt elk deel de titel van zijn bladwijzer.
    const titles = byBookmarks ? chosenRows.map((row) => row.title) : undefined;
    // Waar elk gekozen deel in de tabel staat (om zijn grootte te tonen).
    const chosenIndices = split.rows.flatMap((row, index) => (row.include ? [index] : []));
    setSave({ status: 'saving', done: 0, total: zipParts.length });
    const outcome = await job.run(async (signal) => {
      // Elk deel gaat meteen de ZIP in, zodat niet alle delen tegelijk in het geheugen staan.
      const zip = await zipWriter();
      await build(
        signal,
        zipParts,
        (bytes, i, report) => {
          try {
            zip.add(zipNames[i]!, bytes);
          } catch (error) {
            throw error instanceof ZipTooLargeError ? new PdfSaveError('tooLarge') : error;
          }
          split.setSize(chosenIndices[i]!, {
            size: bytes.length,
            untrimmed: report?.untrimmed ?? 0,
          });
        },
        titles,
      );
      return () => downloadFile(zip.finish(), fileName, 'application/zip');
    });
    // Gestopt (of weggegaan: dan is dit scherm er niet meer en doet dit niets). Niets downloaden.
    if (!outcome.ok && outcome.stopped) {
      setSave({ status: 'stopped' });
      return;
    }
    if (!outcome.ok) {
      const { error } = outcome;
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
      return;
    }
    outcome.value();
    setSave({ status: 'saved', fileName });
  };

  /** Een deel meteen downloaden, onder de naam uit de tabel (zoals de losse bladwijzer-tool). */
  const downloadRow = async (index: number) => {
    const row = split.rows[index]!;
    setSave({ status: 'saving', done: 0, total: 1 });
    const outcome = await job.run(async (signal) => {
      let pdf: Uint8Array = new Uint8Array();
      await build(
        signal,
        [row.positions],
        (bytes, _, report) => {
          pdf = bytes;
          split.setSize(index, { size: bytes.length, untrimmed: report?.untrimmed ?? 0 });
        },
        byBookmarks ? [row.title] : undefined,
      );
      return pdf;
    });
    // Gestopt (of weggegaan: dan is dit scherm er niet meer en doet dit niets). Niets downloaden.
    if (!outcome.ok && outcome.stopped) {
      setSave({ status: 'stopped' });
      return;
    }
    if (!outcome.ok) {
      const { error } = outcome;
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
      return;
    }
    downloadPdf(outcome.value, row.fileName);
    setSave({ status: 'saved', fileName: row.fileName });
  };

  const used = new Set(parts.flat());
  const unused = pages.map((_, i) => i + 1).filter((position) => !used.has(position));
  // Alle pagina's in één raster, elk met het deel waar hij bij hoort; gedempt als hij niet in een
  // (gekozen) deel zit.
  const entries = [
    ...parts.flatMap((part, index) => {
      const off = !split.rows[index]!.include;
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

  const viewed = viewing === null ? undefined : split.rows[viewing];
  const zipLabel =
    chosenRows.length < split.rows.length
      ? format(t.split.downloadSome, { n: chosenRows.length, total: split.rows.length })
      : format(t.split.downloadAll, { n: parts.length });

  return (
    <Split
      wide
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

          <FilesToolbar label={t.split.actions}>
            <button
              type="button"
              class="button"
              disabled={busy || chosenRows.length === 0}
              onClick={() => setAsking(true)}
            >
              <Icon name="download" />
              {zipLabel}
            </button>
          </FilesToolbar>

          <div class="tools-status">
            <p class="page-editor__status" aria-live="polite">
              {plural(parts.length, t.split.countOne, t.split.countOther)}
            </p>
            {info.button}
          </div>
          {info.panel}
          {save.status === 'saving' && (
            <SaveBusy
              text={format(t.split.progress, { done: save.done, total: save.total })}
              onStop={job.stop}
            />
          )}
          {save.status === 'stopped' && <SaveStopped />}
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
              title={t.split.saveAllTitle}
              suggestion={zipName}
              extension=".zip"
              onConfirm={(fileName) => void saveZip(fileName)}
              onCancel={() => setAsking(false)}
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
            meta={plural(parts.length, t.split.countOne, t.split.countOther)}
          >
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
          </PaneHead>
          {/* Niet in de kop, die blijft staan: op een klein scherm houdt de tabel zo de ruimte. */}
          {split.loaded && (byBookmarks ? marked.marks.length > 0 : split.rows.length > 0) && (
            <p class="split-summary">{bookmarkSummary(t, pages.length, split, byBookmarks)}</p>
          )}
          <BookmarkNotes split={split} bookmarks={byBookmarks} />
          {paneView === 'parts' ? (
            split.rows.length > 0 && (
              <BookmarkTable
                split={split}
                titleHeader={byBookmarks ? t.split.table.title : t.split.table.part}
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
