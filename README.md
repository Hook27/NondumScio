# Nondum Scio

Een PDF-werkbank die volledig in de browser draait: bestanden worden nooit geüpload naar een server.
Werktitel; een echte naam volgt later.

Live: https://pdf.nondumsc.io/ (wordt automatisch bijgewerkt na elke merge naar `main`).

Elke pull request krijgt een live voorbeeld op `https://pdf.nondumsc.io/pr-preview/pr-<nummer>/`; de link staat als opmerking bij de PR en het voorbeeld verdwijnt weer zodra de PR is gesloten.

Status: in aanbouw. Zie [CLAUDE.md](CLAUDE.md) voor de werkafspraak.

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

## Versienummer

Linksonder op de pagina staat het versienummer, gebaseerd op de pull request: `PR.009` is de build van PR 9. Op een voorbeeld is dat het nummer van die PR, op de echte site het nummer van de laatst gemergde PR. Lokaal staat er `dev`. Zie `scripts/app-version.ts`.
