import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __GOOGLE_MAPS_API_KEY__: JSON.stringify(process.env.VITE_GOOGLE_MAPS_API_KEY)
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:4000'
    }
  }
});