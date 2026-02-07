import { defineConfig } from 'wxt';
import tailwind from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwind()],
  }),
  manifest: {
    permissions: ['downloads', 'storage', 'activeTab', 'tabs', 'scripting', 'sidePanel'],
    host_permissions: [
      // North America
      'https://*.amazon.com/*',      // United States
      'https://*.amazon.ca/*',       // Canada
      'https://*.amazon.com.mx/*',   // Mexico

      // Europe
      'https://*.amazon.co.uk/*',    // United Kingdom
      'https://*.amazon.ie/*',       // Ireland
      'https://*.amazon.de/*',       // Germany
      'https://*.amazon.fr/*',       // France
      'https://*.amazon.it/*',       // Italy
      'https://*.amazon.es/*',       // Spain
      'https://*.amazon.nl/*',       // Netherlands
      'https://*.amazon.se/*',       // Sweden
      'https://*.amazon.pl/*',       // Poland
      'https://*.amazon.com.tr/*',   // Turkey
      'https://*.amazon.com.be/*',   // Belgium

      // Asia Pacific
      'https://*.amazon.co.jp/*',    // Japan
      'https://*.amazon.in/*',       // India
      'https://*.amazon.cn/*',       // China
      'https://*.amazon.sg/*',       // Singapore
      'https://*.amazon.com.au/*',   // Australia

      // Middle East & Africa
      'https://*.amazon.ae/*',       // United Arab Emirates
      'https://*.amazon.sa/*',       // Saudi Arabia
      'https://*.amazon.eg/*',       // Egypt
      'https://*.amazon.co.za/*',    // South Africa

      // South America
      'https://*.amazon.com.br/*',   // Brazil
    ],
    name: 'Pixora - Amazon Media Downloader',
    description: 'Download product images, videos, and review media from Amazon instantly. One-click ZIP downloads.',
    version: '2.0.0',
    action: {}, // Icon-only action, no popup
  },
});
