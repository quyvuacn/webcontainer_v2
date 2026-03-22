export const VFS_PREFIX =
  typeof import.meta.env?.VITE_VFS_PREFIX === "string"
    ? import.meta.env.VITE_VFS_PREFIX
    : "__r__";
