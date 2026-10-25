import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useI18n } from '../i18n/LanguageContext';

/** Een groep keuzerondjes in een kader, zoals "Hoe splitsen?" bij Splitsen. */
export function RadioGroup<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  children,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Extra's die bij deze keuze horen, onder de rondjes in hetzelfde kader. */
  children?: ComponentChildren;
}) {
  return (
    <fieldset class="split-method">
      <legend class="split-method__legend">{legend}</legend>
      <div class="split-method__row">
        {options.map((option) => (
          <label key={option.value} class="split-method__option">
            <input
              type="radio"
              name={name}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {children}
    </fieldset>
  );
}

export type ConvertMode = 'images' | 'pdf';

/**
 * De keuze tussen "Afbeeldingen naar PDF" en "PDF naar afbeeldingen". De twee soorten staan
 * op verschillende plekken in de pagina, waardoor deze knoppen bij het wisselen opnieuw
 * worden opgebouwd; `restoreFocus` zet de focus dan terug op de gekozen knop.
 */
export function ModeToggle({
  mode,
  onChange,
  restoreFocus,
}: {
  mode: ConvertMode;
  onChange: (mode: ConvertMode) => void;
  restoreFocus: { current: boolean };
}) {
  const { t } = useI18n();
  const pressed = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    pressed.current?.focus();
  }, [restoreFocus]);

  const options: readonly { value: ConvertMode; label: string }[] = [
    { value: 'images', label: t.convert.toPdf },
    { value: 'pdf', label: t.convert.toImages },
  ];

  return (
    <div class="segmented" role="group" aria-label={t.convert.mode}>
      {options.map((option) => (
        <button
          key={option.value}
          ref={mode === option.value ? pressed : undefined}
          type="button"
          class="segmented__button"
          aria-pressed={mode === option.value}
          onClick={() => {
            if (mode === option.value) return;
            restoreFocus.current = true;
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
