import { execSync } from 'node:child_process'
import process from 'node:process'
import fs from 'fs-extra'
import chokidar from 'chokidar'
import { browserOutDir, isDev, isFirefox, log, port, r } from './utils'

async function copyAssets() {
  await fs.copy(r('assets'), r(`${browserOutDir}/assets`))
  log('PRE', `copied assets to ${browserOutDir}/assets`)
}

async function stubIndexHtml() {
  const views = ['popup', ...(isFirefox ? ['downloads'] : [])]

  for (const view of views) {
    await fs.ensureDir(r(`${browserOutDir}/dist/${view}`))
    let data = await fs.readFile(r(`src/${view}/index.html`), 'utf-8')
    data = data
      .replace('"./main.ts"', `"http://localhost:${port}/${view}/main.ts"`)
      .replace('<div id="app"></div>', '<div id="app">Vite server did not start</div>')
    await fs.writeFile(r(`${browserOutDir}/dist/${view}/index.html`), data, 'utf-8')
    log('PRE', `stub ${view}`)
  }
}

function writeManifest() {
  execSync('npx esno ./scripts/manifest.ts', { stdio: 'inherit' })
}

async function main() {
  await copyAssets()
  writeManifest()

  if (isDev) {
    await stubIndexHtml()
    chokidar.watch(r('src/**/*.html'))
      .on('change', () => {
        void stubIndexHtml()
      })
    chokidar.watch([r('src/manifest.ts'), r('package.json')])
      .on('change', () => {
        writeManifest()
      })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
