/* Placeholder WASM cho Phase 6 - thay thế khi có Node C++ bindings thật */
#ifdef __EMSCRIPTEN__
#include <emscripten.h>

EMSCRIPTEN_KEEPALIVE
void node_bindings_init(void) {}

EMSCRIPTEN_KEEPALIVE
void vfs_preload(const char* path, const unsigned char* content, int len) {
  (void)path;
  (void)content;
  (void)len;
}
#endif
