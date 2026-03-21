/// RamVfs — in-memory virtual file system.
///
/// Single source of truth for all file state. Runs on Main Thread only.
/// Workers access via MessageChannel — never directly.
///
/// Write path (3 steps, always in this order):
///   1. Update in-memory HashMap         — synchronous, 0 ms
///   2. Emit / buffer fs.watch() events  — synchronous
///   3. OPFS write-through               — fire-and-forget (no await)

use std::collections::{HashMap, HashSet};

use js_sys::Function;

use crate::lock::{LockId, WriteLock};
use crate::opfs_bridge;
use crate::watcher::{EventKind, WatcherId, Watchers};

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct FileEntry {
    pub content: Vec<u8>,
    pub mtime:   u64,  // ms since epoch
    #[allow(dead_code)]
    pub mode:    u32,  // unix permission bits (best-effort stub)
}

#[derive(Debug, Clone)]
pub struct Stat {
    pub size:    u64,
    pub mtime:   u64,
    pub is_file: bool,
    pub is_dir:  bool,
}

struct Deferred {
    path: String,
    kind: EventKind,
}

// ---------------------------------------------------------------------------
// RamVfs
// ---------------------------------------------------------------------------

pub struct RamVfs {
    files:    HashMap<String, FileEntry>,
    dirs:     HashSet<String>,
    watchers: Watchers,
    lock:     WriteLock,
    deferred: Vec<Deferred>,
}

impl RamVfs {
    pub fn new() -> Self {
        Self {
            files:    HashMap::new(),
            dirs:     HashSet::new(),
            watchers: Watchers::new(),
            lock:     WriteLock::new(),
            deferred: Vec::new(),
        }
    }

    // -----------------------------------------------------------------------
    // Write
    // -----------------------------------------------------------------------

    pub fn write(&mut self, path: &str, content: Vec<u8>) {
        let path  = normalize(path);
        let mtime = now_ms();
        let existed = self.files.contains_key(&path);

        self.files.insert(path.clone(), FileEntry {
            content: content.clone(),
            mtime,
            mode: 0o644,
        });
        self.ensure_ancestors(&path);
        self.maybe_emit(&path, if existed { EventKind::Modified } else { EventKind::Created });

        // Fire-and-forget — do not drop the Promise silently in strict mode;
        // bind it to a no-op then() so the engine doesn't warn.
        let _ = opfs_bridge::opfs_write(&path, &content);
    }

    /// Bulk-populate VFS from OPFS during Phase B bootstrap.
    /// No watch events, no OPFS write-through.
    pub fn preload(&mut self, path: &str, content: Vec<u8>) {
        let path = normalize(path);
        self.files.insert(path.clone(), FileEntry {
            content,
            mtime: 0,
            mode: 0o644,
        });
        self.ensure_ancestors(&path);
    }

    // -----------------------------------------------------------------------
    // Delete
    // -----------------------------------------------------------------------

    /// Remove a single file. Returns `true` if it existed.
    pub fn delete(&mut self, path: &str) -> bool {
        let path = normalize(path);
        let existed = self.files.remove(&path).is_some();
        if existed {
            self.maybe_emit(&path, EventKind::Deleted);
            let _ = opfs_bridge::opfs_delete(&path);
        }
        existed
    }

    /// Remove all files whose path equals `prefix` or starts with `prefix/`.
    /// Used by `npm ci` to wipe virtual node_modules before reinstalling.
    pub fn remove_prefix(&mut self, prefix: &str) {
        let prefix      = normalize(prefix);
        let prefix_slash = format!("{}/", prefix);

        let to_remove: Vec<String> = self
            .files
            .keys()
            .filter(|p| *p == &prefix || p.starts_with(&prefix_slash))
            .cloned()
            .collect();

        for path in to_remove {
            self.files.remove(&path);
            self.maybe_emit(&path, EventKind::Deleted);
            let _ = opfs_bridge::opfs_delete(&path);
        }

        self.dirs.retain(|d| d != &prefix && !d.starts_with(&prefix_slash));
    }

    // -----------------------------------------------------------------------
    // Read
    // -----------------------------------------------------------------------

