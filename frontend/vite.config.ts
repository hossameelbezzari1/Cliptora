
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [react(), tailwindcss()],

    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,

      allowedHosts: [
        'localhost',
        '127.0.0.1',
        'host.docker.internal',
      ],

      watch: {
        usePolling: true,
        interval: 300,
      },

      hmr: {
        clientPort: 5173,
      },

      proxy: {
        '/api/v1': {
          target: env.BACKEND_URL || 'http://127.0.0.1:8000',
          changeOrigin: true,
        },

        '/n8n': {
          target: env.N8N_URL || 'http://127.0.0.1:5678',
          changeOrigin: true,
          ws: true,
          rewrite: path =>
            path.replace(/^\/n8n(?=\/|$)/, '') || '/',
        },
      },
    },

    preview: {
      host: '0.0.0.0',
    },

    build: {
      outDir: 'dist',
    },
  }
})
