import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    // host: true binds 0.0.0.0 so the dev server is reachable over the LAN
    // (e.g. testing the app from a phone on the same network)
    host: true,
    port: 5173,
  },
})
