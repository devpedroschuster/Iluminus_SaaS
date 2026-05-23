import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'supabase': ['@supabase/supabase-js'],
          'query': ['@tanstack/react-query'],
          'ui': ['lucide-react', 'react-hot-toast'],
          'calendar': ['react-big-calendar', 'date-fns'],
          'charts': ['recharts'],
        },
      },
    },
  },
});