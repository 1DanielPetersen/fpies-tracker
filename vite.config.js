import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BUILD_VERSION = Date.now().toString()

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'fpies-build-version',
      closeBundle() {
        const distDir = path.resolve(__dirname, 'dist')
        if (!fs.existsSync(distDir)) return

        fs.writeFileSync(
          path.join(distDir, 'version.json'),
          JSON.stringify({ version: BUILD_VERSION, builtAt: new Date().toISOString() })
        )

        const swPath = path.join(distDir, 'sw.js')
        if (fs.existsSync(swPath)) {
          const sw = fs.readFileSync(swPath, 'utf8')
          fs.writeFileSync(swPath, sw.replace(/__BUILD_VERSION__/g, BUILD_VERSION))
        }
      },
    },
  ],
  define: {
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
})
