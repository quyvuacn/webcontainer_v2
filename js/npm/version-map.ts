// ─── Module 2: VersionMap Builder ─────────────────────────────────────────────
// Đọc lockfile → map từ "node_modules/..." path → version string.
// Handle lockfileVersion 1 (nested) và 2/3 (flat).

type LockDep = {
  version?: string;
  dependencies?: Record<string, LockDep>;
};

export function buildVersionMap(
  lockfile: Record<string, unknown>,
): Record<string, string> {
  const map: Record<string, string> = {};
  const ver = (lockfile.lockfileVersion as number) ?? 1;

  if (ver >= 2 && lockfile.packages) {
    // v2/v3 — flat packages map
    const packages = lockfile.packages as Record<string, { version?: string }>;
    for (const [key, entry] of Object.entries(packages)) {
      if (key && entry.version) map[key] = entry.version;
    }
  } else if (lockfile.dependencies) {
    // v1 — nested dependencies
    const walk = (deps: Record<string, LockDep>, prefix: string) => {
      for (const [name, info] of Object.entries(deps)) {
        const key = `${prefix}node_modules/${name}`;
        if (info.version) map[key] = info.version;
        if (info.dependencies) walk(info.dependencies, key + "/");
      }
    };
    walk(lockfile.dependencies as Record<string, LockDep>, "");
  }

  return map;
}
