import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('react-router-dom') ||
              id.includes('react-dom') ||
              (id.includes('react') &&
                !id.includes('react-big-calendar') &&
                !id.includes('react-hot-toast'))
            ) {
              return 'react-vendor';
            }
            if (id.includes('@supabase')) return 'supabase';
            if (id.includes('@tanstack')) return 'query';
            if (id.includes('lucide-react') || id.includes('react-hot-toast')) return 'ui';
            if (id.includes('react-big-calendar') || id.includes('date-fns')) return 'calendar';
            if (id.includes('recharts')) return 'charts';
          }
        },
      },
    },
  },
});