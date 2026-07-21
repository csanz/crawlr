/**
 * @module vite.config
 * Vite build configuration. Enables WASM support for Rapier3D physics engine.
 * Multi-page: index.html (game) + lobby.html (server browser) + admin.html (settings).
 *
 * SDK loading: @jazaix/jx-sdk is loaded at runtime from the SDK CDN (port 4200)
 * via a <script> tag in index.html. The jxSdkCdn plugin shims ES imports to read
 * from window.JxSDK so all `import { X } from '@jazaix/jx-sdk'` work unchanged.
 */
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import { resolve } from 'path';
import fs from 'fs';

/** Shims @jazaix/jx-sdk imports to use the UMD global loaded via <script> tag. */
function jxSdkCdn() {
  const SHIM_ID = '\0jx-sdk-cdn-shim';
  const MODULE_ID = '@jazaix/jx-sdk';
  return {
    name: 'jx-sdk-cdn',
    enforce: 'pre',
    resolveId(id) {
      if (id === MODULE_ID) return SHIM_ID;
    },
    load(id) {
      if (id === SHIM_ID) {
        return `const s = window.JxSDK;
export const NetworkManager = s.NetworkManager;
export const NetworkClient = s.NetworkClient;
export const Protocol = s.Protocol;
export const eventBus = s.eventBus;
export const EventBus = s.EventBus;
export const NetDebug = s.NetDebug;
export const init = s.init;
export const getGameKey = s.getGameKey;
export const getConfig = s.getConfig;
// Players service (jx-docs/prds/jx-players-service.md)
export const installPlayersDecoder = s.installPlayersDecoder;
export const createJxPlayer = s.createJxPlayer;
export default s;`;
      }
    },
  };
}

export default defineConfig({
  plugins: [wasm(), jxSdkCdn()],
  server: {
    host: true, // listen on all interfaces (allows phone access via LAN IP)
    https: fs.existsSync(resolve(__dirname, '.certs/cert.pem')) ? {
      cert: fs.readFileSync(resolve(__dirname, '.certs/cert.pem')),
      key: fs.readFileSync(resolve(__dirname, '.certs/key.pem')),
    } : undefined,
    proxy: {
      // Proxy cert hash requests to avoid mixed-content (HTTPS page → HTTP endpoint)
      '/cert-hash': {
        target: 'http://localhost:4434',
        rewrite: () => '/',
        changeOrigin: true,
      },
    },
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
