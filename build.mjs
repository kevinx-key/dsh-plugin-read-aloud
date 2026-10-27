import { build } from 'esbuild'
import { copyFile, mkdir, writeFile } from 'node:fs/promises'

const PACKAGE_NAME = 'dsh-plugin-read-aloud'

await mkdir('lib', { recursive: true })
await copyFile('src/worker.ps1', 'lib/worker.ps1')

// The Host is bundled as CommonJS: msedge-tts pulls in axios/ws, whose
// dynamic `require` calls cannot run inside an ESM bundle. CJS keeps the
// package self-contained, so a marketplace install has no build scripts.
const host = await build({
  entryPoints: ['src/index.js'],
  outfile: 'lib/index.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
})

await writeFile('lib/index.js', [
  "import host from './index.cjs'",
  'export const SapiSpeechService = host.SapiSpeechService',
  'export const apply = host.apply',
  '',
].join('\n'))

const client = await build({
  entryPoints: ['src/client.js'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', '@deepseek-ai/*'],
  sourcemap: 'external',
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      `\tid: ${JSON.stringify(PACKAGE_NAME)},`,
      '\tfactory: (require) => {',
      '\t\tvar module = { exports: {} };',
      '\t\tvar exports = module.exports;',
      '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    ].join('\n'),
  },
  footer: {
    js: '\t\treturn module.exports;\n\t}\n});\n',
  },
})

for (const [label, result] of [['lib/index.js', host], ['lib/client.js', client]]) {
  const bytes = Object.values(result.metafile?.outputs ?? {})
    .filter(output => output.entryPoint !== undefined)
    .reduce((sum, output) => sum + output.bytes, 0)
  console.log(`${label}: ${(bytes / 1024).toFixed(1)} KiB`)
}
