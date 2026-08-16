// Builds src/lib/index.js (authored as clean ES modules) into a
// single classic, synchronous, non-module shared.js at the repo
// root — byte-compatible drop-in for the old hand-written shared.js.
//
// WHY IIFE and not type="module": every page still loads it as
// <script src="shared.js"></script> with page-specific inline
// <script> tags immediately after it that call shared functions
// synchronously (e.g. initStarfield() on the very next line), and
// dozens of onclick="" attribute handlers across the HTML files
// call these functions too. A module script is deferred by the
// browser and wouldn't run in time, and its exports aren't global.
// IIFE output preserves the exact old timing/global behavior while
// letting the source be authored as real modules. See
// docs/MODULARIZATION.md.
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: '.',
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve(__dirname, 'src/lib/index.js'),
      name: 'RevM2Shared',
      formats: ['iife'],
      fileName: () => 'shared.js',
    },
  },
});
