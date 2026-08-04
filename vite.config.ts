import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Three.js + Rapier form a deliberately large game-engine bundle.
    chunkSizeWarningLimit: 4000,
  },
})
