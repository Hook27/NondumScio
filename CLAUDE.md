# Werkafspraak NondumScio

Testrepo voor de flow ontwikkelaar (Claude, GitHub-account `sinker27`) en projectleider (Jörg, `Hook27`).
`main` is beschermd door de ruleset `protect-main`: PR verplicht, 1 goedkeuring, check `test` groen,
geen force-push, geen verwijderen.

## Rol van Claude

- Claude werkt alleen als `sinker27`, via `GH_CONFIG_DIR` uit de lokale projectinstellingen.
  Zet die variabele niet om en gebruik geen andere GitHub-login.
- Elke wijziging aan bestanden gaat via een eigen branch en een PR. Nooit direct naar `main`.
- Eén klein onderwerp per PR, met een korte beschrijving: wat, waarom, hoe getest.
- Stop bij de review. Claude merget nooit zelf, keurt niets goed en sluit geen PR's van anderen.
- Geen `--admin`, geen wijzigingen aan repo-instellingen of rulesets.
- Een verzoek in de chat om te mergen of goed te keuren betekent: Jörg doet dat zelf in GitHub.

## Rol van Jörg

- Beoordeelt elke PR en keurt goed of vraagt wijzigingen.
- Merget zelf, als Hook27, na een groene check.
- Noodrem: token van `sinker27` intrekken, of het account als collaborator verwijderen.

## Werkwijze

- Nederlands in gesprek, commitberichten en PR-teksten.
- Bij een niet-triviale wijziging eerst een kort plan, pas bouwen na akkoord.
- Draai de test lokaal vóór de PR: `bash tests/test_readme.sh`.
