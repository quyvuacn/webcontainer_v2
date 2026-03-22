import semver from "semver";
import { CDN_BASE } from "../cdn/config";

// ─── Semver + packument ───────────────────────────────────────────────
async function fetchPackument(name: string) {
  const r = await fetch(`${CDN_BASE}/registry/${name}`);
  if (!r.ok) throw new Error(`npm ERR! ${name}: ${r.status}`);
  return r.json();
}

function pickVersion(packument: any, rangeStr: string) {
  if (rangeStr === "latest") {
    return packument["dist-tags"]?.latest;
  }

  const versions = Object.keys(packument.versions || {});
  const v = semver.maxSatisfying(versions, rangeStr);

  if (!v) throw new Error(`No version satisfies ${rangeStr}`);
  return v;
}

// ─── Resolve all deps (simple lock) ────────────────────────────────────
export async function resolveAll(
  deps: Record<string, string> | null | undefined,
) {
  const lock = {
    packages: {} as Record<string, { version: string; resolved?: string }>,
    lockfileVersion: 3,
  };

  const queue = Object.entries(deps || {});
  const seen = new Set<string>();

  while (queue.length) {
    const batch = queue.splice(0, 6);
    const results = await Promise.all(
      batch.map(([name]) => fetchPackument(name)),
    );

    for (let i = 0; i < batch.length; i++) {
      const [name, rangeStr] = batch[i];
      if (seen.has(name)) continue;
      seen.add(name);

      const packument = results[i];
      const version = pickVersion(packument, rangeStr);
      const manifest = packument.versions[version];

      lock.packages[`node_modules/${name}`] = {
        version,
        resolved: manifest.dist?.tarball,
      };

      for (const [dep, dr] of Object.entries(manifest.dependencies || {})) {
        if (!seen.has(dep)) queue.push([dep, dr as string]);
      }
    }
  }

  return lock;
}