    pub fn read(&self, path: &str) -> Option<&[u8]> {
        self.files.get(&normalize(path)).map(|e| e.content.as_slice())
    }

    pub fn stat(&self, path: &str) -> Option<Stat> {
        let path = normalize(path);
        if let Some(e) = self.files.get(&path) {
            return Some(Stat {
                size:    e.content.len() as u64,
                mtime:   e.mtime,
                is_file: true,
                is_dir:  false,
            });
        }
        if self.dirs.contains(&path) {
            return Some(Stat { size: 0, mtime: 0, is_file: false, is_dir: true });
        }
        None
    }

    pub fn exists(&self, path: &str) -> bool {
        let path = normalize(path);
        self.files.contains_key(&path) || self.dirs.contains(&path)
    }

    /// List direct children of `dir_path`.
    /// Returns names (not full paths), sorted.
    pub fn readdir(&self, dir_path: &str) -> Vec<String> {
        let dir    = normalize(dir_path);
        let prefix = format!("{}/", dir);
        let mut seen = HashSet::new();

        for path in self.files.keys().chain(self.dirs.iter()) {
            if let Some(rest) = path.strip_prefix(&prefix) {
                let child = rest.split('/').next().unwrap_or(rest);
                if !child.is_empty() {
                    seen.insert(child.to_string());
                }
            }
        }

        let mut result: Vec<String> = seen.into_iter().collect();
        result.sort();
        result
    }

    // -----------------------------------------------------------------------
    // Directories
    // -----------------------------------------------------------------------

    pub fn mkdir(&mut self, path: &str) {
        let path = normalize(path);
        self.dirs.insert(path.clone());
        self.ensure_ancestors(&path);
    }

    fn ensure_ancestors(&mut self, path: &str) {
        let mut cur = path;
        loop {
            match cur.rfind('/') {
                None      => break,
                Some(idx) => {
                    cur = &cur[..idx];
                    if cur.is_empty() || self.dirs.contains(cur) { break; }
                    self.dirs.insert(cur.to_string());
                }
            }
        }
    }

    // -----------------------------------------------------------------------
    // fs.watch()
    // -----------------------------------------------------------------------

    pub fn watch(&mut self, path: &str, recursive: bool, cb: Function) -> WatcherId {
        self.watchers.add(path, recursive, cb)
    }

    pub fn unwatch(&mut self, id: WatcherId) -> bool {
        self.watchers.remove(id)
    }

    fn maybe_emit(&mut self, path: &str, kind: EventKind) {
        if self.lock.is_locked(path) {
            self.deferred.push(Deferred { path: path.to_string(), kind });
        } else {
            self.watchers.emit(path, kind);
        }
    }

    // -----------------------------------------------------------------------
    // Write lock
    // -----------------------------------------------------------------------

    pub fn acquire_lock(&mut self, prefix: &str) -> LockId {
        self.lock.acquire(prefix)
    }

