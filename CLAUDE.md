# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
npm run dev              # Start Vite dev server at http://localhost:5173

# Building
npm run build            # Dev build
npm run build:prod       # Production build with random VFS_PREFIX (includes WASM if Rust installed)
npm run build:obfuscate  # Production + obfuscate (requires javascript-obfuscator)
npm run build:vfs        # Build WASM VFS only (requires: rustup, wasm-bindgen-cli)

# Testing
npm run test             # Run all tests (Vitest)
npm run test:watch       # Watch mode
npm run benchmark        # VFS performance benchmarks

# Run a single test file
npx vitest run js/vfs_ram.test.ts
npx vitest run --reporter=verbose node/transform/bare-specifier-rewrite.test.ts

# Environment check
npm run check-env        # Verify toolchain prerequisites (Rust, wasm-bindgen, etc.)
```

The WASM build requires `rustup` and `wasm-bindgen-cli` installed (`cargo install wasm-bindgen-cli`). `npm run check-env` verifies prerequisites.

**Known failing tests:** `node/transform/bare-specifier-rewrite.test.ts` has ~11 failing cases related to VFS_PREFIX import rewriting.

## Architecture

This project is a **browser-based Node.js runtime** — it runs the full Node.js ecosystem (including npm install, HTTP servers, child processes) inside the browser with no server required.

### 5 Core Architectural Rules

1. **Main thread owns the VFS** — serves VFS requests synchronously to all workers; no Asyncify on main thread.
2. **Each worker has single responsibility**:
   - **Handler Worker** (`js/handler_worker.ts`): executes Node.js code, can Asyncify
   - **TCP Worker** (`js/tcp_worker.ts`): virtual TCP via SharedArrayBuffer spin loop
   - **OPFS Worker** (`js/opfs_worker.ts`): Origin Private File System persistence/ư
   - **npm Worker**: package resolution/installation
   - **Child Workers** (`js/child_worker.ts`): user script spawning
3. **Static assets bypass the Service Worker** — served from Cache API to avoid circular dependencies.
4. **Write locks for batch operations** — prevents race conditions during npm install and builds.
5. **SAB communication has timeouts** — prevents deadlocks in SharedArrayBuffer loops.

### Layers

```
index.html / js/app.ts          ← Terminal UI (xterm.js), split pane, tabs, preview iframe
      ↓
js/main.ts                      ← Bootstrap: VFS init, port registration, SW coordination
      ↓
js/vfs_ram.ts / js/vfs_wasm.ts  ← In-memory VFS (Rust WASM or JS fallback)
      ↓
js/opfs_bridge.ts               ← Persistence layer (OPFS)
      ↓
node/cli.ts                     ← Node.js execution entry point
node/module-system/             ← CJS/ESM module resolution
node/polyfills/                 ← fs, net, http, child_process, process polyfills
node/transform/                 ← ESM→CJS via esbuild-wasm
      ↓
sw/sw.js / public/sw.js         ← Service Worker: caching, request routing, virtual TCP
```

### Key Subsystems

**Virtual File System (VFS):**

- `js/vfs_ram.ts` — in-memory FS with watches, locks, file metadata
- `js/vfs_wasm.ts` — WASM VFS init; falls back to RamVfs if WASM unavailable
- `src/vfs_ram.rs`, `src/lock.rs`, `src/watcher.rs` — Rust implementations compiled to WASM

**Shell:**

- `js/shell/shell.ts` — command executor
- `js/shell/commands.ts` — built-in commands (ls, cat, cd, etc.)
- `js/shell/parser.ts` — command line parsing

**Package Management:**

- `js/npm/install.ts`, `js/npm/ci.ts` — npm install/ci
- `js/npm/resolver.ts` — version resolution
- `js/cdn/resolver.ts` — CDN package resolution

**Virtual Networking:**

- `js/tcp_worker.ts` — virtual TCP via SAB spin loop
- `js/http_serialize.ts` — HTTP request/response serialization
- `sw/sw.js` — routes HTTP requests through virtual TCP

### Tech Stack

- **TypeScript** + **Vite** (build), **Vitest** (tests)
- **Rust** → **WASM** for the VFS layer (`wasm-bindgen`)
- **xterm.js** for terminal UI
- **esbuild-wasm** for ESM→CJS transformation at runtime
- **SharedArrayBuffer** + **Web Workers** + **Service Worker** for multi-threaded execution
- COOP/COEP headers required for SAB support (configured in `vite.config.ts`)

### VFS_PREFIX Randomization

`npm run build:prod` generates a random `_<4-hex-bytes>_` prefix (e.g. `_a3f1_`) and rewrites all `__r__` sentinel references in built files to that prefix. Override with `VFS_PREFIX=my_prefix npm run build:prod`. This is the obfuscation/hardening mechanism documented in `docs/HARDENING.md`.

### Notable Constraints

- **Tab lock:** `js/main.ts` uses the Navigator.locks API to prevent running in multiple browser tabs simultaneously.
- **Reported Node version:** The runtime hardcodes `v20.11.0` as its version string (`node/cli.ts`).
- **Vite dev server:** Files in `js/*.ts` are served transparently as `.js` by a custom Vite middleware, enabling browser ES module imports without a build step.
- **COOP/COEP headers** are set by Vite for SharedArrayBuffer support — required in all deployment environments.

### Design Docs

See `docs/master-design.md` for the full architecture diagram, bootstrap sequence, and design rationale. `docs/HARDENING.md` covers the VFS_PREFIX randomization and obfuscation strategy. `docs/HTTP_VIRTUAL_PORT_DESIGN.md` details the SAB communication protocol for virtual TCP.
