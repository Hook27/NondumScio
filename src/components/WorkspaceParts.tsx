import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import { useDocument, type FileError } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { formatFileSize } from '../lib/format';
import { IconButton } from './Icon';
import { Thumbnail } from './Thumbnail';

/**
 * Het splitscherm voor een geopend document: links het gereedschap (blijft in beeld),
 * rechts de pagina's. Op een breed scherm scrollt elk vak los; op een smal scherm staan ze
 * onder elkaar en blijft de knoppenbalk bovenaan hangen.
 */
export function Split({
  head,
  tools,
  view,
}: {
  /** Boven de naam van het document, bijvoorbeeld een keuze tussen twee soorten omzetten. */
  head?: ComponentChildren;
  tools: ComponentChildren;
  view: ComponentChildren;
}) {
  return (
    <section class="workspace" aria-labelledby="document-title">
      <div class="workspace__tools">
        {head}
        <DocumentBar />
        <FileErrors />
        {tools}
      </div>
      {/* Scrolt op een breed scherm zelf: de miniaturen houden hun marge dan rond dit vak. */}
      <div class="workspace__view" data-scroll-root>
        {view}
      </div>
    </section>
  );
}

/** Kop van een vak, met een titel die de focus kan krijgen als het vak wisselt. */
export function PaneHead({
  title,
  titleId,
  meta,
  sticky,
  children,
}: {
  title: string;
  titleId?: string;
  meta?: string;
  /** Blijft op een smal scherm onder de knoppenbalk hangen. */
  sticky?: boolean;
  children?: ComponentChildren;
}) {
  return (
    <div class={`pane-head${sticky ? ' pane-head--sticky' : ''}`}>
      <div>
        <h3 id={titleId} class="pane-head__title" tabIndex={-1}>
          {title}
        </h3>
        {meta && <p class="pane-head__meta">{meta}</p>}
      </div>
      {children}
    </div>
  );
}

/** Naam, aantal pagina's en grootte van wat er open staat, met Sluiten. */
function DocumentBar() {
  const { close, pages, activeSources } = useDocument();
  const { t, language } = useI18n();
  const title =
    activeSources.length > 1
      ? format(t.document.files, { n: activeSources.length })
      : (activeSources[0]?.name ?? '');
  const size = activeSources.reduce((total, source) => total + source.size, 0);
  return (
    <div class="document__bar">
      <div class="document__info">
        <h2 id="document-title" class="document__name">
          {title}
        </h2>
        <p class="document__meta">
          {plural(pages.length, t.document.pagesOne, t.document.pagesOther)} ·{' '}
          {formatFileSize(size, language)}
        </p>
      </div>
      <IconButton icon="close" label={t.document.close} onClick={close} />
    </div>
  );
}

/** De foutmelding voor een bestand dat niet geopend kon worden. */
export function useErrorText() {
  const { t } = useI18n();
  return (error: FileError) =>
    format(
      {
        'not-pdf': t.document.errors.notPdf,
        password: t.document.errors.password,
        damaged: t.document.errors.damaged,
      }[error.code],
      { name: error.name },
    );
}

/** Meldingen voor bestanden die niet geopend konden worden (de rest werkt gewoon). */
export function FileErrors() {
  const { fileErrors } = useDocument();
  const errorText = useErrorText();
  if (fileErrors.length === 0) return null;
  return (
    <div class="file-errors" role="alert">
      {fileErrors.map((error, i) => (
        <p key={`${i}-${error.name}`}>{errorText(error)}</p>
      ))}
    </div>
  );
}

/**
 * Uitleg achter een ⓘ-knop: geeft de knop en het (in- of uitgeklapte) vak terug, zodat de
 * knop in een balk kan staan en de uitleg eronder.
 */
export function useInfo(children: ComponentChildren) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();
  return {
    button: (
      <IconButton
        icon="info"
        label={t.info}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      />
    ),
    panel: (
      <div id={id} class="info-panel" hidden={!open}>
        {children}
      </div>
    ),
  };
}

/** Alle pagina's in de huidige volgorde, alleen om te bekijken (met de bestandsnaam als er meer zijn). */
export function PageThumbs({ label }: { label: string }) {
  const { pages, activeSources, sourceOf } = useDocument();
  const { t } = useI18n();
  const multiple = activeSources.length > 1;
  return (
    <ol class="thumbs" aria-label={label}>
      {pages.map((page, index) => {
        const source = sourceOf(page);
        if (!source) return null;
        const pageLabel = [
          format(t.document.page, { n: index + 1 }),
          multiple ? format(t.pages.fromFile, { name: source.name }) : '',
        ]
          .filter(Boolean)
          .join(', ');
        return (
          <li key={`page-${page.key}`}>
            <Thumbnail
              pdf={source.pdf}
              pageNumber={page.source + 1}
              rotation={page.rotation}
              caption={index + 1}
              label={pageLabel}
            />
            {multiple && (
              <span class="page-option__file" aria-hidden="true">
                {source.name}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
