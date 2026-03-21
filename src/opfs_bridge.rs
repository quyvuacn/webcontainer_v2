/// opfs_bridge.rs — OPFS callbacks injected from JS at runtime.
///
/// Instead of importing a JS module (which wasm-bindgen embeds as a snippet
/// and build scripts may accidentally overwrite), we use a simpler pattern:
///
///   JS calls `vfs_set_opfs_callbacks(write_fn, delete_fn)` once at init.
///   Rust stores the Functions in thread-local storage.
///   RamVfs calls them fire-and-forget on every write/delete.
///
/// This keeps WASM self-contained — no external JS module imports,
/// no snippets that could be corrupted by build tooling.

use std::cell::RefCell;

use js_sys::Function;
use wasm_bindgen::prelude::*;

thread_local! {
    static OPFS_WRITE:  std::cell::RefCell<Option<Function>> = RefCell::new(None);
    static OPFS_DELETE: std::cell::RefCell<Option<Function>> = RefCell::new(None);
}

/// Called once by JS (WasmVfsAdapter) after WASM init.
/// `write_fn(path: string, bytes: Uint8Array) → void`
/// `delete_fn(path: string) → void`
#[wasm_bindgen]
pub fn vfs_set_opfs_callbacks(write_fn: Function, delete_fn: Function) {
    OPFS_WRITE.with(|c| *c.borrow_mut() = Some(write_fn));
    OPFS_DELETE.with(|c| *c.borrow_mut() = Some(delete_fn));
}

/// Fire-and-forget OPFS write. Called by RamVfs::write().
pub fn opfs_write(path: &str, bytes: &[u8]) {
    OPFS_WRITE.with(|c| {
        if let Some(f) = c.borrow().as_ref() {
            let arr = js_sys::Uint8Array::from(bytes);
            let _ = f.call2(&JsValue::NULL, &JsValue::from_str(path), &arr);
        }
    });
}

/// Fire-and-forget OPFS delete. Called by RamVfs::delete() and remove_prefix().
pub fn opfs_delete(path: &str) {
    OPFS_DELETE.with(|c| {
        if let Some(f) = c.borrow().as_ref() {
            let _ = f.call1(&JsValue::NULL, &JsValue::from_str(path));
        }
    });
}