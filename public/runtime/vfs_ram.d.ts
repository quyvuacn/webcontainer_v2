/* tslint:disable */
/* eslint-disable */

/**
 * Acquire a write lock on `prefix`.
 *
 * While the lock is held:
 *   - Any fs.watch() event whose path starts with `prefix` is buffered.
 *   - Writes still go to RAM and OPFS immediately.
 *
 * Call `vfs_release_lock` when the batch write is complete. All buffered
 * events are flushed at that point.
 *
 * Returns a numeric LockId. Pass it to `vfs_release_lock`.
 */
export function vfs_acquire_lock(prefix: string): bigint;

/**
 * Delete `path`. Returns `true` if it existed.
 */
export function vfs_delete(path: string): boolean;

/**
 * Returns `true` if `path` exists (file or directory).
 */
export function vfs_exists(path: string): boolean;

/**
 * Remove `path` from the in-memory cache. The next read will return `null`,
 * prompting the caller to fetch fresh data from OPFS.
 */
export function vfs_invalidate(path: string): void;

/**
 * Returns a JS Array of all file paths currently in RAM.
 * Useful for debugging and for generating the OPFS list during bootstrap.
 */
export function vfs_list_all_paths(): Array<any>;

/**
 * Create directory `path` (and all ancestors).
 */
export function vfs_mkdir(path: string): void;

/**
 * Write `content` to `path` without emitting watch events or triggering
 * OPFS write-through. Called during bootstrap to bulk-restore VFS from OPFS.
 */
export function vfs_preload(path: string, content: Uint8Array): void;

/**
 * Read `path`. Returns `None` (JS `null`) if not found.
 */
export function vfs_read(path: string): Uint8Array | undefined;

/**
 * List direct children of `dir_path`.
 * Returns a JS Array of strings (names, not full paths).
 */
export function vfs_readdir(dir_path: string): Array<any>;

/**
 * Release a write lock and flush all buffered watch events.
 */
export function vfs_release_lock(id: bigint): void;

/**
 * Remove all files under `prefix` (including `prefix` itself if it is a file).
 */
export function vfs_remove_prefix(prefix: string): void;

/**
 * Called once by JS (WasmVfsAdapter) after WASM init.
 * `write_fn(path: string, bytes: Uint8Array) → void`
 * `delete_fn(path: string) → void`
 */
export function vfs_set_opfs_callbacks(write_fn: Function, delete_fn: Function): void;

/**
 * Stat `path`. Returns a JS object `{ size, mtime, is_file, is_dir }`,
 * or `null` if the path does not exist.
 */
export function vfs_stat(path: string): any;

/**
 * Remove the watcher with the given id. Returns `true` if found.
 */
export function vfs_unwatch(id: bigint): boolean;

/**
 * Register a watcher on `path`.
 *
 * `callback` is called synchronously on every write/delete that matches,
 * with `{ path: string, kind: "created" | "modified" | "deleted" }`.
 *
 * Returns a numeric WatcherId. Pass it to `vfs_unwatch` to remove.
 */
export function vfs_watch(path: string, recursive: boolean, callback: Function): bigint;

/**
 * Write `content` bytes to `path`.
 *
 * Triggers:
 *   - RAM update (sync)
 *   - fs.watch() events (sync, possibly deferred if path is locked)
 *   - OPFS write-through (async, fire-and-forget)
 */
export function vfs_write(path: string, content: Uint8Array): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly vfs_set_opfs_callbacks: (a: number, b: number) => void;
    readonly vfs_acquire_lock: (a: number, b: number) => bigint;
    readonly vfs_delete: (a: number, b: number) => number;
    readonly vfs_exists: (a: number, b: number) => number;
    readonly vfs_invalidate: (a: number, b: number) => void;
    readonly vfs_list_all_paths: () => number;
    readonly vfs_mkdir: (a: number, b: number) => void;
    readonly vfs_preload: (a: number, b: number, c: number, d: number) => void;
    readonly vfs_read: (a: number, b: number, c: number) => void;
    readonly vfs_readdir: (a: number, b: number) => number;
    readonly vfs_release_lock: (a: bigint) => void;
    readonly vfs_remove_prefix: (a: number, b: number) => void;
    readonly vfs_stat: (a: number, b: number) => number;
    readonly vfs_unwatch: (a: bigint) => number;
    readonly vfs_watch: (a: number, b: number, c: number, d: number) => bigint;
    readonly vfs_write: (a: number, b: number, c: number, d: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
