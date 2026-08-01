import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    proxy: {
      // Backend REST API (same origin in production via Express static).
      '/api': 'http://localhost:3000',
      // Socket.IO real-time transport (upgrades to WebSocket).
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
})
