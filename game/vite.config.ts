import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serwuje projekt pod /nazwa-repo/, a lokalnie gra stoi pod /.
  // Ścieżka bazowa idzie więc ze środowiska, żeby jeden build pasował do obu —
  // zaszyta na sztywno psułaby `npm run dev`.
  base: process.env.ZU_BASE ?? '/',
  server: {
    port: 5181,
    // LORE.md leży nad katalogiem gry, a jest importowane jako tekst do promptu
    // rozmowy — jeden plik dla gry, pętli i generatora modelu.
    fs: { allow: ['..'] },
    // Panel w grze woła /api/..., a odbiera to serwer pętli agenta. Dzięki proxy
    // wszystko jest tego samego pochodzenia, więc nie ma CORS-u ani konfiguracji.
    proxy: { '/api': { target: 'http://127.0.0.1:5182', changeOrigin: true } },
  },
  build: {
    target: 'es2022',
    // Dwie strony: gra i instrukcja. Instrukcja jest zwykłym HTML-em bez skryptu,
    // więc nie dokłada ani bajta do paczki gry.
    rollupOptions: { input: { gra: 'index.html', instrukcja: 'instrukcja.html' } },
  },
});
