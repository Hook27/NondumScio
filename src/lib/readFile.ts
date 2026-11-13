/**
 * Een gekozen bestand inlezen. De browser kan een bestand soms even niet lezen
 * (`NotReadableError`): bij zware belasting, of als het bestand na het kiezen verandert of even
 * vergrendeld is (een map die Nextcloud synchroniseert, een netwerkschijf, een virusscanner). Dan
 * na een korte pauze nog één keer proberen; lukt dat ook niet, dan een eigen fout, zodat de melding
 * niet ten onrechte naar de PDF wijst ("beschadigd").
 */

/** Het bestand kon ook bij de tweede poging niet worden gelezen. */
export class FileReadError extends Error {
  constructor(
    /** De naam van het bestand, voor de melding. */
    readonly fileName: string,
    /** De fout van de browser, voor wie zoekt. */
    readonly reason?: unknown,
  ) {
    super(`Bestand kon niet worden gelezen: ${fileName}`);
    this.name = 'FileReadError';
  }
}

/** Hoe lang er gewacht wordt voor de tweede poging (in milliseconden). */
export const RETRY_DELAY = 250;

/** Leest een bestand (of een stuk ervan) in, met één herkansing. */
export async function readFileBytes(file: Blob, delay = RETRY_DELAY): Promise<Uint8Array> {
  try {
    return new Uint8Array(await file.arrayBuffer());
  } catch {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      throw new FileReadError(file instanceof File ? file.name : '', error);
    }
  }
}
