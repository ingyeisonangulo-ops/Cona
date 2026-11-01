import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

const BRAND = '#1E65D6';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // El registro se hace manualmente y solo en producción (src/pwa.js).
      injectRegister: false,
      registerType: 'prompt',
      devOptions: { enabled: false },
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon-180.png'],
      manifest: {
        id: '/',
        name: 'Nuevo Amanecer del Pacífico — CRM',
        short_name: 'Nuevo Amanecer',
        description: 'CRM y Tablero Gerencial de la IPS Centro Odontológico Nuevo Amanecer del Pacífico SAS',
        lang: 'es-CO',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: BRAND,
        background_color: '#F0F4F9',
        categories: ['medical', 'business', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache del app shell (JS/CSS/HTML/íconos con hash de build).
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Autenticación: nunca en caché.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/auth/'),
            handler: 'NetworkOnly',
          },
          {
            // Datos: network-first, solo como respaldo offline breve. Se borra al cerrar sesión.
            urlPattern: ({ url, request }) => url.pathname.startsWith('/api/') && request.method === 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-data',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 60, maxAgeSeconds: 300 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Estáticos fuera del precache: cache-first.
            urlPattern: ({ request }) => ['style', 'script', 'image', 'font'].includes(request.destination),
            handler: 'CacheFirst',
            options: { cacheName: 'static', expiration: { maxEntries: 100, maxAgeSeconds: 30 * 86400 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
  },
  build: { sourcemap: false },
});
