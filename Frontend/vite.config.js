import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
   
      '/products': 'http://localhost:3000',
      '/productos': 'http://localhost:3000'
    }
  }
})
