import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    watch: {
      ignored: ['**/tmp/**', '**/dist/**']
    }
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000
  }
})
