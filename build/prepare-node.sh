#!/bin/bash
# Clone Node.js source (nếu chưa có)
# Chạy: ./build/prepare-node.sh
set -e
NODE_SRC="${NODE_SRC:-./node-src}"
if [ -d "$NODE_SRC" ]; then
  echo "$NODE_SRC đã tồn tại"
  exit 0
fi
echo "Clone Node.js source..."
git clone --depth 1 --branch v22.11.0 https://github.com/nodejs/node.git "$NODE_SRC"
echo "Xong. Chạy ./build/build.sh để compile"
