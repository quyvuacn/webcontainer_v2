import { CDN_BASE } from "../cdn/config";
import { buildVersionMap } from "./version-map";

// ─── Module 5: npm install (client side) ──────────────────────────────────────
// Production: gọi proxy POST /resolve → nhận lockfile → pre-fetch package.json.
// Test/legacy: inject resolveAll để bypass proxy.

export async function npmInstall(
  vfsRead: (p: string) => Uint8Array | null,
  vfsWrite: (p: string, b: Uint8Array) => void,
  vfsAcquireLock: (p: string) => number,
  vfsReleaseLock: (id: number) => void,
  pkgPath = "project",
  resolveAll?: ((deps: Record<string, string>) => Promise<unknown>) | null,
  _opts?: { prefetch?: boolean },
): Promise<{ added: number; versionMap: Record<string, string> }> {
  const pkgJsonBytes = vfsRead(`${pkgPath}/package.json`);
  if (!pkgJsonBytes) throw new Error("No package.json");

  // ── 1. Resolve → lockfile ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lock: any;

  if (resolveAll) {
    // Injected resolver — dùng trong tests hoặc legacy mode
    const pkg = JSON.parse(new TextDecoder().decode(pkgJsonBytes));
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
    if (!Object.keys(deps).length) {
      return { added: 0, versionMap: {} };
    }
    lock = await resolveAll(deps);
  } else {
    // Production: gọi proxy POST /resolve
    const res = await fetch(`${CDN_BASE}/resolve`, {
      method: "POST",
      body: pkgJsonBytes,
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText);
      throw new Error(`npm ERR! resolve failed: ${res.status} ${msg}`);
    }
    lock = await res.json();
  }

  // ── 2. Ghi lockfile vào VFS ────────────────────────────────────────────────
  vfsWrite(
    `${pkgPath}/package-lock.json`,
    new TextEncoder().encode(JSON.stringify(lock, null, 2)),
  );

  // ── 3. Build versionMap ────────────────────────────────────────────────────
  const versionMap = buildVersionMap(lock as Record<string, unknown>);

  const pkgEntries = Object.entries(
    (lock.packages || {}) as Record<string, { version: string }>,
  );
  if (!pkgEntries.length) return { added: 0, versionMap };

  const lockId = vfsAcquireLock(`${pkgPath}/node_modules`);

  // ── 4. Pre-fetch package.json cho tất cả packages ─────────────────────────
  // Cần fetch tất cả (không chỉ top-level) vì lazy fetcher đọc package.json
  // từ VFS để lấy version trước khi fetch file JS.
  const results = await Promise.allSettled(
    pkgEntries.map(async ([lockPath, entry]) => {
      if (!lockPath) return; // skip root package entry ("" key in lockfile v2)
      const name = lockPath.replace(/^node_modules\//, "");

      // @types/* là type-only — không có runtime JS
      if (name.startsWith("@types/")) {
        vfsWrite(
          `${pkgPath}/${lockPath}/package.json`,
          new TextEncoder().encode(
            JSON.stringify({ name, version: entry.version, types: "index.d.ts" }),
          ),
        );
        return;
      }

      const r = await fetch(`${CDN_BASE}/${name}@${entry.version}/package.json`);
      if (!r.ok)
        throw new Error(`CDN: ${name}@${entry.version} package.json not found`);
      vfsWrite(
        `${pkgPath}/${lockPath}/package.json`,
        new Uint8Array(await r.arrayBuffer()),
      );
    }),
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed)
    console.warn(`npm: failed to fetch package.json for ${failed} package(s)`);

  vfsReleaseLock(lockId);
  return { added: pkgEntries.length, versionMap };
}
