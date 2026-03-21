# Cấu trúc thư mục webcontainer_v2

```
webcontainer_v2/
├── index.html
├── js/                     # App (entry: app.js)
│   ├── app.ts
│   ├── main.ts
│   ├── run_node.ts         # Bridge → node/cli
│   ├── config.ts
│   ├── shell/              # Terminal UI (commands, parser, path, vfs_adapter)
│   ├── npm/                # npm client (install, ci, run, resolver, semver)
│   ├── cdn/                # CDN resolver, vfs_proxy
│   ├── lib/
│   ├── opfs_bridge.ts, opfs_worker.ts
│   ├── vfs_wasm.ts, vfs_ram.ts
│   ├── handler_worker.ts, tcp_worker.ts
│   └── child_process_browser.ts, child_worker.ts
├── node/                   # Node runtime (JS polyfills)
│   ├── cli.ts
│   ├── polyfills/
│   ├── module-system/
│   ├── transform/
│   ├── file-source/
│   ├── executor/
│   ├── vfs/                # VFS adapter
│   │   ├── core/           # path, adapter, vfs, inode
│   │   └── test-memory.ts
│   ├── pkg-json/           # parsePackageJson
│   └── install-gate.ts
├── src/                    # Rust (wasm)
├── public/
├── sw/
├── scripts/
└── build/
```
