// vite.config.js
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const timestamp = new Date().getTime();

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api/],
      },
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Wolffie Energy Manager',
        start_url: 'https://wolffie.lan/',
        short_name: 'Wolffie',
        description: 'your Watts OnLine/oFFline Energy management system',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: 'assets/woffie.svg', sizes: 'any', type: 'image/svg+xml' }
        ]
      }
    })
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@fortawesome': path.resolve(__dirname, 'node_modules/@fortawesome'),
      // Force the full vue-i18n build (runtime + compiler) in production.
      // Without this, Vite bundles the runtime-only build which cannot
      // compile message templates containing {placeholders} at runtime.
      'vue-i18n': 'vue-i18n/dist/vue-i18n.cjs.js',
    },
  },

  // Dev server only — Apache proxy handles this in production
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://192.168.1.160:3009',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://192.168.1.160:3009',
        ws: true,
      },
    },
  },

  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-${timestamp}.js`,
        chunkFileNames: `assets/[name]-${timestamp}.js`,
        assetFileNames: `assets/[name]-${timestamp}.[ext]`,
        manualChunks: {
          vendor: ['vue', 'vue-router', 'pinia'],
          charts: ['chart.js'],
        }
      }
    }
  }
});