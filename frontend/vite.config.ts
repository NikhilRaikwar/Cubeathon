import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// On Vercel: root IS the frontend dir, so no parent .env exists — use '.'
// On local dev: root .env is one level up — use '..'
const envDir = fs.existsSync(path.resolve(__dirname, '../.env')) ? '..' : '.'

export default defineConfig({
  plugins: [react()],
  base: '/',
  envDir,
  define: { global: 'globalThis' },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      buffer: path.resolve(__dirname, './node_modules/buffer/')
    },
    dedupe: ['@stellar/stellar-sdk']
  },
  optimizeDeps: {
    include: ['@stellar/stellar-sdk', '@stellar/stellar-sdk/contract', '@stellar/stellar-sdk/rpc', 'buffer'],
    esbuildOptions: { define: { global: 'globalThis' } }
  },
  build: {
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      output: {
        manualChunks: {
          'stellar-sdk': ['@stellar/stellar-sdk'],
          'wallets-kit': ['@creit.tech/stellar-wallets-kit'],
          'react-vendor': ['react', 'react-dom'],
        }
      }
    }
  },
  server: { port: 3001, open: true }
})
