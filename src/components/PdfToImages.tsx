import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { useDocument } from '../document/DocumentContext';
import { useUndoShortcuts } from '../document/useUndoShortcuts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { withoutPdfExtension } from '../lib/fileName';
import { annotationsOf, hasRedactions, redactionsOf } from '../annotations/model';
import { ZipTooLargeError, zipWriter } from '../lib/zip';
import { renderPageImage, type ImageFormat } from '../pdf/images';
import { downloadFile } from '../pdf/save';
import { RadioGroup } from './ConvertParts';
import { FileList, FilesToolbar, ResultPane, useFilePicking } from './FilesParts';
import { Icon } from './Icon';
import { SaveDialog } from './SaveDialog';
import { Split, useInfo } from './WorkspaceParts';

type Quality = 'low' | 'good' | 'high';
type Dpi = '72' | '150' | '300';

/** JPEG-kwaliteit per keuze. */
const QUALITY: Record<Quality, number> = { low: 0.7, good: 0.85, high: 0.95 };

type SaveState =
  | { status: 'idle' }
  | { status: 'saving'; done: number; total: number }
  | { status: 'saved'; fileName: string; reduced: boolean }
  | { status: 'error'; tooLarge: boolean };

/**
 * PDF naar afbeeldingen: elke pagina van wat er openstaat (één of meer PDF's, in de volgorde
 * van het pagina-plan) wordt een PNG of JPG. De bestanden en pagina's beheer je net als bij
 * Samenvoegen. Eén afbeelding gaat los, meer samen in één ZIP. Het tekenen gebeurt pagina voor
 * pagina, zodat ook een lang document het geheugen niet vol zet.
 */
export function PdfToImages({ head }: { head: ComponentChildren }) {
  const { pages, activeSources, sourceOf, annotations, undo, redo, unsaved } = useDocument();
  const { t } = useI18n();
  useUndoShortcuts(undo, redo);
  const { picking, pickingSource, showPicker } = useFilePicking();
  const [imageFormat, setImageFormat] = useState<ImageFormat>('png');
  const [quality, setQuality] = useState<Quality>('good');
  const [dpi, setDpi] = useState<Dpi>('150');
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const [asking, setAsking] = useState(false);
  const info = useInfo(
    <>
      <p>{t.convert.toImagesHint}</p>
      <p>{t.merge.pagesHint}</p>
    </>,
  );

  const extension = imageFormat === 'png' ? '.png' : '.jpg';
  const mime = imageFormat === 'png' ? 'image/png' : 'image/jpeg';
  const several = pages.length > 1;
  const manyFiles = activeSources.length > 1;
  const digits = String(pages.length).length;
  const baseName = withoutPdfExtension(activeSources[0]?.name ?? '');
  const zipName = `${baseName} (${t.convert.zipSuffix}).zip`;
  const busy = save.status === 'saving';
  const countText = plural(pages.length, t.convert.willMakeOne, t.convert.willMakeOther);

  /**
   * De naam van de afbeelding van de pagina op plek `position` (vanaf 1) in het resultaat.
   * Uit één bestand: "rapport (pagina 3)", met het paginanummer in dat bestand. Uit meer
   * bestanden komt de plek in het resultaat vooraan ("01 - rapport (pagina 3)"), zodat de ZIP
   * op volgorde van het resultaat staat. `pad` vult nummers aan met nullen, zodat ze ook
   * alfabetisch goed staan.
   */
  const imageName = (position: number, pad: boolean) => {
    const page = pages[position - 1]!;
    const source = sourceOf(page);
    if (!source)
      return `${format(t.convert.fileName, { name: baseName, n: position })}${extension}`;
    const name = withoutPdfExtension(source.name);
    if (!manyFiles) {
      const n = String(page.source + 1).padStart(pad ? String(source.pageCount).length : 0, '0');
      return `${format(t.convert.fileName, { name, n })}${extension}`;
    }
    const place = String(position).padStart(pad ? digits : 0, '0');
    return `${place} - ${format(t.convert.fileName, { name, n: page.source + 1 })}${extension}`;
  };

  const make = async (fileName: string) => {
    setAsking(false);
    setSave({ status: 'saving', done: 0, total: pages.length });
    try {
      // Bij meer pagina's gaat elke afbeelding meteen de ZIP in, zodat ze niet allemaal tegelijk
      // in het geheugen staan.
      const zip = pages.length > 1 ? await zipWriter() : null;
      let single: Uint8Array | null = null;
      let reduced = false;
      for (const [index, page] of pages.entries()) {
        const source = sourceOf(page);
        if (!source) throw new Error('Het bestand van deze pagina is niet meer open');
        const result = await renderPageImage(source.pdf, page.source + 1, page.rotation, {
          dpi: Number(dpi),
          format: imageFormat,
          quality: QUALITY[quality],
          // Redactievakken worden altijd zwart in de afbeelding gezet.
          redactions: redactionsOf(annotationsOf(annotations, page.key)),
        });
        reduced ||= result.reduced;
        if (zip) zip.add(imageName(index + 1, true), result.bytes);
        else single = result.bytes;
        setSave({ status: 'saving', done: index + 1, total: pages.length });
        // Tussen de pagina's krijgt de browser even lucht, zodat de pagina blijft reageren.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (zip) downloadFile(zip.finish(), fileName, 'application/zip');
      else if (single) downloadFile(single, fileName, mime);
      else throw new Error('Geen pagina om om te zetten');
      setSave({ status: 'saved', fileName, reduced });
    } catch (error) {
      setSave({ status: 'error', tooLarge: error instanceof ZipTooLargeError });
    }
  };

  return (
    <Split
      head={head}
      tools={
        <div class="merge convert">
          <FileList picking={picking} onPick={showPicker} />

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

          <FilesToolbar label={t.convert.actions}>
            <button
              type="button"
              class="button"
              disabled={busy || pages.length === 0}
              onClick={() => setAsking(true)}
            >
              <Icon name="download" />
              {several ? format(t.convert.downloadAll, { n: pages.length }) : t.convert.downloadOne}
            </button>
          </FilesToolbar>

          <div class="tools-status">
            <p class="page-editor__status" aria-live="polite">
              {busy
                ? format(t.convert.progress, { done: save.done, total: save.total })
                : [countText, unsaved && t.pages.unsaved].filter(Boolean).join(' · ')}
            </p>
            {info.button}
          </div>
          {info.panel}
          {annotations.some(
            (a) => a.kind !== 'redact' && pages.some((page) => page.key === a.page),
          ) && <p class="page-editor__status">{t.convert.noAnnotations}</p>}
          {hasRedactions(pages, annotations) && (
            <p class="page-editor__status">{t.convert.redactionsApplied}</p>
          )}
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
              {save.tooLarge ? t.pages.errors.tooLarge : t.convert.imagesFailed}
            </p>
          )}
          {asking && (
            <SaveDialog
              title={several ? t.convert.saveAllTitle : t.convert.saveOneTitle}
              suggestion={several ? zipName : imageName(1, false)}
              extension={several ? '.zip' : extension}
              onConfirm={(fileName) => void make(fileName)}
              onCancel={() => setAsking(false)}
            />
          )}
        </div>
      }
      view={<ResultPane pickingSource={pickingSource} onPick={showPicker} />}
    />
  );
}
