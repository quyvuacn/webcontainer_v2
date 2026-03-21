/// lib.rs — wasm-bindgen public API exported to JavaScript.
///
/// This module owns the single global VFS instance and exposes every
/// operation that the Main Thread needs:
///
///   File I/O        : vfs_write, vfs_read, vfs_delete, vfs_stat, vfs_readdir
///   Directory ops   : vfs_mkdir, vfs_exists
///   Preload (F5)    : vfs_preload
///   Watchers        : vfs_watch, vfs_unwatch
///   Write locks     : vfs_acquire_lock, vfs_release_lock
///   Invalidation    : vfs_invalidate
///
/// All functions are synchronous from the JS caller's perspective.
/// The only async operation (OPFS write-through) is fire-and-forget.

mod lock;
mod opfs_bridge;
mod vfs_ram;
mod watcher;

use std::cell::RefCell;

use js_sys::Function;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use lock::LockId;
use vfs_ram::RamVfs;
use watcher::WatcherId;

// ---------------------------------------------------------------------------
// Global VFS instance (single-threaded WASM — no Mutex needed)
// ---------------------------------------------------------------------------

thread_local! {
    static VFS: RefCell<RamVfs> = RefCell::new(RamVfs::new());
}

fn with_vfs<R>(f: impl FnOnce(&mut RamVfs) -> R) -> R {
    VFS.with(|v| f(&mut v.borrow_mut()))
}

// ---------------------------------------------------------------------------
// Stat result — returned as a JS object
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize)]
pub struct JsStat {
    pub size:    u64,
    pub mtime:   u64,
    pub is_file: bool,
    pub is_dir:  bool,
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

/// Write `content` bytes to `path`.
///
/// Triggers:
///   - RAM update (sync)
///   - fs.watch() events (sync, possibly deferred if path is locked)
///   - OPFS write-through (async, fire-and-forget)
#[wasm_bindgen]
pub fn vfs_write(path: &str, content: &[u8]) {
    with_vfs(|v| v.write(path, content.to_vec()));
}

/// Read `path`. Returns `None` (JS `null`) if not found.
#[wasm_bindgen]
pub fn vfs_read(path: &str) -> Option<Vec<u8>> {
    with_vfs(|v| v.read(path).map(|b| b.to_vec()))
}

/// Delete `path`. Returns `true` if it existed.
#[wasm_bindgen]
pub fn vfs_delete(path: &str) -> bool {
    with_vfs(|v| v.delete(path))
}

/// Remove all files under `prefix` (including `prefix` itself if it is a file).
#[wasm_bindgen]
pub fn vfs_remove_prefix(prefix: &str) {
    with_vfs(|v| v.remove_prefix(prefix));
}

/// Stat `path`. Returns a JS object `{ size, mtime, is_file, is_dir }`,
/// or `null` if the path does not exist.
#[wasm_bindgen]
pub fn vfs_stat(path: &str) -> JsValue {
    with_vfs(|v| {
        match v.stat(path) {
            Some(s) => serde_wasm_bindgen::to_value(&JsStat {
                size:    s.size,
                mtime:   s.mtime,
                is_file: s.is_file,
                is_dir:  s.is_dir,
            })
            .unwrap_or(JsValue::NULL),
            None => JsValue::NULL,
        }
    })
}

/// Returns `true` if `path` exists (file or directory).
#[wasm_bindgen]
pub fn vfs_exists(path: &str) -> bool {
    with_vfs(|v| v.exists(path))
}

/// List direct children of `dir_path`.
/// Returns a JS Array of strings (names, not full paths).
#[wasm_bindgen]
pub fn vfs_readdir(dir_path: &str) -> js_sys::Array {
    with_vfs(|v| {
        let names = v.readdir(dir_path);
        let arr   = js_sys::Array::new();
        for name in names {
            arr.push(&JsValue::from_str(&name));
        }
        arr
    })
}

// ---------------------------------------------------------------------------
// Directory ops
// ---------------------------------------------------------------------------

/// Create directory `path` (and all ancestors).
#[wasm_bindgen]
pub fn vfs_mkdir(path: &str) {
    with_vfs(|v| v.mkdir(path));
}

// ---------------------------------------------------------------------------
// Preload — F5 restore (Phase B bootstrap)
// ---------------------------------------------------------------------------

/// Write `content` to `path` without emitting watch events or triggering
/// OPFS write-through. Called during bootstrap to bulk-restore VFS from OPFS.
#[wasm_bindgen]
pub fn vfs_preload(path: &str, content: &[u8]) {
    with_vfs(|v| v.preload(path, content.to_vec()));
}

// ---------------------------------------------------------------------------
// fs.watch()
// ---------------------------------------------------------------------------

/// Register a watcher on `path`.
///
/// `callback` is called synchronously on every write/delete that matches,
/// with `{ path: string, kind: "created" | "modified" | "deleted" }`.
///
/// Returns a numeric WatcherId. Pass it to `vfs_unwatch` to remove.
#[wasm_bindgen]
pub fn vfs_watch(path: &str, recursive: bool, callback: Function) -> u64 {
    with_vfs(|v| v.watch(path, recursive, callback).0)
}

/// Remove the watcher with the given id. Returns `true` if found.
#[wasm_bindgen]
pub fn vfs_unwatch(id: u64) -> bool {
    with_vfs(|v| v.unwatch(WatcherId(id)))
}

// ---------------------------------------------------------------------------
// Write locks
// ---------------------------------------------------------------------------

/// Acquire a write lock on `prefix`.
///
/// While the lock is held:
///   - Any fs.watch() event whose path starts with `prefix` is buffered.
///   - Writes still go to RAM and OPFS immediately.
///
/// Call `vfs_release_lock` when the batch write is complete. All buffered
/// events are flushed at that point.
///
/// Returns a numeric LockId. Pass it to `vfs_release_lock`.
#[wasm_bindgen]
pub fn vfs_acquire_lock(prefix: &str) -> u64 {
    with_vfs(|v| v.acquire_lock(prefix).0)
}

/// Release a write lock and flush all buffered watch events.
#[wasm_bindgen]
pub fn vfs_release_lock(id: u64) {
    with_vfs(|v| v.release_lock(LockId(id)));
}

// ---------------------------------------------------------------------------
// Invalidation (from BroadcastChannel — other tab wrote to OPFS)
// ---------------------------------------------------------------------------

/// Remove `path` from the in-memory cache. The next read will return `null`,
/// prompting the caller to fetch fresh data from OPFS.
#[wasm_bindgen]
pub fn vfs_invalidate(path: &str) {
    with_vfs(|v| v.invalidate(path));
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/// Returns a JS Array of all file paths currently in RAM.
/// Useful for debugging and for generating the OPFS list during bootstrap.
#[wasm_bindgen]
pub fn vfs_list_all_paths() -> js_sys::Array {
    with_vfs(|v| {
        let arr = js_sys::Array::new();
        // vfs_ram exposes files via a pub method we add below
        for path in v.all_paths() {
            arr.push(&JsValue::from_str(path));
        }
        arr
    })
}