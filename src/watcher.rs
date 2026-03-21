/// fs.watch() implementation.
///
/// Watchers are registered against a path (file or directory). When a file
/// is written, the VFS calls `Watchers::emit` which synchronously invokes
/// every matching JS callback. No polling — latency is 0ms.
///
/// A watcher on a directory with `recursive = true` matches any descendant.
/// A watcher on a directory with `recursive = false` matches only direct
/// children (depth 1).
/// A watcher on a file matches only that exact file.

use js_sys::Function;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct WatcherId(pub u64);

#[derive(Debug, Clone, Copy)]
pub enum EventKind {
    Created,
    Modified,
    Deleted,
    #[allow(dead_code)]
    Renamed,
}

impl EventKind {
    fn as_str(self) -> &'static str {
        match self {
            EventKind::Created  => "created",
            EventKind::Modified => "modified",
            EventKind::Deleted  => "deleted",
            EventKind::Renamed  => "renamed",
        }
    }
}

struct Entry {
    id:        WatcherId,
    watch_path: String,   // normalized, no trailing slash
    recursive:  bool,
    callback:   Function,
}

pub struct Watchers {
    entries: Vec<Entry>,
    next:    u64,
}

impl Watchers {
    pub fn new() -> Self {
        Self { entries: Vec::new(), next: 0 }
    }

    /// Register a watcher. Returns a WatcherId for later removal.
    pub fn add(&mut self, path: &str, recursive: bool, callback: Function) -> WatcherId {
        let id = WatcherId(self.next);
        self.next += 1;
        self.entries.push(Entry {
            id,
            watch_path: normalize(path),
            recursive,
            callback,
        });
        id
    }

    /// Remove a watcher by id. Returns true if found.
    pub fn remove(&mut self, id: WatcherId) -> bool {
        let before = self.entries.len();
        self.entries.retain(|e| e.id != id);
        self.entries.len() < before
    }

    /// Fire all matching callbacks for the given changed path.
    /// Called synchronously from VFS write/delete operations.
    pub fn emit(&self, changed_path: &str, kind: EventKind) {
        let norm = normalize(changed_path);
        for entry in &self.entries {
            if self.matches(entry, &norm) {
                fire_callback(&entry.callback, &norm, kind);
            }
        }
    }

    fn matches(&self, entry: &Entry, changed_norm: &str) -> bool {
        let wp = &entry.watch_path;

        if entry.recursive {
            // Match the watched path itself or any descendant
            changed_norm == wp.as_str()
                || changed_norm.starts_with(&format!("{}/", wp))
        } else {
            // Non-recursive: match the exact file, or a direct child of the dir
            if changed_norm == wp.as_str() {
                return true;
            }
            // Parent of changed must equal watch_path
            match changed_norm.rfind('/') {
                Some(idx) => &changed_norm[..idx] == wp.as_str(),
                None      => false,
            }
        }
    }
}

/// Normalize a path: trim trailing slashes, collapse double slashes.
fn normalize(path: &str) -> String {
    let mut s = path.replace('\\', "/");
    while s.contains("//") {
        s = s.replace("//", "/");
    }
    s.trim_end_matches('/').to_string()
}

/// Call the JS callback with `{ path, kind }`.
fn fire_callback(cb: &Function, path: &str, kind: EventKind) {
    let ev = js_sys::Object::new();
    let _ = js_sys::Reflect::set(
        &ev,
        &JsValue::from_str("path"),
        &JsValue::from_str(path),
    );
    let _ = js_sys::Reflect::set(
        &ev,
        &JsValue::from_str("kind"),
        &JsValue::from_str(kind.as_str()),
    );
    let _ = cb.call1(&JsValue::NULL, &ev);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_matches(watch_path: &str, recursive: bool, changed: &str) -> bool {
        let w = Watchers::new();
        let entry = Entry {
            id: WatcherId(0),
            watch_path: normalize(watch_path),
            recursive,
            callback: Function::unchecked_from_js(JsValue::NULL),
        };
        w.matches(&entry, &normalize(changed))
    }

    #[test]
    fn recursive_matches_descendant() {
        assert!(dummy_matches("/project", true, "/project/src/main.ts"));
        assert!(dummy_matches("/project", true, "/project"));
        assert!(!dummy_matches("/project", true, "/project-backup/file.ts"));
    }

    #[test]
    fn non_recursive_matches_direct_child() {
        assert!(dummy_matches("/project/src", false, "/project/src/main.ts"));
        assert!(!dummy_matches("/project/src", false, "/project/src/a/b.ts"));
        assert!(dummy_matches("/project/src/main.ts", false, "/project/src/main.ts"));
    }

    #[test]
    fn no_false_positive_prefix_overlap() {
        // "/project-backup" must not match watcher on "/project"
        assert!(!dummy_matches("/project", true, "/project-backup/file.ts"));
        assert!(!dummy_matches("/project", false, "/project-backup/file.ts"));
    }

    #[test]
    fn normalize_paths() {
        assert_eq!(normalize("/a//b/"), "/a/b");
        assert_eq!(normalize("a/b/"),  "a/b");
        assert_eq!(normalize("a"),     "a");
    }
}