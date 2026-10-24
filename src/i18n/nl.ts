import type { TaskId } from '../router';

/**
 * De Nederlandse teksten van de interface. Dit bestand bepaalt de vorm: het
 * Engelse bestand (en.ts) moet precies dezelfde sleutels hebben.
 */
export const nl = {
  appName: 'Nondum Scio',
  tagline: 'PDF-werkbank in je browser',
  skipToContent: 'Naar de inhoud',
  mainMenu: 'Hoofdmenu',
  version: 'Versie',
  language: 'Taal',
  theme: {
    dark: 'Donker thema',
  },
  allTasks: '← Alle taken',
  home: {
    title: 'Wat wil je doen met je PDF?',
    intro: 'Alles gebeurt in je browser. Je bestanden worden nooit geüpload.',
  },
  document: {
    openTitle: 'Open een PDF',
    openHint:
      'Sleep een of meer bestanden hierheen of kies ze. Je bestanden blijven op je apparaat en worden nergens naartoe gestuurd.',
    choose: 'Kies PDF’s',
    files: '{n} bestanden',
    dropHere: 'Laat los om te openen',
    loading: '{name} wordt geopend…',
    close: 'Sluiten',
    pagesOne: '1 pagina',
    pagesOther: '{n} pagina’s',
    page: 'Pagina {n}',
    thumbnails: 'Pagina’s van {name}',
    errors: {
      notPdf: '{name} is geen PDF. Kies een bestand dat eindigt op .pdf.',
      password: '{name} is beveiligd met een wachtwoord. Dat wordt nog niet ondersteund.',
      damaged: '{name} kon niet worden geopend. Het bestand is mogelijk beschadigd.',
    },
  },
  pages: {
    toolbar: 'Paginabewerkingen',
    hint: 'Klik op een pagina om hem te kiezen; met het vinkje rechtsboven (of Ctrl en Shift) kies je er meer. Sleep om te verplaatsen (op een telefoon aan het greepje ⠿), of gebruik Alt + pijltjes.',
    list: 'Pagina’s van {name}. Pijltjes om te bewegen, spatie om te kiezen.',
    selected: '{n} van {total} gekozen',
    rotated: '{n}° gedraaid',
    selectAll: 'Alles kiezen',
    selectNone: 'Niets kiezen',
    rotateLeft: 'Draai linksom',
    rotateRight: 'Draai rechtsom',
    remove: 'Verwijderen',
    addPdf: 'PDF toevoegen',
    fromFile: 'uit {name}',
    moveEarlier: 'Naar voren',
    moveLater: 'Naar achteren',
    extract: 'Uitpakken',
    extractTitle:
      'De gekozen pagina’s als nieuwe PDF downloaden; het document zelf blijft zoals het is.',
    extractSuffix: "pagina's {ranges}",
    keepOne: 'Er moet minstens één pagina overblijven.',
    undo: 'Ongedaan maken',
    redo: 'Opnieuw',
    save: 'PDF downloaden',
    saving: 'Bezig met opslaan…',
    saved: 'Opgeslagen als {name}.',
    unsaved: 'Gewijzigd, nog niet gedownload',
    editedSuffix: 'bewerkt',
    errors: {
      encrypted: 'Deze PDF is beveiligd. Opslaan wordt daarvoor nog niet ondersteund.',
      failed: 'Opslaan is mislukt. Probeer het opnieuw.',
    },
  },
  merge: {
    files: 'Bestanden in volgorde',
    hint: 'De bestanden worden in deze volgorde samengevoegd. Sleep een bestand naar een andere plek (op een telefoon aan het greepje ⠿) of gebruik de pijlen. Losse pagina’s verschuiven of weglaten doe je bij Pagina’s.',
    add: 'Bestand toevoegen',
    adding: 'Bezig met toevoegen…',
    moveUp: '{name} omhoog',
    moveDown: '{name} omlaag',
    remove: '{name} weghalen',
    keepOne: 'Er moet minstens één bestand overblijven.',
    download: 'Samengevoegde PDF downloaden',
    saveTitle: 'Samengevoegde PDF opslaan',
    suffix: 'samengevoegd',
    pagesHint:
      'Per bestand kies je welke pagina’s meedoen: typ een bereik zoals 1-3, 5 en druk op Enter, of klap de miniaturen uit en zet vinkjes.',
    pagesLabel: 'Pagina’s',
    pagesOfFile: 'kiezen uit {name}',
    pagesChosen: '{n} van {total} pagina’s',
    showPages: 'Miniaturen tonen',
    hidePages: 'Miniaturen verbergen',
    pick: 'Miniaturen van {name}',
    keepPage:
      'Er moet minstens één pagina van dit bestand overblijven. Een heel bestand weghalen doe je met ✕.',
    rangeErrors: {
      empty: 'Kies minstens één pagina. Een heel bestand weghalen doe je met ✕.',
      invalid: '“{part}” is geen paginanummer of bereik. Typ bijvoorbeeld 1-3, 5.',
      outOfRangeOne: 'Pagina {page} bestaat niet: dit bestand heeft 1 pagina.',
      outOfRangeOther: 'Pagina {page} bestaat niet: dit bestand heeft {n} pagina’s.',
    },
  },
  saveDialog: {
    saveTitle: 'PDF opslaan',
    extractTitle: 'Gekozen pagina’s opslaan',
    label: 'Bestandsnaam',
    result: 'Wordt gedownload als: {name}',
    download: 'Downloaden',
    cancel: 'Annuleren',
  },
  comingSoon: 'Binnenkort beschikbaar.',
  comingSoonDetail: 'De gereedschappen voor deze taak komen in een volgende versie.',
  notFound: {
    title: 'Pagina niet gevonden',
    detail: 'Dit adres bestaat niet. Ga terug naar het overzicht om een taak te kiezen.',
  },
  tasks: {
    merge: {
      title: 'Samenvoegen',
      description: 'Voeg meerdere PDF-bestanden samen tot één document.',
    },
    split: {
      title: 'Splitsen',
      description: 'Knip een PDF op in losse delen, op paginabereik of per aantal pagina’s.',
    },
    pages: {
      title: 'Pagina’s',
      description: 'Verwijder, draai of herschik pagina’s en voeg er nieuwe toe.',
    },
    convert: {
      title: 'Omzetten',
      description: 'Maak een PDF van afbeeldingen of tekst, of zet een PDF om naar afbeeldingen.',
    },
    edit: {
      title: 'Bewerken',
      description: 'Voeg tekst, markeringen en handtekeningen toe en vul formulieren in.',
    },
    redact: {
      title: 'Redigeren',
      description: 'Maak tekst definitief onleesbaar, zodat hij niet meer terug te halen is.',
    },
  },
} satisfies Record<string, unknown> & {
  tasks: Record<TaskId, { title: string; description: string }>;
};

/** De vorm van een volledige set teksten, voor elke taal. */
export type Messages = typeof nl;
