import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { makeZip } from '../lib/zip';
import { formatRanges, parseRanges, type RangeProblem } from '../pages/ranges';
import { renderPageImage, type ImageFormat } from '../pdf/images';
import { downloadFile } from '../pdf/save';
import { withoutPdfExtension } from '../lib/fileName';
import { RadioGroup } from './ConvertParts';
import { Icon } from './Icon';
import { SaveDialog } from './SaveDialog';
import { Thumbnail } from './Thumbnail';
import { PaneHead, Split, useInfo } from './WorkspaceParts';

type Quality = 'low' | 'good' | 'high';
type Dpi = '72' | '150' | '300';
type Which = 'all' | 'some';

/** JPEG-kwaliteit per keuze. */
const QUALITY: Record<Quality, number> = { low: 0.7, good: 0.85, high: 0.95 };

type SaveState =
  | { status: 'idle' }
  | { status: 'saving'; done: number; total: number }
  | { status: 'saved'; fileName: string; reduced: boolean }
  | { status: 'error' };

/**
 * PDF naar afbeeldingen: elke pagina (in de volgorde van het pagina-plan, dus ook na
 * bewerken bij Pagina's) wordt een PNG of JPG. Eén afbeelding gaat los, meer samen in één
 * ZIP. Het tekenen gebeurt pagina voor pagina, zodat ook een lang document het geheugen
 * niet vol zet.
 */
