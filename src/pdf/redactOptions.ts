/** De keuzes bij redactie, zonder zware imports (ook gebruikt door de documentstatus). */
export type RedactionOptions = {
  /** De resolutie van de pagina's die afbeelding worden. */
  dpi: number;
  /** Titel, auteur en andere documentgegevens niet overnemen. */
  stripMetadata: boolean;
};

export const DEFAULT_REDACTION: RedactionOptions = { dpi: 300, stripMetadata: true };

/** De resoluties om uit te kiezen. */
export const DPI_CHOICES = [150, 200, 300] as const;
