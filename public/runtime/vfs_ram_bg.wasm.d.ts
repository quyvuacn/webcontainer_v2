/* tslint:disable */
/* eslint-disable */
export const memory: WebAssembly.Memory;
export const vfs_set_opfs_callbacks: (a: number, b: number) => void;
export const vfs_acquire_lock: (a: number, b: number) => bigint;
export const vfs_delete: (a: number, b: number) => number;
export const vfs_exists: (a: number, b: number) => number;
export const vfs_invalidate: (a: number, b: number) => void;
export const vfs_list_all_paths: () => number;
export const vfs_mkdir: (a: number, b: number) => void;
export const vfs_preload: (a: number, b: number, c: number, d: number) => void;
export const vfs_read: (a: number, b: number, c: number) => void;
export const vfs_readdir: (a: number, b: number) => number;
export const vfs_release_lock: (a: bigint) => void;
export const vfs_remove_prefix: (a: number, b: number) => void;
export const vfs_stat: (a: number, b: number) => number;
export const vfs_unwatch: (a: bigint) => number;
export const vfs_watch: (a: number, b: number, c: number, d: number) => bigint;
export const vfs_write: (a: number, b: number, c: number, d: number) => void;
export const __wbindgen_export: (a: number) => void;
export const __wbindgen_export2: (a: number, b: number) => number;
export const __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
export const __wbindgen_add_to_stack_pointer: (a: number) => number;
export const __wbindgen_export4: (a: number, b: number, c: number) => void;
