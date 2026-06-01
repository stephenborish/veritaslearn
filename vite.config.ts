import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Configure watch ignores. When DISABLE_HMR is true, ignore everything to save CPU and prevent any auto-reloads.
      watch: {
        ignored: process.env.DISABLE_HMR === 'true'
          ? ['**']
          : [
              '**/data/**',
              '**/uploads/**',
              '**/node_modules/**',
              '**/.git/**',
              '**/*.json',
              '**/*.log'
            ]
      },
    },
  };
});