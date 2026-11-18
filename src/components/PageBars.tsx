import type { ComponentChildren } from 'preact';
import { useI18n } from '../i18n/LanguageContext';
import { IconButton } from './Icon';

/**
 * Bladeren, overal hetzelfde (bedieningsafspraak V6): eerste, vorige, de pagina van nu, volgende,
 * laatste, met pictogrammen en uitleg bij de muis. In Platte tekst, Triage, het beeld van
 * Vergelijken en het Bekijk-venster.
 */
export function PageNav({
  page,
  count,
  onPage,
  title,
  children,
}: {
  page: number;
  count: number;
  onPage: (page: number) => void;
  /** Uitleg bij de groep (bijvoorbeeld welke toetsen bladeren). */
  title?: string;
  /** Wat er tussen de knoppen staat, zoals "3 / 12". */
  children: ComponentChildren;
}) {
  const { t } = useI18n();
  const b = t.pageBar;
  return (
    <div class="page-nav" role="group" aria-label={b.nav} title={title}>
      <IconButton icon="pageFirst" label={b.first} disabled={page <= 1} onClick={() => onPage(1)} />
      <IconButton
        icon="pagePrevious"
        label={b.previous}
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      />
      <span class="page-nav__page">{children}</span>
      <IconButton
        icon="pageNext"
        label={b.next}
        disabled={page >= count}
        onClick={() => onPage(page + 1)}
      />
      <IconButton
        icon="pageLast"
        label={b.last}
        disabled={page >= count}
        onClick={() => onPage(count)}
      />
    </div>
  );
}

/** Een manier van passend maken (Hele pagina, Hele breedte), en of die nu aan staat. */
export type FitChoice = { label: string; active: boolean; onClick: () => void };

/**
 * Zoomen, overal hetzelfde (bedieningsafspraak V5): vergrootglas −, het percentage, vergrootglas +
 * en de knoppen om passend te maken. Een passend-knop die aan staat, is gevuld blauw (zoals elke
 * schakelaar die aan staat).
 */
export function ZoomBar({
  percent,
  canZoomOut,
  canZoomIn,
  onZoomOut,
  onZoomIn,
  fits,
}: {
  percent: number;
  canZoomOut: boolean;
  canZoomIn: boolean;
  onZoomOut: () => void;
  onZoomIn: () => void;
  fits: readonly FitChoice[];
}) {
  const { t } = useI18n();
  const b = t.pageBar;
  return (
    <div class="zoom-bar" role="group" aria-label={b.zoom}>
      <IconButton icon="zoomOut" label={b.zoomOut} disabled={!canZoomOut} onClick={onZoomOut} />
      <output class="zoom-bar__value">{`${percent}%`}</output>
      <IconButton icon="zoomIn" label={b.zoomIn} disabled={!canZoomIn} onClick={onZoomIn} />
      {fits.map((fit) => (
        <button
          key={fit.label}
          type="button"
          class="button button--secondary zoom-bar__fit"
          aria-pressed={fit.active}
          onClick={fit.onClick}
        >
          {fit.label}
        </button>
      ))}
    </div>
  );
}
