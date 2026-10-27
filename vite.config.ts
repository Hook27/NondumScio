import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relatief pad: de site werkt zo op elk adres, ook in een submap
  // (GitHub Pages, voorbeeldomgeving per PR) en straks op een eigen domein.
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    // Ruimer dan de standaard 5 s: op een drukke machine lopen de schermtests (die pdf-lib en
    // pdf.js laden) daar anders tegenaan. Een geslaagde test wordt er niet trager van.
    testTimeout: 15_000,
  },
});
