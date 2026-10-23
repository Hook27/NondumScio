import type { Messages } from './nl';

/** The English texts. Must have exactly the same keys as the Dutch file (nl.ts). */
export const en: Messages = {
  appName: 'Nondum Scio',
  tagline: 'PDF workbench in your browser',
  skipToContent: 'Skip to content',
  mainMenu: 'Main menu',
  version: 'Version',
  language: 'Language',
  theme: {
    dark: 'Dark theme',
  },
  allTasks: '← All tasks',
  home: {
    title: 'What do you want to do with your PDF?',
    intro: 'Everything happens in your browser. Your files are never uploaded.',
  },
  document: {
    openTitle: 'Open a PDF',
    openHint:
      'Drag a file here or choose one. Your file stays on your device and is never sent anywhere.',
    choose: 'Choose a PDF',
    dropHere: 'Release to open',
    loading: 'Opening {name}…',
    close: 'Close',
    pagesOne: '1 page',
    pagesOther: '{n} pages',
    page: 'Page {n}',
    thumbnails: 'Pages of {name}',
    errors: {
      notPdf: '{name} is not a PDF. Choose a file that ends in .pdf.',
      password: '{name} is protected with a password. This is not supported yet.',
      damaged: '{name} could not be opened. The file may be damaged.',
    },
  },
  comingSoon: 'Coming soon.',
  comingSoonDetail: 'The tools for this task will come in a later version.',
  notFound: {
    title: 'Page not found',
    detail: 'This address does not exist. Go back to the overview to pick a task.',
  },
  tasks: {
    merge: {
      title: 'Merge',
      description: 'Combine several PDF files into one document.',
    },
    split: {
      title: 'Split',
      description: 'Cut a PDF into separate parts, by page range or by number of pages.',
    },
    pages: {
      title: 'Pages',
      description: 'Delete, rotate or reorder pages and add new ones.',
    },
    convert: {
      title: 'Convert',
      description: 'Create a PDF from images or text, or convert a PDF to images.',
    },
    edit: {
      title: 'Edit',
      description: 'Add text, highlights and signatures, and fill in forms.',
    },
    redact: {
      title: 'Redact',
      description: 'Permanently black out text so it can never be recovered.',
    },
  },
};
