#!/bin/bash
# Compile vfs_ram Rust -> WASM
# Yêu cầu: rustup, wasm-bindgen-cli (cargo install wasm-bindgen-cli)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${VFS_OUT:-$ROOT/public/runtime}"
mkdir -p "$OUT"
cd "$ROOT"
export PATH="$HOME/.cargo/bin:$PATH"

rustup target add wasm32-unknown-unknown 2>/dev/null || true
cargo build --target wasm32-unknown-unknown --release

WASM="target/wasm32-unknown-unknown/release/vfs.wasm"
if command -v wasm-bindgen &>/dev/null; then
  wasm-bindgen "$WASM" --out-dir "$OUT" --target web --out-name vfs_ram
elif command -v wasm-pack &>/dev/null; then
  wasm-pack build --target web --out-dir "$OUT" --out-name vfs_ram --no-opt
else
  echo "Cần: cargo install wasm-bindgen-cli (nếu wasm-pack lỗi)"
  exit 1
fi

for f in "$OUT"/snippets/*/js/opfs_bridge.js; do
  [ -f "$f" ] && echo "export { initOpfsBridge, opfsWrite, opfsRead, opfsListAll, opfsDelete, createBroadcastChannel } from '/js/opfs_bridge.js'" > "$f"
done

echo "VFS WASM xong: $OUT/vfs_ram.js, $OUT/vfs_ram_bg.wasm"
