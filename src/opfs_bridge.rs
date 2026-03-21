/// opfs_bridge.rs — single source of all JS bindings to opfs_bridge.js.
///
/// All OPFS operations are fire-and-forget Promises. The Main Thread
/// MUST NOT await any of them — it must never block on I/O.
///
/// Call sites:
///   RamVfs::write()  → opfs_write()
///   RamVfs::delete() → opfs_delete()
///   lib.rs bootstrap → opfs_list_all(), opfs_read()
///
/// When not targeting wasm32 (e.g. cargo test on native), these are no-ops
/// so unit tests can run without a JS environment.

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(module = "/js/opfs_bridge.js")]
extern "C" {
    #[wasm_bindgen(js_name = opfsWrite)]
    fn opfs_write_impl(path: &str, bytes: &[u8]) -> js_sys::Promise;
    #[wasm_bindgen(js_name = opfsDelete)]
    fn opfs_delete_impl(path: &str) -> js_sys::Promise;
}

#[cfg(target_arch = "wasm32")]
pub fn opfs_write(path: &str, bytes: &[u8]) {
    let _ = opfs_write_impl(path, bytes);
}
#[cfg(target_arch = "wasm32")]
pub fn opfs_delete(path: &str) {
    let _ = opfs_delete_impl(path);
}

#[cfg(not(target_arch = "wasm32"))]
pub fn opfs_write(_path: &str, _bytes: &[u8]) {}
#[cfg(not(target_arch = "wasm32"))]
pub fn opfs_delete(_path: &str) {}