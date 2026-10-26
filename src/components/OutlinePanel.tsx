import { useEffect, useState } from 'preact/hooks';
import { useDocument, type Source } from '../document/DocumentContext';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import {
  countEntries,
  loadOutline,
  placeOutline,
  type OutlineEntry,
  type PlacedEntry,
} from '../outline/outline';

/** De bladwijzers per geopend bestand, zodra ze gelezen zijn. */
function useOutlines(sources: readonly Source[]): ReadonlyMap<number, OutlineEntry[]> {
  const [outlines, setOutlines] = useState<ReadonlyMap<number, OutlineEntry[]>>(new Map());
  const key = sources.map((source) => source.id).join(',');
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      sources.map(async (source) => [source.id, await loadOutline(source.pdf)] as const),
    ).then((entries) => {
      if (!cancelled) setOutlines(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
    // De bestanden zelf veranderen niet; alleen welke er open zijn.
  }, [key]);
  return outlines;
}

/**
 * De bladwijzers van de geopende bestanden, ingeklapt onder de bestandslijst. Een klik springt
 * naar de pagina in het resultaat (`onJump` krijgt de plek, vanaf 0); een bladwijzer naar een
 * weggehaalde pagina staat er grijs bij. Heeft geen enkel bestand bladwijzers, dan is er niets.
 */
export function OutlinePanel({
  onJump,
  dropped = false,
}: {
  onJump: (position: number) => void;
  /** Bij het downloaden gaan de bladwijzers niet mee (bijvoorbeeld door redactievakken). */
  dropped?: boolean;
}) {
  const { pages, activeSources } = useDocument();
  const { t } = useI18n();
  const o = t.outline;
  const outlines = useOutlines(activeSources);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  const groups = activeSources
    .map((source) => ({
      source,
      entries: placeOutline(outlines.get(source.id) ?? [], source.id, pages),
    }))
    .filter((group) => group.entries.length > 0);
  if (groups.length === 0) return null;

  const total = groups.reduce((sum, group) => sum + countEntries(group.entries), 0);
  const removed = groups.reduce(
    (sum, group) => sum + countEntries(group.entries, (entry) => entry.target.kind === 'removed'),
    0,
  );
  // Met meer dan één bestand worden de pagina's in een nieuw document gezet, zonder de oude bladwijzers.
  const merged = activeSources.length > 1;

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const tree = (entries: readonly PlacedEntry[], sourceId: number, label?: string) => (
    <ul class="outline__list" aria-label={label}>
      {entries.map((entry) => {
        const id = `${sourceId}:${entry.id}`;
        const open = expanded.has(id);
        const title = entry.title || o.untitled;
        const { target } = entry;
        return (
          <li key={id} class="outline__item">
            <div class="outline__row">
              {entry.children.length > 0 ? (
                <button
                  type="button"
                  class="outline__toggle"
                  aria-expanded={open}
                  aria-label={format(o.children, { title })}
                  onClick={() => toggle(id)}
                >
                  <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                </button>
              ) : (
                <span class="outline__toggle outline__toggle--empty" aria-hidden="true" />
              )}
              {target.kind === 'page' ? (
                <button
                  type="button"
                  class="outline__entry"
                  onClick={() => onJump(target.position)}
                >
                  <span class="outline__title">{title}</span>
                  <span class="outline__page">{format(o.page, { n: target.position + 1 })}</span>
                </button>
              ) : (
                <span
                  class={`outline__entry outline__entry--${target.kind === 'removed' ? 'removed' : 'none'}`}
                >
                  <span class="outline__title">{title}</span>
                  <span class="outline__page">
                    {target.kind === 'removed' ? o.removed : o.noPage}
                  </span>
                </span>
              )}
            </div>
            {open && tree(entry.children, sourceId)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <details class="outline">
      <summary class="outline__summary">{format(o.title, { n: total })}</summary>
      {removed > 0 && (
        <p class="page-editor__status outline__note">
          {plural(removed, o.removedOne, format(o.removedOther, { n: removed }))}
          {!dropped && !merged && ` ${o.nowhere}`}
        </p>
      )}
      {dropped ? (
        <p class="page-editor__status outline__note">{o.redacted}</p>
      ) : (
        merged && <p class="page-editor__status outline__note">{o.merged}</p>
      )}
      {groups.map(({ source, entries }) => (
        <div key={source.id} class="outline__group">
          {groups.length > 1 && (
            <p class="outline__file" aria-hidden="true">
              {source.name}
            </p>
          )}
          {tree(entries, source.id, format(o.list, { name: source.name }))}
        </div>
      ))}
    </details>
  );
}
