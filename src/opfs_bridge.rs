/// opfs_bridge.rs — single source of all JS bindings to opfs_bridge.js.
///
/// All OPFS operations are fire-and-forget Promises. The Main Thread
/// MUST NOT await any of them — it must never block on I/O.
///
/// Call sites:
///   RamVfs::write()  → opfs_write()
///   RamVfs::delete() → opfs_delete()
///   lib.rs bootstrap → opfs_list_all(), opfs_read()

use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/js/opfs_bridge.js")]
extern "C" {
    /// Write `bytes` to OPFS at `path` (fire-and-forget).
    #[wasm_bindgen(js_name = opfsWrite)]
    pub fn opfs_write(path: &str, bytes: &[u8]) -> js_sys::Promise;

    /// Delete `path` from OPFS (fire-and-forget).
    #[wasm_bindgen(js_name = opfsDelete)]
    pub fn opfs_delete(path: &str) -> js_sys::Promise;

    /// Read `path` from OPFS → Promise<Uint8Array | null>.
    /// Only used during Phase B bootstrap.
    #[wasm_bindgen(js_name = opfsRead)]
    pub fn opfs_read(path: &str) -> js_sys::Promise;

    /// List all files → Promise<Array<{path, content}>>.
    /// Only used during Phase B bootstrap.
    #[wasm_bindgen(js_name = opfsListAll)]
    pub fn opfs_list_all() -> js_sys::Promise;
}