# Nondum Scio

Een PDF-werkbank die volledig in de browser draait: bestanden worden nooit geüpload naar een server.
Werktitel; een echte naam volgt later.

Live: https://hook27.github.io/NondumScio/ (wordt automatisch bijgewerkt na elke merge naar `main`).

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
