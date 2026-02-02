// vite.config.js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';

const timestamp = new Date().getTime(); // e.g., 1715608000000

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-${timestamp}.js`,
        chunkFileNames: `assets/[name]-${timestamp}.js`,
        assetFileNames: `assets/[name]-${timestamp}.[ext]`
      }
    }
  }
});