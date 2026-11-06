import { Fragment, type ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { GAP_FACTOR } from '../compare/layout';
import { copyText } from '../compare/report';
import { ZOOM_STEPS, renderPage, stepZoom, targetWidths } from '../compare/visual';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Dropzone } from '../components/Dropzone';
import { IconButton } from '../components/Icon';
import { useDragReorder } from '../components/useDragReorder';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatFileSize } from '../lib/format';
import { downloadFile } from '../pdf/save';
import {
  clampZone,
  exportName,
  moveZone,
  quality,
  resizeZone,
  type Extraction,
  type Handle,
  type Zone,
} from './extract';
import {
  clearText,
  clearZones,
  editingZones,
  exportSettings,
  extract,
  getTextState,
  importSettings,
  openFiles,
  ownAllPages,
  ownPage,
  addBatchFiles,
  clearBatchFiles,
  moveBatchFile,
  moveBatchFileTo,
  removeBatchFile,
  removeZone,
  resetOptions,
  runBatch,
  setBatchCombine,
  setEdited,
  setFit,
  setMeta,
  setOptions,
  setBlock,
  setOwnPage,
  setPage,
  setJoin,
  setReadEmpty,
  setUseZones,
  setView,
  setZones,
  setZoom,
  undoZones,
  useTextState,
  type BatchStatus,
  type Fit,
  type TextBlock,
  type TextDoc,
  type TextView,
} from './store';
import { META_FIELDS } from './header';
import { JOINS, type Join } from './pages';
import { forgetStored } from './settings';

type Texts = ReturnType<typeof useI18n>['t'];

const VIEWS: readonly TextView[] = ['preview', 'result'];
const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const FITS: readonly Fit[] = ['page', 'width'];

/** Kleiner getekend dan dit (in beeldpunten, breed of hoog) telt niet als vak, zoals in de extractor. */
const MIN_ZONE_PX = 8;

/**
 * PDF → Platte tekst: een PDF openen, op het voorbeeld leesvakken tekenen die de leesvolgorde
 * bepalen, en dan de tekst eruit halen, om te kopiëren of als tekstbestand te downloaden. Werkt
 * los van de gewone taken; de stand staat buiten het scherm (`store.ts`). Overgenomen uit de losse
 * pdf-tekst-extractor, met dezelfde werkwijze: eerst de PDF zien en vakken zetten, dan pas
 * "Tekst extraheren". Bewuste afwijkingen: zonder vakken gaan terugkerende kop- en voetteksten er
 * standaard uit, en de alinea-gevoeligheid staat standaard op 1,3 (zie `DEFAULT_TEXT_OPTIONS`).
 * Zoals in de extractor is de tekst in het resultaat aan te passen vóór kopiëren of downloaden.
 */
export function TextTool() {
  const { t } = useI18n();
  const p = t.plainText;
  const { view, tooMany } = useTextState();
  return (
    <section class="workspace plaintext" aria-label={p.toolbar}>
      <div class="workspace__tools">
        <SlotView />
        {tooMany && (
          <p class="compare__note" role="status">
            {p.tooMany}
          </p>
        )}
        <ZoneSettings />
        <Settings />
        <MetaSettings />
        <PageSettings />
        <BatchSettings />
        <SaveSettings />
        <ExtractBar />
      </div>
      <div class="workspace__view" data-scroll-root>
        {view === 'preview' ? <Preview /> : <Output />}
      </div>
    </section>
  );
}

/** De keuze tussen het voorbeeld (vakken tekenen) en het resultaat (de tekst). */
function ViewToggle() {
  const { t } = useI18n();
  const v = t.plainText.views;
  const { view } = useTextState();
  return (
    <div class="segmented compare-view" role="group" aria-label={v.label}>
      {VIEWS.map((option) => (
        <button
          key={option}
          type="button"
          class="segmented__button"
          aria-pressed={view === option}
          onClick={() => setView(option)}
        >
          {v[option]}
        </button>
      ))}
    </div>
  );
}

/**
 * De balk boven het rechtervak, op één plek voor beide weergaven: de keuze voorbeeld of resultaat,
 * en wat daarbij hoort (bladeren en zoomen, of kopiëren en downloaden). Zo houdt de pagina zelf
 * zoveel mogelijk ruimte, zoals in de losse extractor.
 */
function Bar({ children }: { children?: ComponentChildren }) {
  return (
    <div class="plaintext-bar">
      <ViewToggle />
      {children}
    </div>
  );
}

/**
 * De PDF: kiezen of slepen, en Wissen, op één regel; daaronder wat er gelezen is. Geen plaatje van
 * de eerste pagina: die staat rechts al groot.
 */
function SlotView() {
  const { t, language } = useI18n();
  const p = t.plainText;
  const c = t.compare;
  const { slot, restored } = useTextState();
  return (
    <Dropzone
      title={p.slot.title}
      dropTitle={c.dropHere}
      hint={
        slot.status === 'empty'
          ? p.slot.hint
          : slot.status === 'ready'
            ? slot.doc.file.name
            : slot.name
      }
      inputId="plaintext-file"
      accept="application/pdf,.pdf"
      chooseLabel={slot.status === 'empty' ? p.slot.choose : p.slot.replace}
      onFiles={(files) => void openFiles(files)}
      extraClass="plaintext-slot"
    >
      <button
        type="button"
        class="button button--secondary plaintext-slot__clear"
        disabled={slot.status === 'empty'}
        onClick={clearText}
      >
        {p.clear}
      </button>
      {slot.status === 'reading' && (
        <p class="plaintext-slot__meta" role="status">
          {slot.total > 0 ? format(c.reading, { n: slot.done, total: slot.total }) : c.readingStart}
        </p>
      )}
      {slot.status === 'error' && (
        <p class="plaintext-slot__meta dropzone__error" role="alert">
          {c.errors[slot.code]}
        </p>
      )}
      {slot.status === 'ready' && (
        <p class="plaintext-slot__meta">
          {docMeta(slot.doc, t, language)}
          {restored && ` · ${p.restored}`}
        </p>
      )}
    </Dropzone>
  );
}

