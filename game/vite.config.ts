import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5181,
    // Panel w grze woła /api/..., a odbiera to serwer pętli agenta. Dzięki proxy
    // wszystko jest tego samego pochodzenia, więc nie ma CORS-u ani konfiguracji.
    proxy: { '/api': { target: 'http://127.0.0.1:5182', changeOrigin: true } },
  },
  build: { target: 'es2022' },
});
