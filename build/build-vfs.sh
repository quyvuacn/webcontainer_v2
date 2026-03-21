#!/bin/bash
# Compile vfs_ram Rust -> WASM
# Yêu cầu: https://rustup.rs | wasm-pack (cargo install wasm-pack)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/runtime"
mkdir -p "$OUT"
cd "$ROOT"

if ! command -v wasm-pack &>/dev/null; then
  echo "Cài wasm-pack: cargo install wasm-pack"
  exit 1
fi

rustup target add wasm32-unknown-unknown 2>/dev/null || true
wasm-pack build --target web --out-dir "$OUT" --out-name vfs_ram

echo "VFS WASM xong: $OUT/vfs_ram.js, $OUT/vfs_ram_bg.wasm"
