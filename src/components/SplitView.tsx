import { useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { chunkParts, formatRanges, parseParts, type RangeProblem } from '../pages/ranges';
import {
  PdfSaveError,
  buildParts,
  downloadFile,
  downloadPdf,
  editedFileName,
  readSources,
} from '../pdf/save';
import { makeZip } from '../lib/zip';
import { Icon, IconButton } from './Icon';
import { SaveDialog } from './SaveDialog';
import { Thumbnail } from './Thumbnail';
import { PaneHead, Split, useInfo } from './WorkspaceParts';

type Method = 'every' | 'ranges';

type SaveState =
  | { status: 'idle' }
  | { status: 'saving'; done: number; total: number }
  | { status: 'saved'; fileName: string }
  | { status: 'error'; code: 'encrypted' | 'failed' };

/** Wat er na het venster "Opslaan als" gedownload wordt: één deel, of alles als ZIP. */
type Request = { kind: 'part'; index: number } | { kind: 'zip' };

/**
 * Splitsen: de pagina's (in de volgorde van het pagina-plan, dus ook na bewerken bij
 * Pagina's) in delen knippen, per vast aantal pagina's of op bereiken. Elk deel kan los
 * worden gedownload, of alle delen samen als één ZIP.
 */
export function SplitView() {
  const { doc, pages, activeSources, sourceOf } = useDocument();
  const { t } = useI18n();
  const [method, setMethod] = useState<Method>('every');
  const [size, setSize] = useState('1');
  const [ranges, setRanges] = useState('');
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [request, setRequest] = useState<Request | null>(null);
  const info = useInfo(<p>{t.split.hint}</p>);

  // De delen als paginanummers (vanaf 1) in het plan, of wat er niet klopt aan de bereiken.
  let parts: number[][] = [];
  let problem: RangeProblem | null = null;
  if (method === 'every') {
    parts = chunkParts(pages.length, Number(size));
  } else if (ranges.trim() !== '') {
    const result = parseParts(ranges, pages.length);
    if (result.ok) parts = result.parts;
    else problem = result.error;
  }

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

  /** Maakt de PDF's van de gevraagde delen (bytes van de bronbestanden één keer gelezen). */
  const build = async (wanted: number[][]) => {
    const files = new Map(
      (doc.status === 'ready' ? doc.sources : []).map((source) => [source.id, source.file]),
    );
    const plans = wanted.map((part) => part.map((position) => pages[position - 1]!));
    const sources = await readSources(files, plans.flat());
    return buildParts(sources, plans, (done, total) => setSave({ status: 'saving', done, total }));
  };

  const saveAs = async (current: Request, fileName: string) => {
    setRequest(null);
    const wanted = current.kind === 'zip' ? parts : [parts[current.index]!];
    setSave({ status: 'saving', done: 0, total: wanted.length });
    try {
      const pdfs = await build(wanted);
      if (current.kind === 'zip') {
        const zip = await makeZip(
          wanted.map((part, i) => ({ name: partName(part), data: pdfs[i]! })),
        );
        downloadFile(zip, fileName, 'application/zip');
      } else {
        downloadPdf(pdfs[0]!, fileName);
      }
      setSave({ status: 'saved', fileName });
    } catch (error) {
      setSave({ status: 'error', code: error instanceof PdfSaveError ? error.code : 'failed' });
    }
  };

  const used = new Set(parts.flat());
  const unused = pages.map((_, i) => i + 1).filter((position) => !used.has(position));

  return (
    <Split
      tools={
        <div class="split">
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
          </fieldset>

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

          <div class="toolbar toolbar--tools" role="toolbar" aria-label={t.split.actions}>
            <div class="toolbar__group toolbar__group--wide">
              <button
                type="button"
                class="button"
                disabled={busy || parts.length === 0}
                onClick={() => setRequest({ kind: 'zip' })}
              >
                <Icon name="download" />
                {format(t.split.downloadAll, { n: parts.length })}
              </button>
            </div>
          </div>

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
        </div>
      }
      view={
        <>
          <PaneHead
            title={t.split.parts}
            meta={plural(parts.length, t.split.countOne, t.split.countOther)}
          />
          {[
            ...parts.map((part, index) => ({
              part,
              title: format(t.split.part, { n: index + 1 }),
            })),
            ...(unused.length > 0 && method === 'ranges'
              ? [{ part: unused, title: t.split.unused }]
              : []),
          ].map(({ part, title }) => (
            <section key={title} class="split-group" aria-label={title}>
              <h4 class="split-group__title">
                {title}
                <span class="split-group__meta">{pagesText(part)}</span>
              </h4>
              <ol class="thumbs">
                {part.map((position) => {
                  const page = pages[position - 1]!;
                  const source = sourceOf(page);
                  if (!source) return null;
                  return (
                    <li key={`${title}-${page.key}`}>
                      <Thumbnail
                        pdf={source.pdf}
                        pageNumber={page.source + 1}
                        rotation={page.rotation}
                        caption={position}
                        label={format(t.document.page, { n: position })}
                      />
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </>
      }
    />
  );
}
