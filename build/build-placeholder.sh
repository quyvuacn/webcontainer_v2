#!/bin/bash
# Tạo placeholder node_bindings.wasm (không cần node-src)
# Chạy: ./build/build-placeholder.sh
set -e
OUT="./dist/runtime"
mkdir -p "$OUT"

if ! command -v emcc &>/dev/null; then
  echo "Cài Emscripten: ./emsdk install latest && ./emsdk activate latest"
  exit 1
fi

emcc build/placeholder.c \
  -I. \
  -s ENVIRONMENT=web \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=NodeBindings \
  -s EXPORTED_FUNCTIONS='["_node_bindings_init","_vfs_preload"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=134217728 \
  -O3 \
  -o "$OUT/node_bindings.js"

if command -v wasm-opt &>/dev/null; then
  wasm-opt -Oz --strip-debug --strip-producers "$OUT/node_bindings.wasm" -o "$OUT/node_bindings.wasm"
fi

echo "Placeholder build xong: $OUT/node_bindings.wasm"
