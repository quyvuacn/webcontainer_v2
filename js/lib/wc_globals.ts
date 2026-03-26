/**
 * Global property names used for cross-module runtime communication.
 * Centralised here to prevent typos and ease future refactoring.
 *
 * Note: properties used inside generated code strings (esbuild-vfs-plugin,
 * esm-to-cjs template literals) keep their string form as they become
 * JavaScript source code — only TypeScript call sites use these constants.
 */
export const WC_EMIT_SIGINT = "__wcEmitSIGINT" as const;
export const WC_PROCESS_STACK = "__wcProcessStack" as const;
export const WC_EXIT_RESOLVE = "__wcExitResolve" as const;
export const WC_EXIT_HANDLER = "__wcExitHandler" as const;
export const WC_ACTIVE_HANDLE_COUNT = "__wcActiveHandleCount" as const;
export const WC_ESBUILD_WASM_MODULE = "__wcEsbuildWasmModule" as const;
export const WC_ESBUILD_WASM_BYTES = "__wcEsbuildWasmBytes" as const;
export const WC_ESBUILD = "__wcEsbuild" as const;
export const WC_HAS_TCP_REG = "__wcHasTcpReg" as const;
export const WC_BUILTINS = "__wcBuiltins" as const;
export const WC_CREATE_REQUIRE = "__wcCreateRequire" as const;
export const WC_PATH = "__wcPath" as const;
export const WC_ENTRY_PATH = "__wcEntryPath" as const;
export const WC_VFS_PREFIX = "__wcVfsPrefix" as const;
export const WC_PUSH_STDIN = "__wcPushStdin" as const;
export const WC_STDIN_RAW = "__wcStdinRaw" as const;
