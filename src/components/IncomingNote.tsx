import type { Incoming } from '../compare/store';
import { useI18n } from '../i18n/LanguageContext';
import { format } from '../i18n/format';

/**
 * Onder een PDF die blijft staan (Vergelijken, Platte tekst): een andere PDF wordt gelezen, of kon
 * niet worden gelezen; dat laatste in de kleur van een waarschuwing.
 */
export function IncomingNote({
  incoming,
  old,
  class: className,
}: {
  incoming: Incoming;
  /** De naam van de PDF die blijft staan. */
  old: string;
  class: string;
}) {
  const c = useI18n().t.compare;
  const { name } = incoming;
  if (incoming.status === 'error')
    return (
      <p class={`${className} dropzone__error`} role="alert">
        {format(c.replaceFailed, { name, reason: c.errors[incoming.code], old })}
      </p>
    );
  return (
    <p class={className} role="status">
      {incoming.total > 0
        ? format(c.replacingPage, { name, n: incoming.done, total: incoming.total })
        : format(c.replacing, { name })}
    </p>
  );
}
