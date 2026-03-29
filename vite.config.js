/**
 * @module vite.config
 * Vite build configuration. Enables WASM support for Rapier3D physics engine.
 * Multi-page: index.html (game) + lobby.html (server browser) + admin.html (settings).
 */
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { resolve } from 'path';

export default defineConfig({
  plugins: [wasm()],
  server: {
    host: true, // listen on all interfaces (allows phone access via LAN IP)
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        lobby: resolve(__dirname, 'lobby.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  }
});
