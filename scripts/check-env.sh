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
