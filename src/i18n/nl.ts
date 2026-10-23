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
  comingSoon: 'Binnenkort beschikbaar.',
  comingSoonDetail: 'Deze taak wordt in een volgende versie toegevoegd.',
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
