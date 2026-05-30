import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Mirror the Firebase Hosting rewrite: /api/** → the API (Cloud Run in prod).
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
