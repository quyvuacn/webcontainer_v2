#!/bin/bash
# Phase 6: Build Node.js C++ Bindings (cần emcc, node-src)
# Chạy: ./build/build.sh
# Yêu cầu: Emscripten SDK, node-src/

set -e
NODE_SRC="${NODE_SRC:-./node-src}"
PATCHES="./patches"
OUT="./dist/runtime"
mkdir -p "$OUT"

if [ ! -d "$NODE_SRC" ]; then
  echo "Clone node-src: git clone --depth 1 https://github.com/nodejs/node.git node-src"
  exit 1
fi

if ! command -v emcc &>/dev/null; then
  echo "Cài Emscripten: ./emsdk install latest && ./emsdk activate latest"
  exit 1
fi

for f in "$PATCHES"/*_browser.cc; do
  [ -f "$f" ] || continue
  base=$(basename "$f" _browser.cc)
  cp "$f" "$NODE_SRC/src/${base}.cc"
done

emcc \
  "$NODE_SRC/src/node_file.cc" \
  "$NODE_SRC/src/node_file_async.cc" \
  "$NODE_SRC/src/node_crypto.cc" \
  "$NODE_SRC/src/node_buffer.cc" \
  "$NODE_SRC/src/node_process.cc" \
  "$NODE_SRC/src/node_os.cc" \
  "$NODE_SRC/src/node_url.cc" \
  "$NODE_SRC/src/node_worker.cc" \
  "$NODE_SRC/src/spawn_sync.cc" \
  "$NODE_SRC/src/tcp_wrap.cc" \
  "$NODE_SRC/src/node_http_parser.cc" \
  "$NODE_SRC/src/node_timer_wrap.cc" \
  -I"$NODE_SRC/src" \
  -I"$NODE_SRC/deps/uv/include" \
  -I"$NODE_SRC/deps/v8/include" \
  -s ENVIRONMENT=web \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=NodeBindings \
  -s ASYNCIFY=1 \
  -s SHARED_MEMORY=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=134217728 \
  -O3 \
  -o "$OUT/node_bindings.js"

if command -v wasm-opt &>/dev/null; then
  wasm-opt -Oz --strip-debug --strip-producers "$OUT/node_bindings.wasm" -o "$OUT/node_bindings.wasm"
fi

cp -r "$NODE_SRC/lib"/* "$OUT/node_stdlib/" 2>/dev/null || true
echo "Build xong: $OUT/"
