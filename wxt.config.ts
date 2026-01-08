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
      'https://*.amazon.com/*',
      'https://*.amazon.co.uk/*',
      'https://*.amazon.de/*',
      'https://*.amazon.co.jp/*',
      'https://*.amazon.in/*',
    ],
    name: 'Pixora - Amazon Media Downloader',
    description: 'Download product images, videos, and review media from Amazon instantly. One-click ZIP downloads.',
    version: '2.0.0',
    action: {}, // Icon-only action, no popup
  },
});