/** "3 pagina's · 12 KB", met het aantal pagina's zonder tekstlaag als dat er zijn. */
function docMeta(doc: TextDoc, t: Texts, language: string) {
  const c = t.compare;
  const noText = doc.pages.filter((page) => page.items.length === 0).length;
  return [
    plural(doc.pageCount, c.pagesOne, c.pages),
    formatFileSize(doc.file.size, language),
    noText > 0 && plural(noText, c.noTextOne, c.noText),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Een blok links dat je kunt in- en uitklappen, zoals de accordeons van de extractor. Hoe het staat,
 * blijft bewaard zolang de pagina open is.
 */
function Block({
  id,
  title,
  children,
}: {
  id: TextBlock;
  title: string;
  children: ComponentChildren;
}) {
  const { blocks } = useTextState();
  return (
    <details
      class="plaintext-block"
      open={blocks[id]}
      onToggle={(event) => setBlock(id, event.currentTarget.open)}
    >
      <summary class="plaintext-block__title">{title}</summary>
      <fieldset class="plaintext-block__body" aria-label={title}>
        {children}
      </fieldset>
    </details>
  );
}

/**
 * Leesvakken: aan of uit, eigen vakken voor deze pagina (of voor alle pagina's), de lijst met de
 * vakken die je op deze pagina bewerkt, Ongedaan, Alle vakken wissen, en wat er gebeurt met een
 * pagina zonder vakken. Zoals in de extractor.
 */
function ZoneSettings() {
  const { t } = useI18n();
  const z = t.plainText.zones;
  const state = useTextState();
  const { useZones, undo, slot, page, readEmpty } = state;
  const zones = editingZones(state);
  const own = ownPage(state);
  const ready = slot.status === 'ready';
  return (
    <Block id="zones" title={z.title}>
      <label class="compare-settings__check">
        <input
          type="checkbox"
          checked={useZones}
          aria-describedby="plaintext-zones-hint"
          onChange={(event) => setUseZones(event.currentTarget.checked)}
        />
        {z.use}
      </label>
      <p id="plaintext-zones-hint" class="compare-settings__hint">
        {z.useHint}
      </p>
      <label class="compare-settings__check">
        <input
          type="checkbox"
          checked={own}
          disabled={!useZones || !ready}
          aria-describedby="plaintext-own-hint"
          onChange={(event) => setOwnPage(event.currentTarget.checked)}
        />
        {z.own}
      </label>
      <p id="plaintext-own-hint" class="compare-settings__hint">
        {own ? format(z.ownOn, { n: page }) : z.ownOff}
      </p>
      {useZones &&
        (zones.length === 0 ? (
          <p class="plaintext-zones__empty">{own ? format(z.emptyOwn, { n: page }) : z.empty}</p>
        ) : (
          <ol class={`plaintext-zones${own ? ' plaintext-zones--own' : ''}`}>
            {zones.map((_, i) => (
              <li key={i} class="plaintext-zones__item">
                <span class="plaintext-zones__num" aria-hidden="true">
                  {i + 1}
                </span>
                <span class="plaintext-zones__label">{format(z.item, { n: i + 1 })}</span>
                <button
                  type="button"
                  class="plaintext-zones__remove"
                  aria-label={format(z.remove, { n: i + 1 })}
                  onClick={() => removeZone(i)}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        ))}
      <div class="plaintext-zones__buttons">
        <button
          type="button"
          class="button button--secondary"
          disabled={!useZones || undo.length === 0}
          onClick={undoZones}
        >
          {z.undo}
        </button>
        <button
          type="button"
          class="button button--secondary"
          disabled={!useZones || zones.length === 0}
          onClick={clearZones}
        >
          {z.clearAll}
        </button>
        <button
          type="button"
          class="button button--secondary"
          disabled={!useZones || !ready}
          title={z.allOwnHint}
          onClick={ownAllPages}
        >
          {z.allOwn}
        </button>
      </div>
      <label class="compare-settings__check">
        <input
          type="checkbox"
          checked={readEmpty}
          disabled={!useZones}
          aria-describedby="plaintext-read-empty-hint"
          onChange={(event) => setReadEmpty(event.currentTarget.checked)}
        />
        {z.readEmpty}
      </label>
      <p id="plaintext-read-empty-hint" class="compare-settings__hint">
        {z.readEmptyHint}
      </p>
      {useZones && <p class="compare-settings__hint">{z.drawHint}</p>}
    </Block>
  );
}

/** De aan- en uitzetters van de tekstopschoning. */
type BooleanOption =
  'joinLines' | 'dehyphen' | 'columns' | 'strip' | 'structure' | 'headingMarker' | 'tables';

/** Bij welke vinkjes een uitleg staat (de naam van de tekst). */
const HINTS = {
  structure: 'structureHint',
  headingMarker: 'headingMarkerHint',
  tables: 'tablesHint',
} as const satisfies Partial<Record<BooleanOption, string>>;

/** Hoe de tekst wordt opgebouwd; het werkt bij de volgende keer extraheren. */
function Settings() {
  const { t, language } = useI18n();
  const s = t.plainText.settings;
  const { options, useZones, readEmpty } = useTextState();
  // Wanneer een vinkje niets doet (en dus uit staat):
  // - kolommen en kop/voet gaan over de hele pagina; met leesvakken bepaal je dat zelf;
  // - bij tabellen geen kolommen (de kolommen van een tabel zouden als goot tellen);
  // - opsommingen, koppen en tabellen alleen als regels worden samengevoegd, zoals in de extractor.
  const off: Record<BooleanOption, boolean> = {
    joinLines: false,
    dehyphen: false,
    columns: (useZones && !readEmpty) || options.tables,
    strip: useZones,
    structure: !options.joinLines,
    headingMarker: !options.joinLines || !options.structure,
    tables: !options.joinLines,
  };
  const check = (key: BooleanOption, extra = '') => (
    <label key={key} class={`compare-settings__check${extra}`}>
      <input
        type="checkbox"
        checked={options[key]}
        disabled={off[key]}
        aria-describedby={key in HINTS ? `plaintext-${key}-hint` : undefined}
        onChange={(event) => setOptions({ [key]: event.currentTarget.checked })}
      />
      {s[key]}
    </label>
  );
  const hint = (key: BooleanOption & keyof typeof HINTS, extra = '') => (
    <p id={`plaintext-${key}-hint`} class={`compare-settings__hint${extra}`}>
      {s[HINTS[key]]}
    </p>
  );
  return (
    <Block id="clean" title={s.title}>
      {check('joinLines')}
      <div class="compare-settings__range plaintext__gap">
        <label for="plaintext-gap">{s.gap}</label>
        <input
          id="plaintext-gap"
          type="range"
          min={GAP_FACTOR.min}
          max={GAP_FACTOR.max}
          step={GAP_FACTOR.step}
          value={options.gapFactor}
          disabled={!options.joinLines}
          aria-describedby="plaintext-gap-hint"
          onInput={(event) => setOptions({ gapFactor: Number(event.currentTarget.value) })}
        />
        <output for="plaintext-gap">
          {options.gapFactor.toLocaleString(language, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })}
        </output>
      </div>
      <p id="plaintext-gap-hint" class="compare-settings__hint">
        {s.gapHint}
      </p>
      {check('dehyphen')}
      {check('columns')}
      {check('strip')}
      {check('structure')}
      {hint('structure')}
      {check('headingMarker', ' plaintext__sub')}
      {hint('headingMarker', ' plaintext__sub')}
      {check('tables')}
      {hint('tables')}
      {useZones && <p class="compare-settings__hint">{readEmpty ? s.zonesOffRead : s.zonesOff}</p>}
    </Block>
  );
}

/**
 * Documentkop en metadata, zoals in de extractor: een kop boven de tekst met de bestandsnaam en de
 * gegevens van de PDF, de velden om die gegevens aan te passen (met wat de PDF maakte ter
 * informatie), en het conventieblok. De velden horen bij de PDF: zonder PDF staan ze uit.
 */
function MetaSettings() {
  const { t } = useI18n();
  const h = t.plainText.header;
  const { options, slot, meta } = useTextState();
  const info = slot.status === 'ready' ? slot.doc.info : null;
  return (
    <Block id="meta" title={h.title}>
      <label class="compare-settings__check">
        <input
          type="checkbox"
          checked={options.header}
          aria-describedby="plaintext-header-hint"
          onChange={(event) => setOptions({ header: event.currentTarget.checked })}
        />
        {h.use}
      </label>
      <p id="plaintext-header-hint" class="compare-settings__hint">
        {h.useHint}
      </p>
      <div class="plaintext-meta">
        {META_FIELDS.map((field) => (
          <Fragment key={field}>
            <label for={`plaintext-meta-${field}`}>{h.fields[field]}</label>
            <input
              id={`plaintext-meta-${field}`}
              type="text"
              autocomplete="off"
              value={meta[field]}
              disabled={!info}
              aria-describedby="plaintext-meta-hint"
              onInput={(event) => setMeta({ [field]: event.currentTarget.value })}
            />
          </Fragment>
        ))}
      </div>
      <p id="plaintext-meta-hint" class="compare-settings__hint">
        {h.fieldsHint}
      </p>
      {info?.Producer && (
        <p class="plaintext-meta__info">{format(h.producer, { value: info.Producer })}</p>
      )}
      {info?.Creator && (
        <p class="plaintext-meta__info">{format(h.creator, { value: info.Creator })}</p>
      )}
      <label class="compare-settings__check plaintext-meta__conventions">
        <input
          type="checkbox"
          checked={options.conventions}
          aria-describedby="plaintext-conventions-hint"
          onChange={(event) => setOptions({ conventions: event.currentTarget.checked })}
        />
        {h.conventions}
      </label>
      <p id="plaintext-conventions-hint" class="compare-settings__hint">
        {h.conventionsHint}
      </p>
    </Block>
  );
}

/**
 * Pagina-overgangen: pagina-ankers {p#} met een concordantie, doorlopende zinnen over de
 * pagina-overgang, en per overgang de keuze automatisch, aaneen of gescheiden. In de extractor stond
 * die keuze in de bladerbalk; hier in dit blok, zodat de balk boven de pagina op één regel blijft.
 */
function PageSettings() {
  const { t } = useI18n();
  const g = t.plainText.pages;
  const { options, slot, page, joins } = useTextState();
  const ready = slot.status === 'ready';
  return (
    <Block id="pages" title={g.title}>
      <label class="compare-settings__check">
        <input
          type="checkbox"
          checked={options.anchors}
          aria-describedby="plaintext-anchors-hint"
          onChange={(event) => setOptions({ anchors: event.currentTarget.checked })}
        />
        {g.anchors}
      </label>
      <p id="plaintext-anchors-hint" class="compare-settings__hint">
        {g.anchorsHint}
      </p>
      <label class="compare-settings__check">
        <input
          type="checkbox"
          checked={options.crossPage}
          aria-describedby="plaintext-cross-hint"
          onChange={(event) => setOptions({ crossPage: event.currentTarget.checked })}
        />
        {g.crossPage}
      </label>
      <p id="plaintext-cross-hint" class="compare-settings__hint">
        {g.crossPageHint}
      </p>
      {options.crossPage &&
        (ready && page > 1 ? (
          <div class="plaintext-join">
            <label for="plaintext-join">{format(g.join, { n: page })}</label>
            <select
              id="plaintext-join"
              value={joins[page] ?? 'auto'}
              onChange={(event) => setJoin(page, event.currentTarget.value as Join)}
            >
              {JOINS.map((join) => (
                <option key={join} value={join}>
                  {g.joins[join]}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p class="compare-settings__hint">{g.joinFirst}</p>
        ))}
    </Block>
  );
}

/**
 * Batch (meerdere PDF's): eerst een lijst samenstellen (PDF's toevoegen, ook meerdere keren en
 * door ze te slepen; de volgorde aanpassen zoals bij Samenvoegen), dan "Batch extraheren": de
 * PDF's worden achter elkaar gelezen met de instellingen hierboven (zonder leesvakken), en er volgt
 * één download, een zip met per PDF een .txt of alles in één bestand. In de extractor begon de
 * batch meteen na het kiezen. Werkt los van de open PDF.
 */
function BatchSettings() {
  const { t } = useI18n();
  const p = t.plainText;
  const b = p.batch;
  const { batchCombine, batch, batchFiles, useZones } = useTextState();
  const running = batch.status === 'running';
  return (
    <Block id="batch" title={b.title}>
      <p class="compare-settings__hint">{b.hint}</p>
      {useZones && <p class="compare-settings__hint">{b.zonesHint}</p>}
      <Dropzone
        title={b.files}
        dropTitle={t.compare.dropHere}
        hint={b.addHint}
        inputId="plaintext-batch-files"
        accept="application/pdf,.pdf"
        chooseLabel={b.add}
        onFiles={addBatchFiles}
        extraClass="plaintext-batch-add"
      />
      <BatchList />
      {batchFiles.length > 0 && (
        <button
          type="button"
          class="button button--secondary plaintext-batch__clear"
          disabled={running}
          onClick={clearBatchFiles}
        >
          {b.clearList}
        </button>
      )}
      <label class="compare-settings__check">
        <input
          type="checkbox"
          checked={batchCombine}
          aria-describedby="plaintext-combine-hint"
          onChange={(event) => setBatchCombine(event.currentTarget.checked)}
        />
        {b.combine}
      </label>
      <p id="plaintext-combine-hint" class="compare-settings__hint">
        {b.combineHint}
      </p>
      <button
        type="button"
        class="button plaintext-batch__run"
        disabled={running || batchFiles.length === 0}
        onClick={() =>
          void runBatch({
            concordance: p.concordance,
            head: { fields: p.header.fields, conventions: p.conventions },
            batch: { start: b.start, end: b.end },
          })
        }
      >
        {b.run}
      </button>
      <BatchMessage batch={batch} t={t} />
    </Block>
  );
}

/**
 * De PDF's van de batch in volgorde, met dezelfde bediening als bij Samenvoegen: slepen (met de
 * muis, of op een aanraakscherm aan het greepje), omhoog en omlaag, en weghalen. Tijdens het
 * verwerken staat dat uit.
 */
function BatchList() {
  const { t } = useI18n();
  const b = t.plainText.batch;
  const m = t.merge;
  const { batchFiles, batch } = useTextState();
  const running = batch.status === 'running';
  const list = useRef<HTMLOListElement>(null);
  const { dragged, dropAt, handlers } = useDragReorder<number>({
    list,
    itemSelector: '.merge-list__item',
    direction: 'vertical',
    onDrop: (id, target) => moveBatchFileTo(id, target),
  });
  if (batchFiles.length === 0) return <p class="compare-settings__hint">{b.empty}</p>;
  const last = batchFiles.length - 1;
  return (
    <ol
      ref={list}
      class={`merge-list plaintext-batch-list${dragged !== null ? ' merge-list--dragging' : ''}`}
      aria-label={b.files}
    >
      {batchFiles.map(({ id, file }, index) => {
        const classes = [
          'merge-list__item',
          dragged === id && 'merge-list__item--dragging',
          dropAt === index && 'merge-list__item--drop-before',
          dropAt === batchFiles.length && index === last && 'merge-list__item--drop-after',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <li key={id} class={classes} data-index={index} {...(running ? {} : handlers(id))}>
            <div class="merge-list__head">
              {/* Alleen voor muis en vinger; met het toetsenbord gaan de pijlknoppen. */}
              <span class="drag-handle merge-list__handle" aria-hidden="true">
                ⠿
              </span>
              <span class="merge-list__position" aria-hidden="true">
                {index + 1}
              </span>
              <span class="merge-list__name" data-tip={file.name}>
                {file.name}
              </span>
              <span class="merge-list__actions">
                <IconButton
                  icon="arrowUp"
                  label={format(m.moveUp, { name: file.name })}
                  disabled={running || index === 0}
                  onClick={() => moveBatchFile(id, -1)}
                />
                <IconButton
                  icon="arrowDown"
                  label={format(m.moveDown, { name: file.name })}
                  disabled={running || index === last}
                  onClick={() => moveBatchFile(id, 1)}
                />
                <IconButton
                  icon="close"
                  label={format(m.remove, { name: file.name })}
                  disabled={running}
                  onClick={() => removeBatchFile(id)}
                />
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Wat de batch doet of gedaan heeft: de voortgang, of wat er verwerkt, mislukt en gedownload is. */
function BatchMessage({ batch, t }: { batch: BatchStatus; t: Texts }) {
  const b = t.plainText.batch;
  const box = useRef<HTMLDivElement>(null);
  // Bij het begin en het eind in beeld: op een klein scherm staat de melding anders onder de vaste
  // knop "Tekst extraheren", en zie je niet wat er gebeurd is.
  useLayoutEffect(() => {
    box.current?.scrollIntoView?.({ block: 'nearest' });
  }, [batch.status]);
  if (batch.status === 'idle') return null;
  if (batch.status === 'running') {
    const values = {
      i: batch.i,
      n: batch.total,
      name: batch.name,
      page: batch.page,
      pages: batch.pages,
    };
    return (
      <div ref={box} class="plaintext-batch__message" role="status">
        <p class="plaintext__done">{format(batch.pages > 0 ? b.readingPage : b.reading, values)}</p>
      </div>
    );
  }
  const failedCount =
    batch.failed.length > 0 ? format(b.failedCount, { n: batch.failed.length }) : '';
  const done = format(batch.combine ? b.doneCombined : b.doneZip, {
    ok: batch.ok,
    failed: failedCount,
  });
  return (
    <div ref={box} class="plaintext-batch__message" role="status">
      <p class="plaintext__done">
        {batch.download ? `${done} ${format(b.downloaded, { name: batch.download })}` : done}
      </p>
      {batch.problem && <p class="compare__warning">{b[batch.problem]}</p>}
      {batch.failed.length > 0 && (
        <p class="compare__note">
          {format(b.failed, {
            list: batch.failed.map((f) => `${f.label}: ${b.reasons[f.code]}`).join('; '),
          })}
        </p>
      )}
      {batch.noText.length > 0 && (
        <p class="compare__note">{format(b.noText, { list: batch.noText.join(', ') })}</p>
      )}
    </div>
  );
}

/**
 * Instellingen bewaren: de vakken en instellingen worden per bestandsnaam onthouden (in deze
 * browser). Opslaan en laden gaat met een .json-bestand in het formaat van de extractor. "Vergeten"
 * wist wat er voor alle PDF's onthouden is, na een vraag; in de extractor deed Reset dat ongevraagd.
 */
function SaveSettings() {
  const { t } = useI18n();
  const v = t.plainText.save;
  const { slot } = useTextState();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'defaults' | 'forget' | null>(null);
  const ready = slot.status === 'ready';
  return (
    <Block id="save" title={v.title}>
      <p class="compare-settings__hint">{v.hint}</p>
      <div class="plaintext-zones__buttons">
        <button
          type="button"
          class="button button--secondary"
          disabled={!ready}
          onClick={() => {
            const out = exportSettings();
            if (!out) return;
            downloadFile(new TextEncoder().encode(out.json), out.name, 'application/json');
            setStatus(format(v.exported, { name: out.name }));
          }}
        >
          {v.export}
        </button>
        <button
          type="button"
          class="button button--secondary"
          disabled={!ready}
          onClick={() => input.current?.click()}
        >
          {v.import}
        </button>
        <input
          ref={input}
          id="plaintext-settings-file"
          class="visually-hidden"
          type="file"
          accept="application/json,.json"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            void file
              .text()
              .then((text) => importSettings(JSON.parse(text)))
              .catch(() => false)
              .then((ok) =>
                setStatus(format(ok ? v.imported : v.importFailed, { name: file.name })),
              );
          }}
        />
        <button
          type="button"
          class="button button--secondary"
          onClick={() => setConfirming('defaults')}
        >
          {v.defaults}
        </button>
        <button
          type="button"
          class="button button--secondary"
          onClick={() => setConfirming('forget')}
        >
          {v.forget}
        </button>
      </div>
      {status && (
        <p class="plaintext__done" role="status">
          {status}
        </p>
      )}
      {confirming === 'defaults' && (
        <ConfirmDialog
          title={v.defaultsTitle}
          text={v.defaultsText}
          cancel={v.cancel}
          confirm={v.defaultsConfirm}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            resetOptions();
            setConfirming(null);
            setStatus(v.defaultsDone);
          }}
        />
      )}
      {confirming === 'forget' && (
        <ConfirmDialog
          title={v.forgetTitle}
          text={v.forgetText}
          cancel={v.cancel}
          confirm={v.forgetConfirm}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const n = forgetStored();
            setConfirming(null);
            setStatus(n === 0 ? v.forgottenNone : plural(n, v.forgottenOne, v.forgotten));
          }}
        />
      )}
    </Block>
  );
}

/** De knop "Tekst extraheren", vast onderaan het linkervak, met wat er gelezen is. */
function ExtractBar() {
  const { t, language } = useI18n();
  const p = t.plainText;
  const { slot, result } = useTextState();
  return (
    <div class="plaintext__extract">
      <button
        type="button"
        class="button"
        disabled={slot.status !== 'ready'}
        onClick={() =>
          extract({
            concordance: p.concordance,
            head: { fields: p.header.fields, conventions: p.conventions },
          })
        }
      >
        {p.extract}
      </button>
      {result && slot.status === 'ready' && (
        <p class="plaintext__done" role="status">
          {format(p.done, { summary: summary(result, slot.doc, t, language) })}
        </p>
      )}
    </div>
  );
}

/** "89.784 tekens · 16 van 16 pagina's gelezen". */
function summary(result: Extraction, doc: TextDoc, t: Texts, language: string) {
  const c = t.compare;
  const chars = result.text.length;
  return format(t.plainText.meta, {
    chars: format(chars === 1 ? c.charsOne : c.chars, { n: chars.toLocaleString(language) }),
    read: quality(result.pages).read,
    pages: plural(doc.pageCount, c.pagesOne, c.pages),
  });
}

/** Het voorbeeld: de pagina om leesvakken op te tekenen. */
function Preview() {
  const { t } = useI18n();
  const p = t.plainText;
  const { slot } = useTextState();
  if (slot.status !== 'ready') {
    return (
      <>
        <Bar />
        <p class="compare__placeholder">
          {slot.status === 'reading' ? t.compare.readingStart : p.placeholder}
        </p>
      </>
    );
  }
  return <PageView doc={slot.doc} />;
}

/** De getekende pagina van nu, of een fout. */
type Drawn = { canvas: HTMLCanvasElement } | { error: true };

function PageView({ doc }: { doc: TextDoc }) {
  const { t } = useI18n();
  const v = t.plainText.preview;
  const state = useTextState();
  const { page, fit, zoom, useZones } = state;
  const printed = doc.printed[page] ?? null;
  const size = doc.pages[page - 1] ?? { w: 595, h: 842 };
  const wrap = useRef<HTMLDivElement>(null);
  // De ruimte in het vak; zonder meting (zoals in een test) een redelijke schatting.
  const [space, setSpace] = useState({ w: 0, h: 0 });
  const [drawn, setDrawn] = useState<Drawn | null>(null);

  useLayoutEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const root = element.closest<HTMLElement>('[data-scroll-root]');
    const measure = () => {
      const top = root
        ? element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop
        : 0;
      // Onderaan heeft het vak opvulling; "hele pagina" moet echt passen, zonder schuifruimte, anders
      // schuift het scrollwiel eerst een stukje in plaats van door te bladeren.
      const padding = root ? parseFloat(getComputedStyle(root).paddingBottom) || 0 : 0;
      setSpace({ w: element.clientWidth, h: (root?.clientHeight ?? 0) - top - padding - 4 });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (root) observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const availW = space.w > 0 ? space.w : 600;
  const availH = space.h > 0 ? space.h : 800;
  const fitCss = fit === 'width' ? availW : Math.min(availW, (availH * size.w) / size.h);
  const widths = targetWidths(Math.floor(fitCss), zoom, window.devicePixelRatio);

  useEffect(() => {
    let cancelled = false;
    renderPage(doc.file, page, widths.dev)
      .then((canvas): Drawn => (canvas ? { canvas } : { error: true }))
      .catch((): Drawn => ({ error: true }))
      .then((next) => {
        if (!cancelled) setDrawn(next);
      });
    return () => {
      cancelled = true;
    };
  }, [doc, page, widths.dev]);

  // Toetsen: ← → (en PageUp/PageDown) bladeren, Home en End naar de eerste of laatste pagina,
  // Ctrl+Z maakt het laatste vak ongedaan. Niet in een invoerveld.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      const now = getTextState();
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'z') {
        if (!now.useZones) return;
        event.preventDefault();
        undoZones();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const to: Record<string, number> = {
        Home: 1,
        End: doc.pageCount,
        ArrowLeft: now.page - 1,
        PageUp: now.page - 1,
        ArrowRight: now.page + 1,
        PageDown: now.page + 1,
      };
      if (!(event.key in to)) return;
      event.preventDefault();
      setPage(to[event.key]!);
    };
    const target = document;
    target.addEventListener('keydown', onKey);
    return () => target.removeEventListener('keydown', onKey);
  }, [doc]);

  // Het scrollwiel bladert door aan de boven- of onderrand van het vak, zoals in de extractor.
  useEffect(() => {
    const root = wrap.current?.closest<HTMLElement>('[data-scroll-root]');
    if (!root) return;
    let locked = false;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const now = getTextState().page;
      const atTop = root.scrollTop <= 0;
      const atBottom = root.scrollTop + root.clientHeight >= root.scrollHeight - 1;
      const to =
        event.deltaY > 0 && atBottom && now < doc.pageCount
          ? now + 1
          : event.deltaY < 0 && atTop && now > 1
            ? now - 1
            : null;
      if (to === null) return;
      event.preventDefault();
      if (locked) return;
      locked = true;
      setTimeout(() => (locked = false), 250);
      setPage(to);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, [doc]);

  const lastZoom = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  const percent = Math.round((widths.css / size.w) * 100);
  return (
    <>
      <Bar>
        <div class="plaintext-nav" role="group" aria-label={v.nav} title={v.keys}>
          <button
            type="button"
            class="button button--secondary"
            aria-label={v.first}
            disabled={page <= 1}
            onClick={() => setPage(1)}
          >
            ‹‹
          </button>
          <button
            type="button"
            class="button button--secondary"
            aria-label={v.previous}
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            ‹
          </button>
          <span class="plaintext-nav__page">
            <span aria-hidden="true">
              {`${page} / ${doc.pageCount}`}
              {printed && <span class="plaintext-nav__printed">{` · ${printed}`}</span>}
            </span>
            <span class="visually-hidden">
              {printed
                ? format(v.pageDoc, { n: page, total: doc.pageCount, p: printed })
                : format(v.page, { n: page, total: doc.pageCount })}
            </span>
          </span>
          <button
            type="button"
            class="button button--secondary"
            aria-label={v.next}
            disabled={page >= doc.pageCount}
            onClick={() => setPage(page + 1)}
          >
            ›
          </button>
          <button
            type="button"
            class="button button--secondary"
            aria-label={v.last}
            disabled={page >= doc.pageCount}
            onClick={() => setPage(doc.pageCount)}
          >
            ››
          </button>
        </div>
        <div class="plaintext-zoom" role="group" aria-label={v.zoom}>
          <button
            type="button"
            class="button button--secondary"
            aria-label={v.zoomOut}
            disabled={zoom <= ZOOM_STEPS[0]}
            onClick={() => setZoom(stepZoom(zoom, -1))}
          >
            −
          </button>
          <output class="plaintext-zoom__value">{`${percent}%`}</output>
          <button
            type="button"
            class="button button--secondary"
            aria-label={v.zoomIn}
            disabled={zoom >= lastZoom}
            onClick={() => setZoom(stepZoom(zoom, 1))}
          >
            +
          </button>
          {FITS.map((option) => (
            <button
              key={option}
              type="button"
              class="button button--secondary"
              aria-pressed={fit === option && zoom === 100}
              onClick={() => setFit(option)}
            >
              {option === 'page' ? v.fitPage : v.fitWidth}
            </button>
          ))}
        </div>
      </Bar>
      <div class="plaintext-preview" ref={wrap}>
        {drawn && 'error' in drawn ? (
          <p class="compare-visual__msg">{v.error}</p>
        ) : (
          <div
            class="plaintext-preview__page"
            style={{ width: `${widths.css}px`, height: `${(widths.css * size.h) / size.w}px` }}
          >
            {drawn && (
              <CanvasBox
                canvas={drawn.canvas}
                width={widths.css}
                label={format(v.canvas, { n: page })}
              />
            )}
            {useZones && <ZoneLayer zones={editingZones(state)} own={ownPage(state)} />}
          </div>
        )}
      </div>
    </>
  );
}

/** Een getekend canvas op zijn weergavebreedte (getekend is het fijner, zie `targetWidths`). */
function CanvasBox({
  canvas,
  width,
  label,
}: {
  canvas: HTMLCanvasElement;
  width: number;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    canvas.className = 'plaintext-preview__canvas';
    canvas.style.width = `${width}px`;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
    box.current?.replaceChildren(canvas);
  }, [canvas, width, label]);
  return <div ref={box} />;
}

/** Wat je met de muis doet: een nieuw vak tekenen, een vak verplaatsen of een rand verslepen. */
type Action =
  | { kind: 'draw'; index: number; x: number; y: number }
  | { kind: 'move'; index: number; x: number; y: number; start: Zone }
  | { kind: 'resize'; index: number; handle: Handle; start: Zone };

/**
 * De leesvakken over de pagina: genummerd, te verplaatsen en met acht handgrepen te vergroten of
 * te verkleinen. Een sleep op een lege plek tekent een nieuw vak. Tijdens het slepen staan de
 * vakken alleen hier; bij loslaten gaan ze naar de stand (en kan het terug met Ongedaan).
 */
function ZoneLayer({ zones, own }: { zones: Zone[]; own: boolean }) {
  const layer = useRef<HTMLDivElement>(null);
  const action = useRef<Action | null>(null);
  const [live, setLive] = useState<Zone[] | null>(null);
  const latest = useRef<{ zones: Zone[]; live: Zone[] | null }>({ zones, live });
  latest.current = { zones, live };
  const shown = live ?? zones;

  const point = (event: MouseEvent) => {
    const rect = layer.current!.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / (rect.width || 1),
      y: (event.clientY - rect.top) / (rect.height || 1),
      rect,
    };
  };

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const now = action.current;
      if (!now) return;
      const { x, y } = point(event);
      const next = [...(latest.current.live ?? latest.current.zones)];
      if (now.kind === 'draw') next[now.index] = clampZone({ x0: now.x, y0: now.y, x1: x, y1: y });
      else if (now.kind === 'move') next[now.index] = moveZone(now.start, x - now.x, y - now.y);
      else next[now.index] = resizeZone(now.start, now.handle, x, y);
      setLive(next);
    };
    const onUp = (event: MouseEvent) => {
      const now = action.current;
      if (!now) return;
      action.current = null;
      const next = latest.current.live;
      setLive(null);
      if (!next) return;
      const zone = next[now.index]!;
      const { rect } = point(event);
      // Te klein getekend: geen vak (en geen stap om ongedaan te maken).
      if (
        now.kind === 'draw' &&
        ((zone.x1 - zone.x0) * rect.width < MIN_ZONE_PX ||
          (zone.y1 - zone.y0) * rect.height < MIN_ZONE_PX)
      )
        return;
      const before = latest.current.zones[now.index];
      if (before && JSON.stringify(before) === JSON.stringify(zone)) return;
      setZones(next);
    };
    // Op het hele venster: ook als de muis tijdens het slepen buiten de pagina komt.
    const target = window;
    target.addEventListener('mousemove', onMove);
    target.addEventListener('mouseup', onUp);
    return () => {
      target.removeEventListener('mousemove', onMove);
      target.removeEventListener('mouseup', onUp);
    };
  }, []);

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const { x, y } = point(event);
    const target = event.target as HTMLElement;
    const box = target.closest<HTMLElement>('[data-zone]');
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as
      Handle | undefined;
    if (box) {
      const index = Number(box.dataset.zone);
      const start = zones[index]!;
      action.current = handle
        ? { kind: 'resize', index, handle, start }
        : { kind: 'move', index, x, y, start };
      return;
    }
    action.current = { kind: 'draw', index: zones.length, x, y };
    setLive([...zones, { x0: x, y0: y, x1: x, y1: y }]);
  };

  return (
    <div class="plaintext-zones-layer" ref={layer} onMouseDown={onMouseDown} aria-hidden="true">
      {shown.map((zone, i) => (
        <div
          key={i}
          class={`plaintext-zone${own ? ' plaintext-zone--own' : ''}`}
          data-zone={i}
          style={{
            left: `${zone.x0 * 100}%`,
            top: `${zone.y0 * 100}%`,
            width: `${(zone.x1 - zone.x0) * 100}%`,
            height: `${(zone.y1 - zone.y0) * 100}%`,
          }}
        >
          <span class="plaintext-zone__num">{i + 1}</span>
          {HANDLES.map((h) => (
            <span
              key={h}
              class={`plaintext-zone__handle plaintext-zone__handle--${h}`}
              data-handle={h}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** "pagina 3", "pagina's 3, 5 en 7" of "pagina's 1–4 en 9": drie of meer op een rij als reeks. */
function pageList(pages: readonly number[], t: Texts) {
  const p = t.plainText;
  if (pages.length === 1) return format(p.pageOne, { n: pages[0]! });
  const parts: string[] = [];
  for (let i = 0; i < pages.length;) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j]! + 1) j++;
    if (j - i >= 2) parts.push(`${pages[i]}–${pages[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(pages[k]));
    i = j + 1;
  }
  const list =
    parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')}${p.and}${parts.at(-1)!}`;
  return format(p.pageMany, { list });
}

/** Het resultaat: de tekst, met kopiëren en downloaden, en wat er opvalt aan de tekstlaag. */
function Output() {
  const { t, language } = useI18n();
  const p = t.plainText;
  const { slot, result, edited, stale } = useTextState();
  // Wat er met de tekst gebeurd is (gekopieerd, gedownload), bij welke tekst: bij een andere tekst
  // hoort de melding er niet meer bij. (Geen effect om hem te wissen, zie PDF's vergelijken.)
  const [status, setStatus] = useState<{ result: Extraction | null; text: string } | null>(null);
  if (slot.status !== 'ready' || !result) {
    return (
      <>
        <Bar />
        <p class="compare__placeholder">
          {slot.status === 'ready'
            ? p.resultPlaceholder
            : slot.status === 'reading'
              ? t.compare.readingStart
              : p.placeholder}
        </p>
      </>
    );
  }
  const shown = status && status.result === result ? status.text : null;
  const q = quality(result.pages);
  const ready = result.text !== '';
  // Wat je kopieert en downloadt: de tekst zoals hij in het vak staat, met je aanpassingen.
  const text = edited ?? result.text;
  const meta = [
    summary(result, slot.doc, t, language),
    q.read > 0 && format(p.average, { n: q.average.toLocaleString(language) }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <>
      <Bar>
        <div class="plaintext-bar__actions">
          <button
            type="button"
            class="button button--secondary"
            disabled={text === ''}
            onClick={() =>
              void copyText(text).then((ok) =>
                setStatus({ result, text: ok ? p.copied : p.copyFailed }),
              )
            }
          >
            {p.copy}
          </button>
          <button
            type="button"
            class="button button--secondary"
            disabled={text === ''}
            onClick={() => {
              const file = exportName(slot.doc.file.name);
              downloadFile(new TextEncoder().encode(text), file, 'text/plain;charset=utf-8');
              setStatus({ result, text: format(p.downloaded, { name: file }) });
            }}
          >
            {p.download}
          </button>
        </div>
      </Bar>
      <p class="plaintext-bar__meta">{meta}</p>
      {shown && (
        <p class="page-editor__saved" role="status">
          {shown}
        </p>
      )}
      {stale && <p class="compare__note">{p.stale}</p>}
      {edited !== null && edited !== result.text && <p class="compare__note">{p.edited}</p>}
      {q.skipped.length > 0 &&
        (q.read === 0 ? (
          <p class="compare__warning">{p.noZones}</p>
        ) : (
          <p class="compare__note">{format(p.skippedPages, { list: pageList(q.skipped, t) })}</p>
        ))}
      {q.noText.length > 0 && (
        <p class="compare__warning">{format(p.noTextPages, { list: pageList(q.noText, t) })}</p>
      )}
      {q.low.length > 0 && (
        <p class="compare__warning">{format(p.lowPages, { list: pageList(q.low, t) })}</p>
      )}
      {ready ? (
        <textarea
          class="plaintext__output"
          aria-label={p.outputLabel}
          spellcheck={false}
          value={text}
          onInput={(event) => setEdited(event.currentTarget.value)}
        />
      ) : (
        <p class="compare__placeholder">{p.empty}</p>
      )}
      <p class="annotate__hint">{p.about}</p>
    </>
  );
}