export function PdfToImages({ head }: { head: ComponentChildren }) {
  const { pages, activeSources, sourceOf } = useDocument();
  const { t } = useI18n();
  const [imageFormat, setImageFormat] = useState<ImageFormat>('png');
  const [quality, setQuality] = useState<Quality>('good');
  const [dpi, setDpi] = useState<Dpi>('150');
  const [which, setWhich] = useState<Which>('all');
  const [ranges, setRanges] = useState('');
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [asking, setAsking] = useState(false);
  const info = useInfo(<p>{t.convert.toImagesHint}</p>);

  // Welke pagina's (nummers vanaf 1 in het plan) worden omgezet, of wat er niet klopt.
  let chosen: number[] = pages.map((_, i) => i + 1);
  let problem: RangeProblem | null = null;
  if (which === 'some') {
    const result = parseRanges(ranges, pages.length);
    if (result.ok) chosen = result.pages;
    else {
      chosen = [];
      // Een leeg veld is nog geen fout, alleen nog niets gekozen.
      if (ranges.trim() !== '') problem = result.error;
    }
  }

  const name = withoutPdfExtension(activeSources[0]?.name ?? '');
  const extension = imageFormat === 'png' ? '.png' : '.jpg';
  const mime = imageFormat === 'png' ? 'image/png' : 'image/jpeg';
  const imageName = (position: number, digits = 0) =>
    `${format(t.convert.fileName, { name, n: String(position).padStart(digits, '0') })}${extension}`;
  const digits = String(pages.length).length;
  const zipName = `${name} (${t.convert.zipSuffix}).zip`;
  const several = chosen.length > 1;
  const busy = save.status === 'saving';
  const countText = format(t.convert.willMake, { n: chosen.length, total: pages.length });

  const problemText = (error: RangeProblem) => {
    if (error.code === 'empty') return t.merge.rangeErrors.empty;
    if (error.code === 'invalid') return format(t.merge.rangeErrors.invalid, { part: error.part });
    return format(plural(pages.length, t.split.outOfRangeOne, t.split.outOfRangeOther), {
      page: error.page,
      n: pages.length,
    });
  };

  const make = async (fileName: string) => {
    setAsking(false);
    setSave({ status: 'saving', done: 0, total: chosen.length });
    try {
      const files: { name: string; data: Uint8Array }[] = [];
      let reduced = false;
      for (const position of chosen) {
        const page = pages[position - 1]!;
        const source = sourceOf(page);
        if (!source) throw new Error('Het bestand van deze pagina is niet meer open');
        const result = await renderPageImage(source.pdf, page.source + 1, page.rotation, {
          dpi: Number(dpi),
          format: imageFormat,
          quality: QUALITY[quality],
        });
        reduced ||= result.reduced;
        files.push({ name: imageName(position, digits), data: result.bytes });
        setSave({ status: 'saving', done: files.length, total: chosen.length });
        // Tussen de pagina's krijgt de browser even lucht, zodat de pagina blijft reageren.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (files.length === 1) downloadFile(files[0]!.data, fileName, mime);
      else downloadFile(await makeZip(files), fileName, 'application/zip');
      setSave({ status: 'saved', fileName, reduced });
    } catch {
      setSave({ status: 'error' });
    }
  };

  return (
    <Split
      head={head}
      tools={
        <div class="convert">
          <RadioGroup
            legend={t.convert.format}
            name="image-format"
            value={imageFormat}
            onChange={setImageFormat}
            options={[
              { value: 'png', label: t.convert.png },
              { value: 'jpeg', label: t.convert.jpeg },
            ]}
          >
            <div class="convert__field">
              <label for="image-quality" class="convert__label">
                {t.convert.quality}
              </label>
              <select
                id="image-quality"
                class="convert__select"
                value={quality}
                disabled={imageFormat !== 'jpeg'}
                onChange={(event) => setQuality(event.currentTarget.value as Quality)}
              >
                <option value="low">{t.convert.qualityLow}</option>
                <option value="good">{t.convert.qualityGood}</option>
                <option value="high">{t.convert.qualityHigh}</option>
              </select>
            </div>
          </RadioGroup>
          <RadioGroup
            legend={t.convert.resolution}
            name="image-dpi"
            value={dpi}
            onChange={setDpi}
            options={[
              { value: '72', label: t.convert.dpi72 },
              { value: '150', label: t.convert.dpi150 },
              { value: '300', label: t.convert.dpi300 },
            ]}
          />
          <fieldset class="split-method">
            <legend class="split-method__legend">{t.convert.pagesGroup}</legend>
            <label class="split-method__option">
              <input
                type="radio"
                name="image-pages"
                checked={which === 'all'}
                onChange={() => setWhich('all')}
              />
              {t.convert.allPages}
            </label>
            <label class="split-method__option">
              <input
                type="radio"
                name="image-pages"
                checked={which === 'some'}
                onChange={() => setWhich('some')}
              />
              {t.convert.somePages}
            </label>
            <div class="split-method__field">
              <label for="image-ranges">{t.convert.rangesLabel}</label>
              <input
                id="image-ranges"
                class="merge-range__input split-method__ranges"
                type="text"
                autocomplete="off"
                spellcheck={false}
                placeholder="1-3, 5, 8-"
                value={ranges}
                disabled={which !== 'some'}
                aria-invalid={problem !== null}
                aria-describedby={problem ? 'image-ranges-error' : undefined}
                onInput={(event) => setRanges(event.currentTarget.value)}
              />
              {problem && (
                <p id="image-ranges-error" class="merge-range__error" role="alert">
                  {problemText(problem)}
                </p>
              )}
            </div>
          </fieldset>

          <div
            class="toolbar toolbar--tools toolbar--bar-only"
            role="toolbar"
            aria-label={t.convert.actions}
          >
            <div class="toolbar__group toolbar__group--wide">
              <button
                type="button"
                class="button"
                disabled={busy || chosen.length === 0}
                onClick={() => setAsking(true)}
              >
                <Icon name="download" />
                {several
                  ? format(t.convert.downloadAll, { n: chosen.length })
                  : t.convert.downloadOne}
              </button>
            </div>
          </div>

          <div class="tools-status">
            <p class="page-editor__status" aria-live="polite">
              {busy
                ? format(t.convert.progress, { done: save.done, total: save.total })
                : countText}
            </p>
            {info.button}
          </div>
          {info.panel}
          {save.status === 'saved' && (
            <>
              <p class="page-editor__saved" role="status">
                {format(t.pages.saved, { name: save.fileName })}
              </p>
              {save.reduced && <p class="page-editor__status">{t.convert.reduced}</p>}
            </>
          )}
          {save.status === 'error' && (
            <p class="page-editor__error" role="alert">
              {t.convert.imagesFailed}
            </p>
          )}
          {asking && (
            <SaveDialog
              title={several ? t.convert.saveAllTitle : t.convert.saveOneTitle}
              suggestion={several ? zipName : imageName(chosen[0]!)}
              extension={several ? '.zip' : extension}
              onConfirm={(fileName) => void make(fileName)}
              onCancel={() => setAsking(false)}
            />
          )}
        </div>
      }
      view={
        <>
          <PaneHead title={t.document.pagesTitle} meta={countText} />
          <ol
            class="thumbs"
            aria-label={format(t.document.thumbnails, { name: activeSources[0]?.name ?? '' })}
          >
            {pages.map((page, index) => {
              const source = sourceOf(page);
              if (!source) return null;
              const included = chosen.includes(index + 1);
              return (
                <li key={`page-${page.key}`} class={included ? undefined : 'thumbs__off'}>
                  <Thumbnail
                    pdf={source.pdf}
                    pageNumber={page.source + 1}
                    rotation={page.rotation}
                    caption={index + 1}
                    label={format(t.document.page, { n: index + 1 })}
                  />
                </li>
              );
            })}
          </ol>
          {chosen.length > 0 && chosen.length < pages.length && (
            <p class="pane-head__meta">{formatRanges(chosen)}</p>
          )}
        </>
      }
    />
  );
}
