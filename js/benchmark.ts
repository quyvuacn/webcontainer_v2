import { RamVfs } from "./vfs_ram";

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function runVfsBenchmark(iterations = 1000) {
  const vfs = new RamVfs(null, null);
  const results: Record<string, string> = {};

  let t0 = now();
  for (let i = 0; i < iterations; i++) {
    vfs.write(`project/file_${i}.js`, `content ${i}`);
  }
  results.writeMs = (now() - t0).toFixed(2);
  results.writeOpsPerSec = (
    iterations /
    (parseFloat(results.writeMs) / 1000)
  ).toFixed(0);

  t0 = now();
  for (let i = 0; i < iterations; i++) {
    vfs.read(`project/file_${i}.js`);
  }
  results.readMs = (now() - t0).toFixed(2);
  results.readOpsPerSec = (
    iterations /
    (parseFloat(results.readMs) / 1000)
  ).toFixed(0);

  t0 = now();
  for (let i = 0; i < iterations; i++) {
    vfs.exists(`project/file_${i}.js`);
  }
  results.existsMs = (now() - t0).toFixed(2);

  return results;
}

export function runBenchmark() {
  const out = { vfs: runVfsBenchmark(1000) };
  return out;
}
