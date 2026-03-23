export const VFS_PREFIX =
  typeof import.meta.env?.VITE_VFS_PREFIX === "string"
    ? import.meta.env.VITE_VFS_PREFIX
    : "__r__";

/** URL prefix used by the Service Worker to route virtual TCP requests. */
export const PORT_PATH_PREFIX = "/__port__/";

/** Regex that strips the virtual port prefix from a URL pathname. */
export const PORT_PATH_REGEX = /^\/__port__\/\d+/;

/** URL prefix for Node.js built-in ESM stubs served by the SW. */
export const BUILTIN_PATH_PREFIX = "builtin/";

/** Vite timestamp cache file pattern — these files must not be specifier-rewritten. */
export const VITE_TIMESTAMP_PATTERN = ".timestamp-";