    /// Release lock `id` and flush buffered events.
    ///
    /// Events whose path is still covered by *another* active lock remain
    /// buffered. This handles the rare case of overlapping locks (e.g. two
    /// concurrent npm installs into different prefixes).
    pub fn release_lock(&mut self, id: LockId) {
        self.lock.release(id);

        let deferred = std::mem::take(&mut self.deferred);
        for ev in deferred {
            if self.lock.is_locked(&ev.path) {
                // Still covered by another lock — keep buffered
                self.deferred.push(ev);
            } else {
                self.watchers.emit(&ev.path, ev.kind);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Invalidation (BroadcastChannel from other tab)
    // -----------------------------------------------------------------------

    pub fn invalidate(&mut self, path: &str) {
        self.files.remove(&normalize(path));
    }

    // -----------------------------------------------------------------------
    // Utility
    // -----------------------------------------------------------------------

    pub fn all_paths(&self) -> impl Iterator<Item = &str> {
        self.files.keys().map(|s| s.as_str())
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub fn normalize(path: &str) -> String {
    let mut s = path.replace('\\', "/");
    while s.contains("//") {
        s = s.replace("//", "/");
    }
    s.trim_end_matches('/').to_string()
}

fn now_ms() -> u64 {
    js_sys::Date::now() as u64
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn v() -> RamVfs { RamVfs::new() }

    #[test]
    fn write_read() {
        let mut vfs = v();
        vfs.write("src/main.ts", b"hello".to_vec());
        assert_eq!(vfs.read("src/main.ts"), Some(b"hello".as_ref()));
    }

    #[test]
    fn write_creates_ancestors() {
        let mut vfs = v();
        vfs.write("a/b/c/file.ts", b"".to_vec());
        assert!(vfs.dirs.contains("a"));
        assert!(vfs.dirs.contains("a/b"));
        assert!(vfs.dirs.contains("a/b/c"));
    }

    #[test]
    fn stat_file() {
        let mut vfs = v();
        vfs.write("f.ts", b"abc".to_vec());
        let s = vfs.stat("f.ts").unwrap();
        assert!(s.is_file && !s.is_dir && s.size == 3);
    }

    #[test]
    fn stat_dir() {
        let mut vfs = v();
        vfs.mkdir("mydir");
        let s = vfs.stat("mydir").unwrap();
        assert!(s.is_dir && !s.is_file);
    }

    #[test]
    fn readdir_direct_children_only() {
        let mut vfs = v();
        vfs.write("src/a.ts", b"".to_vec());
        vfs.write("src/b.ts", b"".to_vec());
        vfs.write("src/sub/c.ts", b"".to_vec());
        assert_eq!(vfs.readdir("src"), vec!["a.ts", "b.ts", "sub"]);
    }

    #[test]
    fn delete_removes_file_and_returns_true() {
        let mut vfs = v();
        vfs.write("f.ts", b"x".to_vec());
        assert!(vfs.delete("f.ts"));
        assert!(vfs.read("f.ts").is_none());
        assert!(!vfs.delete("f.ts"));
    }

    #[test]
    fn remove_prefix_leaves_other_files() {
        let mut vfs = v();
        vfs.write("node_modules/vite/index.js", b"".to_vec());
        vfs.write("node_modules/rollup/index.js", b"".to_vec());
        vfs.write("src/main.ts", b"".to_vec());
        vfs.remove_prefix("node_modules");
        assert!(vfs.read("node_modules/vite/index.js").is_none());
        assert!(vfs.read("src/main.ts").is_some());
    }

    #[test]
    fn preload_no_side_effects() {
        let mut vfs = v();
        vfs.preload("restored.ts", b"from opfs".to_vec());
        assert_eq!(vfs.read("restored.ts"), Some(b"from opfs".as_ref()));
    }

    #[test]
    fn write_lock_buffers_events() {
        let mut vfs = v();
        let lock = vfs.acquire_lock("node_modules");
        vfs.write("node_modules/vite/index.js", b"".to_vec());
        vfs.write("node_modules/rollup/index.js", b"".to_vec());
        assert_eq!(vfs.deferred.len(), 2);
        vfs.release_lock(lock);
        assert_eq!(vfs.deferred.len(), 0);
    }

    #[test]
    fn overlapping_locks_keep_events_buffered() {
        let mut vfs = v();
        let lock_a = vfs.acquire_lock("a");
        let lock_b = vfs.acquire_lock("b");
        vfs.write("a/file.ts", b"".to_vec());
        vfs.write("b/file.ts", b"".to_vec());
        assert_eq!(vfs.deferred.len(), 2);

        // Release lock_a — "a/file.ts" flushes, "b/file.ts" stays buffered
        vfs.release_lock(lock_a);
        assert_eq!(vfs.deferred.len(), 1);
        assert_eq!(vfs.deferred[0].path, "b/file.ts");

        vfs.release_lock(lock_b);
        assert_eq!(vfs.deferred.len(), 0);
    }

    #[test]
    fn invalidate_removes_from_ram() {
        let mut vfs = v();
        vfs.write("f.ts", b"old".to_vec());
        vfs.invalidate("f.ts");
        assert!(vfs.read("f.ts").is_none());
    }

    #[test]
    fn normalize_paths() {
        assert_eq!(normalize("a//b/"), "a/b");
        assert_eq!(normalize("/a/b/"), "/a/b");
        assert_eq!(normalize("a"),     "a");
    }
}