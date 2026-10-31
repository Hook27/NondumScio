import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { PaneHead } from '../components/WorkspaceParts';
import { useI18n } from '../i18n/LanguageContext';
import { format, plural } from '../i18n/format';
import { downloadFile } from '../pdf/save';
import {
  dbFileName,
  exportDb,
  importInto,
  parseTriggers,
  type DbEntry,
  type DbKind,
} from './database';
import { getRenameDb, setRenameDb, useRenameDb } from './store';

const KINDS: readonly DbKind[] = ['afzenders', 'onderwerpen'];

/*
 * Een vaste sleutel per regel. Een regel wordt bij elke wijziging een nieuw object; met dezelfde
 * sleutel blijft zijn rij staan (en houdt hij de focus als je met Tab naar het volgende veld gaat).
 */
const keys = new WeakMap<DbEntry, number>();
let nextKey = 1;

function keyOf(entry: DbEntry): number {
  let key = keys.get(entry);
  if (key === undefined) {
    key = nextKey++;
    keys.set(entry, key);
  }
  return key;
}

/** Vervangt de lijst van één soort in de database. */
function setList(kind: DbKind, change: (list: readonly DbEntry[]) => DbEntry[]) {
  const db = getRenameDb();
  setRenameDb({ ...db, [kind]: change(db[kind]) });
}

/**
 * De database van Slim hernoemen: afzenders en onderwerpen met hun herkenwoorden, te bewerken,
 * te exporteren en te importeren (in de vorm van de HTML-tool, zodat een bestand in beide werkt).
 */
export function DatabaseView() {
  const { t } = useI18n();
  const d = t.rename.db;
  const db = useRenameDb();
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);

  const count = (kind: DbKind, n: number) => plural(n, d.kinds[kind].one, d.kinds[kind].other);

  const save = () => {
    downloadFile(new TextEncoder().encode(exportDb(db)), dbFileName(), 'application/json');
    setStatus({
      text: format(d.exported, {
        senders: count('afzenders', db.afzenders.length),
        subjects: count('onderwerpen', db.onderwerpen.length),
      }),
      error: false,
    });
  };

  /** Voegt een export samen met de database (zie `mergeList`). */
  const load = async (file: File) => {
    try {
      const result = importInto(getRenameDb(), await file.text());
      setRenameDb(result.db);
      setStatus({
        text: format(d.imported, {
          senders: count('afzenders', result.added.afzenders),
          subjects: count('onderwerpen', result.added.onderwerpen),
        }),
        error: false,
      });
    } catch {
      setStatus({ text: d.importError, error: true });
    }
  };

  return (
    <section class="workspace rename" aria-labelledby="rename-db-title">
      <div class="workspace__tools">
        <div class="document__bar">
          <div class="document__info">
            <h2 id="rename-db-title" class="document__name">
              {d.title}
            </h2>
          </div>
        </div>
        <div class="toolbar toolbar--tools" role="toolbar" aria-label={d.title}>
          <div class="toolbar__group toolbar__group--wide">
            <button type="button" class="button button--secondary" onClick={save}>
              {d.export}
            </button>
            <input
              id="rename-db-import"
              class="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) void load(file);
              }}
            />
            <label for="rename-db-import" class="button button--secondary">
              {d.import}
            </label>
          </div>
        </div>
        {status && (
          <p
            class={status.error ? 'page-editor__error' : 'page-editor__saved'}
            role={status.error ? 'alert' : 'status'}
          >
            {status.text}
          </p>
        )}
        <p class="annotate__hint">{d.intro}</p>
        <p class="annotate__hint">{d.stored}</p>
      </div>
      <div class="workspace__view rename-db" data-scroll-root>
        {KINDS.map((kind) => (
          <DbList key={kind} kind={kind} list={db[kind]} />
        ))}
      </div>
    </section>
  );
}

/** De lijst van één soort (afzenders of onderwerpen), met een knop om een regel toe te voegen. */
function DbList({ kind, list }: { kind: DbKind; list: readonly DbEntry[] }) {
  const { t } = useI18n();
  const d = t.rename.db;
  const k = d.kinds[kind];
  // Een nieuwe regel krijgt meteen de focus in zijn naamveld.
  const focusNew = useRef(false);
  useLayoutEffect(() => {
    focusNew.current = false;
  });
  const titleId = `rename-db-${kind}`;

  return (
    <section class="rename-db__list" aria-labelledby={titleId}>
      <PaneHead title={k.title} titleId={titleId} meta={plural(list.length, k.one, k.other)} />
      <table class="rename-table">
        <thead>
          <tr>
            <th scope="col">{d.columns.name}</th>
            <th scope="col">{d.columns.triggers}</th>
            <th scope="col" class="rename-db__remove">
              <span class="visually-hidden">{d.columns.remove}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr>
              <td colSpan={3} class="rename-db__empty">
                {d.empty}
              </td>
            </tr>
          ) : (
            list.map((entry, index) => (
              <DbRow
                key={keyOf(entry)}
                kind={kind}
                index={index}
                entry={entry}
                focus={focusNew.current && index === list.length - 1}
                onChange={(changed) => {
                  keys.set(changed, keyOf(entry));
                  setList(kind, (current) => current.map((e) => (e === entry ? changed : e)));
                }}
                onRemove={() => setList(kind, (current) => current.filter((e) => e !== entry))}
              />
            ))
          )}
        </tbody>
      </table>
      <button
        type="button"
        class="button button--secondary rename-db__add"
        onClick={() => {
          focusNew.current = true;
          setList(kind, (current) => [...current, { naam: '', triggers: [] }]);
        }}
      >
        {k.add}
      </button>
    </section>
  );
}

/**
 * Eén regel: naam en herkenwoorden. Wat je typt, wordt pas vastgelegd als je het veld verlaat (of
 * op Enter drukt), net als in de HTML-tool: zo kun je spaties en komma's gewoon typen.
 */
function DbRow({
  kind,
  index,
  entry,
  focus,
  onChange,
  onRemove,
}: {
  kind: DbKind;
  index: number;
  entry: DbEntry;
  focus: boolean;
  onChange: (entry: DbEntry) => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const d = t.rename.db;
  const label = { item: d.kinds[kind].item, n: index + 1 };
  const [naam, setNaam] = useState(entry.naam);
  const [triggers, setTriggers] = useState(entry.triggers.join(', '));
  const nameField = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    // Alleen bij het verschijnen van de regel.
    if (focus) nameField.current?.focus();
  }, []);

  return (
    <tr>
      <td>
        <input
          ref={nameField}
          type="text"
          value={naam}
          aria-label={format(d.nameLabel, label)}
          onInput={(event) => setNaam(event.currentTarget.value)}
          onChange={(event) => {
            const value = event.currentTarget.value.trim();
            setNaam(value);
            onChange({ ...entry, naam: value });
          }}
        />
      </td>
      <td>
        <input
          type="text"
          value={triggers}
          placeholder={d.triggersPlaceholder}
          aria-label={format(d.triggersLabel, label)}
          onInput={(event) => setTriggers(event.currentTarget.value)}
          onChange={(event) => {
            const list = parseTriggers(event.currentTarget.value);
            setTriggers(list.join(', '));
            onChange({ ...entry, triggers: list });
          }}
        />
      </td>
      <td class="rename-db__remove">
        <button
          type="button"
          class="link-button"
          aria-label={format(d.removeLabel, label)}
          onClick={onRemove}
        >
          {d.remove}
        </button>
      </td>
    </tr>
  );
}
