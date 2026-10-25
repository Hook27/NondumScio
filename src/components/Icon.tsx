import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';

/**
 * Eigen, kleine set symbolen (lijnen in de tekstkleur), zodat er geen bibliotheek nodig is.
 * Elk symbool is een of meer lijnen in een vak van 24 bij 24.
 */
const PATHS = {
  rotateLeft: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
  rotateRight: ['M21 12a9 9 0 1 1-3-6.7', 'M21 4v5h-5'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  arrowLeft: ['M19 12H5', 'M11 6l-6 6 6 6'],
  arrowRight: ['M5 12h14', 'M13 6l6 6-6 6'],
  arrowUp: ['M12 19V5', 'M6 11l6-6 6 6'],
  arrowDown: ['M12 5v14', 'M6 13l6 6 6-6'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  redo: ['M15 14l5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'],
  selectAll: ['M4 4h16v16H4z', 'M8 12l3 3 5-6'],
  selectNone: ['M4 4h16v16H4z', 'M9 9l6 6', 'M15 9l-6 6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v6', 'M12 7.5v.5'],
  grid: ['M4 4h7v7H4z', 'M13 4h7v7h-7z', 'M4 13h7v7H4z', 'M13 13h7v7h-7z'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  extract: ['M14 3H6v18h12V7z', 'M14 3v4h4', 'M12 10v7', 'M9 14l3 3 3-3'],
  filePlus: ['M14 3H6v18h12V7z', 'M14 3v4h4', 'M12 11v6', 'M9 14h6'],
  cursor: ['M5 3l14 8-6 2-3 6z'],
  textTool: ['M5 7V4h14v3', 'M12 4v16', 'M9 20h6'],
  highlighter: ['M9 20H4v-4L14 6l4 4-9 10z', 'M12 8l4 4'],
  rectangle: ['M4 6h16v12H4z'],
  lineTool: ['M5 19L19 5'],
  zoomIn: [
    'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z',
    'M20 20l-4.5-4.5',
    'M8 10.5h5',
    'M10.5 8v5',
  ],
  zoomOut: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'M20 20l-4.5-4.5', 'M8 10.5h5'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      class="icon"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'icon' | 'label'>;

/**
 * Een knop met alleen een symbool. De naam (`label`) is er voor schermlezers en verschijnt
 * als hover-tekst bij muis en toetsenbordfocus (zie `TooltipLayer`), ook als de knop uit staat.
 */
export function IconButton({
  icon,
  label,
  tip = label,
  class: extra,
  ...rest
}: ButtonProps & {
  icon: IconName;
  label: string;
  /** De hover-tekst, als die meer moet zeggen dan de naam (bijvoorbeeld waarom de knop uit staat). */
  tip?: string;
}) {
  return (
    <TipAnchor tip={tip}>
      <button
        type="button"
        class={`button button--secondary button--icon${extra ? ` ${String(extra)}` : ''}`}
        aria-label={label}
        {...rest}
      >
        <Icon name={icon} />
      </button>
    </TipAnchor>
  );
}

/**
 * Draagt de hover-tekst. Een knop die uit staat krijgt geen muisgebeurtenissen; daarom zit de
 * tekst op dit omhulsel en laat de knop die gebeurtenissen erdoor (pointer-events: none).
 */
export function TipAnchor({ tip, children }: { tip: string; children: ComponentChildren }) {
  return (
    <span class="tip-anchor" data-tip={tip}>
      {children}
    </span>
  );
}
