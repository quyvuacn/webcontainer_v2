/**
 * Optional packages that can be stubbed when not found.
 * Used by esbuild plugin (bundle-time) and CJSLoader (runtime require).
 */

export const STUB_PACKAGES = new Set([
  'source-map-support',
  'postcss',
  'lightningcss',
  'rollup',
  'rollup/parseAst',
  'supports-color',
  'fsevents', // macOS-only optional dep for chokidar
  'bufferutil', // optional native dep for ws
  'utf-8-validate', // optional native dep for ws
])

export function getStubExports(id: string): unknown {
  switch (id) {
    case 'rollup':
      return {
        default: () => Promise.resolve({ write: () => {}, generate: () => Promise.resolve({ output: [] }) }),
        defineConfig: (c: unknown) => c,
        VERSION: '0.0.0',
      }
    case 'postcss':
      return { default: () => ({ process: (css: string) => Promise.resolve({ css: css ?? '', map: null }) }) }
    case 'lightningcss':
      return { default: { transform: () => ({ code: '' }) } }
    case 'rollup/parseAst':
      return {
        parseAst: () => ({ type: 'Program', body: [] }),
        parseAstAsync: async () => ({ type: 'Program', body: [] }),
      }
    case 'fsevents': {
      const noop = () => {}
      // watch(path, callback) must return stop fn — chokidar: const stop = fsevents.watch(path, cb); return { stop }
      function watchStub(_path: string, _cb: () => void) { return noop }
      function stub() { return noop }
      ;(stub as unknown as { watch: typeof watchStub }).watch = watchStub
      return { default: stub, watch: watchStub }
    }
    case 'bufferutil':
      return { default: {} }
    case 'utf-8-validate':
      return { default: {}, isValidUTF8: () => true }
    default:
      return { default: {}, install: () => {} }
  }
}

/** ESM source for esbuild bundle — one place for all stub implementations. */
export function getStubContentsForBundle(id: string): string {
  switch (id) {
    case 'rollup':
      return `export default function rollup() { return Promise.resolve({ write: () => {}, generate: () => Promise.resolve({ output: [] }) }); }
export function defineConfig(c) { return c; }
export const VERSION = '0.0.0';`
    case 'postcss':
      return `export default function() { return { process: (css) => Promise.resolve({ css: css || '', map: null }) }; }`
    case 'lightningcss':
      return `export default { transform: () => ({ code: '' }) };`
    case 'rollup/parseAst':
      return `export function parseAst() { return { type: 'Program', body: [] }; }
export async function parseAstAsync() { return { type: 'Program', body: [] }; }`
    case 'fsevents':
      return `function watch(path, cb) { return function() {}; }
watch.watch = watch;
export default watch;
export { watch };`
    case 'bufferutil':
      return 'export default {};'
    case 'utf-8-validate':
      return 'export default {}; export function isValidUTF8() { return true; }'
    default:
      return 'export default {}; export function install() {}'
  }
}
