import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // No proxy — API calls go directly to http://localhost:8000
    // This avoids conflict between /chat API routes and /chat/:id frontend routes
  }
})
