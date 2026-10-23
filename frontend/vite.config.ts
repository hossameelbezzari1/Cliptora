import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: '0.0.0.0',
      strictPort: false,
      proxy: {
        '/api/v1': { target: env.BACKEND_URL || 'http://127.0.0.1:8000', changeOrigin: true },
      },
    },
    preview: { host: '0.0.0.0' },
    build: { outDir: 'dist' },
  }
})
