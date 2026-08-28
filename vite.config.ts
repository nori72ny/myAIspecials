import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
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

export default defineConfig(() => {
  return {
    plugins: [originApiDevPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@origin/domain': path.resolve(__dirname, './packages/domain/src/index.ts')
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
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
            if (!id.includes('node_modules') && (id.includes('/src/security/') || id.includes('/src/agent/'))) {
              return 'vendor-crypto';
            }
            if (id.includes('node_modules')) {
              if (id.includes('react-dom') || id.includes('/react/') || id.includes('react@') || id.includes('/scheduler/')) {
                return 'vendor-core';
              }
              if (id.includes('react-markdown') || id.includes('remark') || id.includes('rehype') || id.includes('unified') || id.includes('micromark') || id.includes('mdast') || id.includes('hast')) {
                return 'vendor-markdown';
              }
              if (id.includes('dompurify')) {
                return 'vendor-markdown';
              }
              return 'vendor-libs';
            }
          }
        }
      }
    },
  };
});
