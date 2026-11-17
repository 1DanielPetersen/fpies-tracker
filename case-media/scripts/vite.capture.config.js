// Capture build for the case-media screenshots and film. Never deploy this.
//
// It is the normal vite.config.js plus:
//  - a demo- Firebase config, injected through the app's own __firebase_config
//    and __app_id hooks, so the real fpies-tracker project is never used
//  - VITE_USE_EMULATOR=true, so the app talks to the local emulators
//  - an empty Gemini key baked into the bundle (scan answers are replayed by
//    the capture scripts; a real key never ends up in the build)
//  - its own output folder (case-media/.work/capture-dist) with a version.json
//    that matches the build, so the update banner stays hidden
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import baseConfig from '../../vite.config.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const outDir = path.resolve(here, '../.work/capture-dist')

export const DEMO_PROJECT_ID = 'demo-fpies'
const DEMO_FIREBASE_CONFIG = {
  apiKey: 'demo-api-key',
  authDomain: `${DEMO_PROJECT_ID}.firebaseapp.com`,
  projectId: DEMO_PROJECT_ID,
  storageBucket: `${DEMO_PROJECT_ID}.appspot.com`,
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000000000',
}

// Same version string the app gets through __BUILD_VERSION__.
const BUILD_VERSION = JSON.parse(baseConfig.define.__BUILD_VERSION__)

// The base config writes version.json into <repo>/dist. Swap that plugin for
// one that writes into this build's own folder instead.
const basePlugins = (baseConfig.plugins || []).filter(
  (p) => !(p && p.name === 'fpies-build-version'),
)

const captureVersionPlugin = {
  name: 'capture-build-version',
  closeBundle() {
    if (!fs.existsSync(outDir)) return
    fs.writeFileSync(
      path.join(outDir, 'version.json'),
      JSON.stringify({ version: BUILD_VERSION, builtAt: new Date().toISOString() }),
    )
    const swPath = path.join(outDir, 'sw.js')
    if (fs.existsSync(swPath)) {
      const sw = fs.readFileSync(swPath, 'utf8')
      fs.writeFileSync(swPath, sw.replace(/__BUILD_VERSION__/g, BUILD_VERSION))
    }
  },
}

export default {
  ...baseConfig,
  root: repoRoot,
  plugins: [...basePlugins, captureVersionPlugin],
  define: {
    ...baseConfig.define,
    __firebase_config: JSON.stringify(JSON.stringify(DEMO_FIREBASE_CONFIG)),
    __app_id: JSON.stringify(DEMO_PROJECT_ID),
    'import.meta.env.VITE_USE_EMULATOR': JSON.stringify('true'),
    'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(''),
  },
  build: { outDir, emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
}
