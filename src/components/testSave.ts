import { fireEvent, screen, within } from '@testing-library/preact';
/** Alleen voor tests: het naamvenster dat nu open is. */
export const saveDialog = () => screen.getByRole('dialog');

/**
 * Alleen voor tests: in het naamvenster eventueel een andere naam typen, en dan Downloaden (de
 * knop van het formulier, in elke taal).
 */
export function confirmSave(name?: string): void {
  const dialog = saveDialog();
  if (name !== undefined) {
    fireEvent.input(within(dialog).getByRole('textbox'), { target: { value: name } });
  }
  fireEvent.click(dialog.querySelector('button[type="submit"]')!);
}

/** Alleen voor tests: het naamvenster sluiten met Annuleren. */
export function cancelSave(): void {
  fireEvent.click(saveDialog().querySelector('button[type="button"]')!);
}
