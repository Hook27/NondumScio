# Nondum Scio

Een PDF-werkbank die volledig in de browser draait: bestanden worden nooit geüpload naar een server.
Werktitel; een echte naam volgt later.

Live: https://pdf.nondumsc.io/ (wordt automatisch bijgewerkt na elke merge naar `main`).

Elke pull request krijgt een live voorbeeld op `https://pdf.nondumsc.io/pr-preview/pr-<nummer>/`; de link staat als opmerking bij de PR en het voorbeeld verdwijnt weer zodra de PR is gesloten.

Status: in aanbouw. Zie [CLAUDE.md](CLAUDE.md) voor de werkafspraak.

## Hoe een PDF wordt geopend

Met pdf.js (Mozilla, Apache-2.0). De bibliotheek wordt pas geladen als je een PDF opent, zodat de startpagina licht blijft; het tekenen gebeurt in een aparte worker. Het bestand wordt in het geheugen van de browser gelezen en nergens naartoe gestuurd (een browsertest controleert dat er geen verzoeken naar andere adressen gaan). Miniaturen worden pas getekend als ze in beeld komen.

## Ontwikkelen

Vereist Node 24 (zie `.nvmrc`).

```sh
npm ci            # afhankelijkheden installeren
npm run dev       # lokale ontwikkelserver
npm test          # unit-tests
npm run lint      # code controleren
npm run format    # opmaak herstellen
npm run build     # productiebuild in dist/
```

Dezelfde controles draaien in GitHub Actions (job `test`) op elke pull request.

## Browsertests

`npm run e2e` draait de browsertests (Playwright) tegen de echte productiebuild, op desktop en telefoon: navigatie, taal, thema, en een automatische toegankelijkheidscontrole (axe, WCAG 2.1 A en AA) van elke pagina in elke taal en elk thema. Eenmalig de browser installeren met `npm run e2e:install`. In GitHub draait dit als job `e2e`; bij een fout wordt een rapport met opnames bewaard.

## Talen

De interface is Nederlands en Engels. De teksten staan in `src/i18n/nl.ts` en `src/i18n/en.ts`; het Engelse bestand moet exact dezelfde sleutels hebben (de typecontrole en een test bewaken dat). De taal komt uit de bewaarde keuze, anders uit de browser, anders Engels.

## Thema

Licht en donker. Zonder keuze volgt de site het thema van je systeem; de knop rechtsboven wisselt en onthoudt je keuze. Alle kleuren staan als variabelen bovenin `src/styles.css`, en een test bewaakt dat de contrasten in beide thema's leesbaar blijven (WCAG, minstens 4,5 : 1 voor tekst).

## Versienummer

Linksonder op de pagina staat het versienummer, gebaseerd op de pull request: `PR.009` is de build van PR 9. Op een voorbeeld is dat het nummer van die PR, op de echte site het nummer van de laatst gemergde PR. Lokaal staat er `dev`. Zie `scripts/app-version.ts`.
