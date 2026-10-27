import { configure } from '@testing-library/preact/pure';

/**
 * Wordt vóór elk testbestand geladen (zie `vite.config.ts`). Op een drukke machine, of als pdf-lib
 * of pdf.js voor het eerst lazy laadt, duurt iets in beeld komen soms langer dan de standaard 1 s
 * van `waitFor`/`findBy`. Wachten stopt zodra het er is; een geslaagde test wordt dus niet trager.
 * (De `pure`-variant registreert zelf niets; tests zonder nagebootste browser merken er niets van.)
 */
configure({ asyncUtilTimeout: 5_000 });
