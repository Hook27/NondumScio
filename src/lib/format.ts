const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/**
 * Maakt van een aantal bytes een leesbare bestandsgrootte, zoals "1,5 MB".
 * Rekent met 1024 per stap, zoals bestandsbeheerders dat doen.
 */
export function formatFileSize(bytes: number, locale = 'nl'): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError(`Ongeldig aantal bytes: ${bytes}`);
  }

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const digits = unit === 0 ? 0 : 1;
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
  return `${number} ${UNITS[unit]}`;
}
