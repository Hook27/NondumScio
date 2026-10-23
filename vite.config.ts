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
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
