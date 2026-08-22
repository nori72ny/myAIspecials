import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import {createOriginApp} from './src/server/createOriginApp';

function originApiDevPlugin(): Plugin {
  return {
    name: 'origin-api-dev',
    configureServer(server) {
      server.middlewares.use(createOriginApp());
    },
  };
}

const ORIGIN_PRECACHE_MARKER = '/* __ORIGIN_PRECACHE_MANIFEST__ */ []';

export function injectOriginPrecacheManifest(worker: string, assetPaths: readonly string[]): string {
  const safePaths = [...new Set(assetPaths)]
    .filter((assetPath) => assetPath.startsWith('/') && !assetPath.includes('..'))
    .sort();
  if (worker.split(ORIGIN_PRECACHE_MARKER).length !== 2) {
    throw new Error('Service Worker precache marker is missing or ambiguous.');
  }
  return worker.replace(ORIGIN_PRECACHE_MARKER, JSON.stringify(safePaths));
}

function originOfflinePrecachePlugin(): Plugin {
  return {
    name: 'origin-offline-precache',
    apply: 'build',
    async writeBundle(options, bundle) {
      const outputDirectory = path.resolve(__dirname, options.dir ?? 'dist');
      const workerPath = path.join(outputDirectory, 'sw.js');
      const worker = await readFile(workerPath, 'utf8');
      const assetPaths = Object.keys(bundle)
        .filter((fileName) => fileName !== 'sw.js')
        .map((fileName) => `/${fileName}`);
      await writeFile(workerPath, injectOriginPrecacheManifest(worker, assetPaths), 'utf8');
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [originApiDevPlugin(), react(), tailwindcss(), originOfflinePrecachePlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@origin/domain': path.resolve(__dirname, './packages/domain/src/index.ts')
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    test: {
      globals: true,
      environment: 'jsdom',
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/tests/e2e/**',
        '**/tests/api/**',
      ],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react-dom')) {
                return 'vendor-react-dom';
              }
              if (id.includes('lucide-react') || id.includes('@lucide')) {
                return 'vendor-lucide';
              }
              if (id.includes('react/') || id.includes('react@') || id.includes('/react/')) {
                return 'vendor-react';
              }
              if (id.includes('scheduler')) {
                return 'vendor-react';
              }
              if (id.includes('motion') || id.includes('framer-motion')) {
                return 'vendor-motion';
              }
              if (id.includes('dompurify')) {
                return 'vendor-dompurify';
              }
              return 'vendor-libs';
            }
          }
        }
      }
    },
  };
});
