# Browser Node.js Runtime

Chạy Node.js ecosystem trong browser, không server.

## Các Phase đã triển khai

- **Phase 1**: RamVfs, fs.watch, OPFS, F5 restore, VFS MessageChannel
- **Phase 2**: Virtual TCP, http.createServer(), Handler Worker
- **Phase 3**: child_process spawn/spawnSync
- **Phase 4**: npm install (semver, resolver, stubs)
- **Phase 5**: CDN Resolver (exports, fetch)
- **Phase 6**: Node C++ Bindings — WASM VFS (Rust) built with wasm-bindgen; fallback to JS RamVfs if WASM fails
- **Phase 7**: Hardening — VFS_PREFIX random, obfuscate

### Chạy

```bash
npm install
npm run dev
```

Mở http://localhost:5173

### Build

```bash
npm run build            # Dev build
npm run build:prod       # Prod + random VFS_PREFIX (includes WASM if Rust installed)
npm run build:obfuscate  # Prod + obfuscate (requires javascript-obfuscator)
npm run build:vfs        # Build WASM VFS only (requires: rustup, wasm-bindgen-cli)
npm run check-env        # Check toolchain
```

WASM build (Phase 6):

- Requires: Rust, `cargo install wasm-bindgen-cli`
- Output: `public/runtime/vfs_ram.js`, `public/runtime/vfs_ram_bg.wasm`
- If build fails, app falls back to JS RamVfs automatically

### Test

```bash
npm run test
```

45 test cases, cover toàn bộ core logic:

| File                 | Tests          |
| -------------------- | -------------- |
| js/vfs_ram.js        | 8              |
| js/npm/semver.js     | 13             |
| js/npm/resolver.js   | 3 (mock fetch) |
| js/npm/install.js    | 4              |
| js/http_serialize.js | 4              |
| js/cdn/resolver.js   | 5              |
| js/cdn/vfs_proxy.js  | 4              |
| js/lib/sab_buffer.js | 4              |

### Cấu trúc

```
js/
  vfs_ram.js, opfs_worker.js, opfs_bridge.js
  main.js, app.js
  http_serialize.js, tcp_worker.js, handler_worker.js
  child_process_browser.js, child_worker.js
  npm/  semver, resolver, install
  cdn/  resolver, vfs_proxy
sw/, public/
build/  build.sh  (Phase 6)
```
