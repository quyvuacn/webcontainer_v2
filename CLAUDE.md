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

# Environment check
npm run check-env        # Verify toolchain prerequisites (Rust, wasm-bindgen, etc.)
```

The WASM build requires `rustup` and `wasm-bindgen-cli` installed. `npm run check-env` verifies prerequisites.

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

### Design Docs

See `docs/master-design.md` for the full architecture diagram, bootstrap sequence, and design rationale. `docs/HARDENING.md` covers the VFS_PREFIX randomization and obfuscation strategy.
