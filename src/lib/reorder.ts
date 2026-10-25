/**
 * Een onderdeel `step` plekken omhoog (-1) of omlaag (1) in een lijst. Geeft dezelfde lijst
 * terug als dat niet kan (bovenaan, onderaan of onbekend).
 */
export function moveBy<T>(list: readonly T[], index: number, step: -1 | 1): readonly T[] {
  const to = index + step;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/**
 * Een onderdeel naar plek `target` in de lijst, voor slepen (0 = vooraan, de lengte = achteraan;
 * de plek telt in de huidige volgorde, alsof het onderdeel er nog staat). Loslaten op de eigen
 * plek verandert niets en geeft dezelfde lijst terug.
 */
export function moveTo<T>(list: readonly T[], index: number, target: number): readonly T[] {
  if (index < 0 || index >= list.length) return list;
  const clamped = Math.max(0, Math.min(target, list.length));
  if (clamped === index || clamped === index + 1) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(clamped > index ? clamped - 1 : clamped, 0, item!);
  return next;
}
