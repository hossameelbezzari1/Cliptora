import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      allowedHosts: ['localhost', '127.0.0.1', 'host.docker.internal'],
      strictPort: false,
      proxy: {
        '/api/v1': { target: env.BACKEND_URL || 'http://127.0.0.1:8000', changeOrigin: true },
        // n8n sends SAMEORIGIN frame protection. Proxying the editor and its
        // WebSockets preserves that protection while allowing the in-page UI.
        '/n8n': {
          target: env.N8N_URL || 'http://127.0.0.1:5678',
          changeOrigin: true,
          ws: true,
          // n8n emits browser URLs with N8N_PATH, while its HTTP router keeps
          // serving REST/assets at root. Strip only at the upstream boundary.
          rewrite: path => path.replace(/^\/n8n(?=\/|$)/, '') || '/',
        },
      },
    },
    preview: { host: '0.0.0.0' },
    build: { outDir: 'dist' },
  }
})
