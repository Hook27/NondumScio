export type Size = { width: number; height: number };

/**
 * De weergavegrootte van een miniatuur: vaste breedte, hoogte volgens de verhouding
 * van de pagina. Een liggende pagina wordt dus lager, een staande hoger.
 */
export function thumbnailSize(page: Size, targetWidth: number): Size {
  if (!(page.width > 0) || !(page.height > 0) || !(targetWidth > 0)) {
    throw new RangeError('Paginagrootte en doelbreedte moeten groter dan 0 zijn');
  }
  const scale = targetWidth / page.width;
  return { width: targetWidth, height: Math.round(page.height * scale) };
}

/**
 * De schaal waarop pdf.js moet tekenen voor een scherpe miniatuur: de weergavebreedte
 * maal de pixeldichtheid van het scherm, gedeeld door de paginabreedte. Begrensd op 2: een
 * miniatuur blijft dan scherp genoeg, en op een iPhone (dichtheid 3) kost hij ruwweg de helft
 * aan geheugen.
 */
export const MAX_THUMBNAIL_RATIO = 2;

export function renderScale(pageWidth: number, targetWidth: number, devicePixelRatio = 1): number {
  const ratio = Math.min(Math.max(devicePixelRatio || 1, 1), MAX_THUMBNAIL_RATIO);
  return (targetWidth * ratio) / pageWidth;
}
