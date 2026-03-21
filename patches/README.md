# Node.js C++ Patches (Phase 6)

Thay thế syscalls bằng Web APIs. Mỗi file `*_browser.cc` patch file gốc tương ứng.

| Gốc | Patch | Backend |
|-----|-------|---------|
| node_file.cc | node_file_browser.cc | RamVfs qua MessageChannel |
| node_file_async.cc | node_file_async_browser.cc | RamVfs |
| node_crypto.cc | node_crypto_browser.cc | WebCrypto API |
| node_process.cc | node_process_browser.cc | Stub (env, argv, exit) |
| node_os.cc | node_os_browser.cc | Stub (platform=linux) |
| node_worker.cc | node_worker_browser.cc | Web Workers |
| spawn_sync.cc | spawn_sync_browser.cc | Web Worker + SAB |
| tcp_wrap.cc | tcp_wrap_browser.cc | Virtual TCP |
| node_timer_wrap.cc | node_timer_wrap_browser.cc | setTimeout |

Chạy `./build/build.sh` sau khi có node-src và emsdk.
