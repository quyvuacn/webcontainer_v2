import { describe, it, expect } from "vitest";
import { runVfsBenchmark } from "./benchmark";

describe("Benchmark", () => {
  it("VFS write 1000 files", () => {
    const r = runVfsBenchmark(1000);
    expect(parseFloat(r.writeMs)).toBeLessThan(500);
    expect(parseInt(r.writeOpsPerSec)).toBeGreaterThan(1000);
    console.log("VFS write:", r.writeMs, "ms,", r.writeOpsPerSec, "ops/s");
  });

  it("VFS read 1000 files", () => {
    const r = runVfsBenchmark(1000);
    expect(parseFloat(r.readMs)).toBeLessThan(100);
    expect(parseInt(r.readOpsPerSec)).toBeGreaterThan(5000);
    console.log("VFS read:", r.readMs, "ms,", r.readOpsPerSec, "ops/s");
  });
});
