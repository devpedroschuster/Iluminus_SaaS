import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  test: {
    environment: 'node',
    // Sem isso, o padrão de descoberta do Vitest (**/*.{test,spec}.*)
    // também casa gestao_web/e2e/*.spec.js (specs do Playwright, criados
    // na Task 3) — Vitest tenta rodá-los com seu próprio runner e quebra
    // em "Playwright Test did not expect test.describe() to be called
    // here" (achado rodando o PR real de verificação, Task 5 Step 6).
    include: ['src/**/*.{test,spec}.{js,jsx}'],
  },

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