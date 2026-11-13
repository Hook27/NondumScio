/**
 * Een bestand dat naast een sleepvak wordt losgelaten, opent de browser in het tabblad: dan is al
 * het werk weg, zonder vraag. Dit vangnet houdt slepen en loslaten van bestanden tegen op het hele
 * venster, behalve waar een sleepvak het al zelf opvangt (dat roept `preventDefault` eerst aan).
 * Naast het vak gebeurt er dan niets, en de muisaanwijzer toont "niet toegestaan". Geeft een
 * functie terug die het vangnet weer weghaalt.
 */
export function guardFileDrops(win: Window): () => void {
  const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  const over = (event: DragEvent) => {
    if (!hasFiles(event) || event.defaultPrevented) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  const drop = (event: DragEvent) => {
    if (hasFiles(event) && !event.defaultPrevented) event.preventDefault();
  };
  win.addEventListener('dragover', over);
  win.addEventListener('drop', drop);
  return () => {
    win.removeEventListener('dragover', over);
    win.removeEventListener('drop', drop);
  };
}
