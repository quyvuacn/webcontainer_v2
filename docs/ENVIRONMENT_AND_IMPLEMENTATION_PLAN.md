# Kế hoạch chuẩn bị môi trường và triển khai Browser Node.js Runtime

Dựa trên thiết kế trong `docs/master-design.md`. Tài liệu này mô tả chuẩn bị môi trường, công cụ và roadmap triển khai.

---

## 1. Chuẩn bị môi trường

### 1.1 Node.js

| Mục         | Chi tiết                                    |
| ----------- | ------------------------------------------- |
| Phiên bản   | >= 18.3.0 (yêu cầu bởi Emscripten)          |
| Khuyến nghị | 20 LTS hoặc 22 LTS                          |
| Dùng cho    | Build scripts, npm, dev server, test runner |

**Cài đặt:**

- Windows: [nodejs.org](https://nodejs.org) hoặc `winget install OpenJS.NodeJS.LTS`
- Linux: `nvm install 20` hoặc `sudo apt install nodejs`
- Kiểm tra: `node -v`, `npm -v`

---

### 1.2 Python

| Mục         | Chi tiết                        |
| ----------- | ------------------------------- |
| Phiên bản   | >= 3.8 (Emscripten requirement) |
| Khuyến nghị | 3.11+                           |
| Dùng cho    | emsdk, build scripts            |

**Kiểm tra:** `python3 --version`

---

### 1.3 Git

| Mục      | Chi tiết                            |
| -------- | ----------------------------------- |
| Dùng cho | Clone emsdk, node-src, dependencies |

**Kiểm tra:** `git --version`

---

### 1.4 C++ / Build toolchain

Emscripten cần compiler native tương ứng OS:

| OS      | Toolchain                                       |
| ------- | ----------------------------------------------- |
| Windows | Visual Studio 2017+ (Build Tools) + CMake       |
| Linux   | gcc, g++, make, cmake (`build-essential cmake`) |
| macOS   | Xcode Command Line Tools                        |

**Windows:** Cài [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) với workload "Desktop development with C++"

**Linux:** `sudo apt install build-essential cmake`

**macOS:** `xcode-select --install`

---

### 1.5 Rust

| Mục         | Chi tiết                                                             |
| ----------- | -------------------------------------------------------------------- |
| Dùng cho    | VFS Ram, npm resolver, CDN resolver (src/)                           |
| wasm target | wasm32-unknown-emscripten hoặc wasm32-unknown-unknown + wasm-bindgen |

**Cài đặt:**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**Thêm wasm target:**

```bash
rustup target add wasm32-unknown-emscripten   # nếu link với Emscripten
# hoặc
rustup target add wasm32-unknown-unknown      # nếu dùng wasm-bindgen
```

**Công cụ bổ sung:**

- `wasm-bindgen-cli`: `cargo install wasm-bindgen-cli`
- `wasm-pack` (tùy chọn): `cargo install wasm-pack`

**Kiểm tra:** `rustc --version`, `cargo --version`

---

### 1.6 Emscripten SDK

| Mục       | Chi tiết                           |
| --------- | ---------------------------------- |
| Dùng cho  | Compile Node.js C++ patches → WASM |
| Phiên bản | latest (hoặc 3.1.x trở lên)        |

**Cài đặt:**

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh   # Linux/macOS
# Windows: emsdk_env.bat
```

**Kiểm tra:** `emcc --version`

---

### 1.7 Binaryen (wasm-opt)

| Mục          | Chi tiết                                                      |
| ------------ | ------------------------------------------------------------- |
| Dùng cho     | Optimize WASM: `wasm-opt -Oz --strip-debug --strip-producers` |
| Có sẵn trong | Emscripten SDK (thường đã cài)                                |

**Kiểm tra:** `wasm-opt --version`

Nếu chưa có: `npm install -g binaryen` hoặc dùng binary từ emsdk.

---

### 1.8 Node.js source (node-src)

Cần bản Node.js source để patch và compile:

```bash
git clone --depth 1 https://github.com/nodejs/node.git node-src
# hoặc tải release: https://nodejs.org/dist/
```

Đặt tại `node-src/` theo cấu trúc trong master-design.

---

### 1.9 Tóm tắt kiểm tra môi trường

| Công cụ  | Lệnh kiểm tra        |
| -------- | -------------------- |
| Node.js  | `node -v`            |
| npm      | `npm -v`             |
| Python   | `python3 --version`  |
| Git      | `git --version`      |
| Rust     | `rustc -V`           |
| Cargo    | `cargo -V`           |
| emcc     | `emcc --version`     |
| wasm-opt | `wasm-opt --version` |

---

## 2. Cấu trúc thư mục dự án

```
browser-node/
├── patches/           # Node.js C++ patches
├── src/               # Rust (vfs_ram, npm, cdn)
├── js/                # Workers, bridges
├── sw/                # Service Worker
├── build/             # Build scripts, Cargo.toml
├── node-src/          # Node.js source (clone riêng)
└── dist/runtime/      # Output
```

---

## 3. Roadmap triển khai (theo master-design)

### Phase 1 — RamVfs + fs.watch() (2 tuần) [DONE]

- [x] RamVfs với write lock
- [x] fs.watch() hook 0ms
- [x] OPFS write-through + exclusive lock
- [x] F5 restore: OPFS → RAM trong bootstrap Phase B
- [x] VFS MessageChannel từ Workers về Main
- [x] HMR-like demo (iframe reload khi file thay đổi)

**Chuẩn bị môi trường Phase 1:** Node.js (Emscripten chưa cần).

---

### Phase 2 — Virtual TCP + Handler Worker (3 tuần) [DONE]

- [x] Path /**port**/N/ (dev), subdomain cho prod
- [x] SAB pipe + timeout 30s
- [x] TCP Worker spin loop
- [x] Handler Worker (stub, chưa Node WASM)
- [x] SW routing
- [x] http.createServer() + listen(port)
- [x] WebSocket bridge trong SW

---

### Phase 3 — child_process (2 tuần) [DONE]

- [x] spawn() + spawnSync()
- [x] SAB cho stdout/stderr
- [x] VFS MessageChannel cho child
- [x] IPC process.send/on (MessageChannel)

---

### Phase 4 — npm Engine (3 tuần) [DONE]

- [x] npm install + write lock
- [x] npm ci
- [x] npm run / start
- [x] npm update

---

### Phase 5 — CDN Resolver (2 tuần) [DONE]

- [x] Lazy fetch tích hợp VFS (Main + createCdnVfsProxy)

---

### Phase 6 — Node.js C++ Bindings (4 tuần) [STRUCTURE]

- [x] patches/README.md, build-placeholder.sh, prepare-node.sh
- [x] placeholder.c → WASM (không cần node-src)
- [ ] Patch thật (node_file, node_crypto, …) — cần Node build
- [ ] build.sh — full compile với node-src

**Chuẩn bị:** node-src, emcc, wasm-opt.

---

### Phase 7 — Hardening (2 tuần) [DONE]

- [x] VFS_PREFIX random mỗi build
- [x] npm run build:prod, build:obfuscate
- [x] js/config.js, vite define
- [ ] Firefox/Safari test (checklist)

---

## 4. Script kiểm tra môi trường (check-env)

Có thể thêm script `scripts/check-env.sh` hoặc `scripts/check-env.ps1`:

```bash
#!/bin/bash
check() { command -v "$1" >/dev/null 2>&1 && echo "OK $1" || echo "MISSING $1"; }
check node
check npm
check python3
check git
check rustc
check cargo
check emcc
check wasm-opt
```

---

## 5. Dependency và thứ tự thực hiện

| Thứ tự | Công cụ                | Phụ thuộc                 |
| ------ | ---------------------- | ------------------------- |
| 1      | Git                    | -                         |
| 2      | Python 3               | -                         |
| 3      | Node.js                | -                         |
| 4      | C++ toolchain (gcc/VS) | -                         |
| 5      | Rust (rustup)          | -                         |
| 6      | emsdk                  | Git, Python, Node.js, C++ |
| 7      | node-src               | Git                       |

---

## 6. Ghi chú bổ sung

- **Windows:** Dùng bash (Git Bash / WSL) cho các script build shell
- **RAM:** Build Emscripten/LLVM cần tối thiểu 2–4 GB RAM
- **Rust + C++:** Thiết kế có Rust (vfs, npm, cdn) và C++ (Node patches). Hai WASM riêng hoặc link chung — tùy chiến lược build
- **Java:** Tùy chọn nếu dùng Closure Compiler (`--closure 1`) trong emcc
