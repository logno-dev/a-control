import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('apps/desktop/main/index.ts') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: resolve('apps/desktop/preload/index.ts') } }
  },
  renderer: {
    root: 'apps/desktop/renderer',
    plugins: [react(), {
      name: 'development-react-refresh-csp',
      transformIndexHtml: {
        order: 'post',
        handler: (html, context) => context.server
          ? html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
          : html
      }
    }],
    build: { rollupOptions: { input: {
      index: resolve('apps/desktop/renderer/index.html'),
      audio: resolve('apps/desktop/renderer/audio.html'),
      overlay: resolve('apps/desktop/renderer/overlay.html')
    } } }
  }
});
