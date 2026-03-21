/// Write lock — serializes batch writes (e.g. npm install) to prevent
/// fs.watch() events from firing before all files in the batch are written.
///
/// While a lock is held on a prefix, any watch events whose path starts
/// with that prefix are buffered. When the lock is released, all buffered
/// events are flushed at once so watchers see a consistent snapshot.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct LockId(pub u64);

#[derive(Debug)]
pub struct WriteLock {
    /// Active locks: prefix → LockId.
    /// Multiple locks on different prefixes can coexist.
    active: Vec<(String, LockId)>,
    next:   u64,
}

impl WriteLock {
    pub fn new() -> Self {
        Self { active: Vec::new(), next: 0 }
    }

    /// Acquire an exclusive write lock on `prefix`.
    /// Returns a LockId that must be passed to `release`.
    pub fn acquire(&mut self, prefix: &str) -> LockId {
        let id = LockId(self.next);
        self.next += 1;
        self.active.push((prefix.to_string(), id));
        id
    }

    /// Release the lock identified by `id`.
    /// Returns `true` if the lock was found and removed.
    pub fn release(&mut self, id: LockId) -> bool {
        let before = self.active.len();
        self.active.retain(|(_, lid)| *lid != id);
        self.active.len() < before
    }

    /// Returns `true` if `path` is currently covered by any active lock.
    pub fn is_locked(&self, path: &str) -> bool {
        self.active.iter().any(|(prefix, _)| {
            path == prefix.as_str()
                || path.starts_with(&format!("{}/", prefix))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn basic_lock_unlock() {
        let mut wl = WriteLock::new();
        assert!(!wl.is_locked("project/node_modules/vite/index.js"));

        let id = wl.acquire("project/node_modules");
        assert!(wl.is_locked("project/node_modules/vite/index.js"));
        assert!(wl.is_locked("project/node_modules"));
        assert!(!wl.is_locked("project/src/main.ts"));

        assert!(wl.release(id));
        assert!(!wl.is_locked("project/node_modules/vite/index.js"));
    }

    #[test]
    fn no_false_positive_on_prefix_overlap() {
        let mut wl = WriteLock::new();
        let _id = wl.acquire("project/node");
        // "project/node_modules" starts with "project/node" as string,
        // but NOT as a path segment — must not match.
        assert!(!wl.is_locked("project/node_modules/pkg/index.js"));
        assert!(wl.is_locked("project/node/something.js"));
    }

    #[test]
    fn multiple_locks_coexist() {
        let mut wl = WriteLock::new();
        let id1 = wl.acquire("a");
        let id2 = wl.acquire("b");
        assert!(wl.is_locked("a/file.js"));
        assert!(wl.is_locked("b/file.js"));

        wl.release(id1);
        assert!(!wl.is_locked("a/file.js"));
        assert!(wl.is_locked("b/file.js"));

        wl.release(id2);
        assert!(!wl.is_locked("b/file.js"));
    }
}