// Builds src/apps/mobile-home (a real React + Tailwind app) into a
// static bundle committed at the repo root, the same way
// vite.shared.config.js builds src/lib into shared.js: this is a
// static, no-server deploy (see vercel.json / how every other page
// here is served), so the output has to be plain files Vercel can
// serve as-is — no Next.js server, no SSR.
//
// Entry: src/apps/mobile-home/mobile-home.html (dev template) is
// built by Vite into root-level mobile-home.html, with its JS/CSS
// emitted under assets/mobile-home-*. Run `npm run build:css` first
// so Tailwind utilities used in MobileHome.tsx are in
// src/styles/tailwind.build.css before this bundles it in.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  // Treat the app folder as its own Vite root. This matters for two
  // reasons: (1) it's what makes the built mobile-home.html land at
  // outDir's top level instead of mirroring its full repo path, and
  // (2) it stops Vite from resolving the root-relative "/manifest.json"
  // and "/icon-192.png" hrefs against real repo-root files and bundling
  // hashed copies of them — with no such files under this root, Vite
  // leaves those hrefs untouched, which is what we want: at runtime
  // they resolve against the deployed site's actual root.
  root: resolve(__dirname, 'src/apps/mobile-home'),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname),
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/apps/mobile-home/mobile-home.html'),
      output: {
        entryFileNames: 'assets/mobile-home-[hash].js',
        chunkFileNames: 'assets/mobile-home-[hash].js',
        assetFileNames: 'assets/mobile-home-[hash][extname]',
      },
    },
  },
});
